import { useEffect, useRef } from 'react'

interface UseBackgroundAudioProps {
  inRoom: boolean
  currentTrack: any
  isPlaying: boolean
  hasPrevious: boolean
  hasNext: boolean
  roomCode: string
  channelRef: React.MutableRefObject<any>
  clientIdRef: React.MutableRefObject<string>
  isHost: boolean
  audioRef: React.MutableRefObject<HTMLAudioElement | null>
  setIsPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  goPrevious: () => void
  goNext: () => void
}

export function useBackgroundAudio({
  inRoom,
  currentTrack,
  isPlaying,
  hasPrevious,
  hasNext,
  roomCode,
  channelRef,
  clientIdRef,
  isHost,
  audioRef,
  setIsPlaying,
  setCurrentTime,
  goPrevious,
  goNext
}: UseBackgroundAudioProps) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const audioWakeLockRef = useRef<any>(null)
  const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const connectionCheckIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isPageVisibleRef = useRef<boolean>(true)

  // Enhanced background audio and connection reliability
  useEffect(() => {
    if (!inRoom || !currentTrack) return

    // Register service worker for background sync
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        console.log('Service Worker registered:', registration);
        
        // Register keep-alive with service worker
        if (registration.active) {
          registration.active.postMessage({
            type: 'REGISTER_KEEP_ALIVE'
          });
        }
      }).catch((error) => {
        console.log('Service Worker registration failed:', error);
      });
    }

    // AGGRESSIVE Background Audio Solution
    let wakeLock: WakeLockSentinel | null = null;
    let audioWakeLock: any = null;
    
    // Request wake lock to prevent device sleep
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          console.log('Wake lock acquired');
        }
      } catch (error) {
        console.log('Wake lock failed:', error);
      }
    };

    // Request audio wake lock (Android)
    const requestAudioWakeLock = async () => {
      try {
        if ('mediaSession' in navigator && 'setActionHandler' in navigator.mediaSession) {
          // Request audio focus
          if ('requestAudioFocus' in navigator.mediaSession) {
            (navigator.mediaSession as any).requestAudioFocus();
          }
        }
      } catch (error) {
        console.log('Audio wake lock failed:', error);
      }
    };

    // Initialize wake locks
    requestWakeLock();
    requestAudioWakeLock();

    // Media Session API for background controls
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.name,
        artist: 'GrooveBox Room',
        album: `Room: ${roomCode}`,
        artwork: [
          {
            src: '/favicon/favicon.svg',
            sizes: '96x96',
            type: 'image/svg+xml'
          }
        ]
      })

      // Handle background media controls
      navigator.mediaSession.setActionHandler('play', () => {
        if (audioRef.current && audioRef.current.paused) {
          void audioRef.current.play()
          setIsPlaying(true)
        }
      })

      navigator.mediaSession.setActionHandler('pause', () => {
        if (audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause()
          setIsPlaying(false)
        }
      })

      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (hasPrevious) goPrevious()
      })

      navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (hasNext) goNext()
      })

      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (audioRef.current && details.seekTime !== undefined) {
          audioRef.current.currentTime = details.seekTime
          setCurrentTime(details.seekTime)
        }
      })

      // Update playback state
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    }

    // AGGRESSIVE keep-alive mechanism for WebSocket connection
    const keepAliveInterval = setInterval(() => {
      if (channelRef.current) {
        // Send a ping to keep the connection alive
        try {
          channelRef.current.send({
            type: 'broadcast',
            event: 'ping',
            payload: { sender: clientIdRef.current, timestamp: Date.now() }
          })
        } catch (error) {
          console.log('Keep-alive ping failed, connection may be stale')
        }
      }
    }, 15000) // Every 15 seconds (more aggressive)

    // Background audio optimization
    const audio = audioRef.current
    if (audio) {
      // Set audio session to continue in background
      if ('mediaSession' in navigator) {
        // Enable background audio on mobile
        audio.setAttribute('playsinline', 'true')
        audio.setAttribute('webkit-playsinline', 'true')
        
        // Set audio session category for background playback (Firefox)
        if ('mozAudioChannelType' in audio) {
          (audio as any).mozAudioChannelType = 'content'
        }
      }

      // Resume audio context if suspended (mobile backgrounding)
      const resumeAudioContext = async () => {
        try {
          if (audio.readyState === 0) { // HAVE_NOTHING
            await audio.load()
          }
        } catch (error) {
          console.log('Audio context resume failed:', error)
        }
      }

      // Resume on user interaction
      const handleUserInteraction = () => {
        resumeAudioContext()
        document.removeEventListener('touchstart', handleUserInteraction)
        document.removeEventListener('click', handleUserInteraction)
        document.removeEventListener('keydown', handleUserInteraction)
      }

      document.addEventListener('touchstart', handleUserInteraction)
      document.addEventListener('click', handleUserInteraction)
      document.addEventListener('keydown', handleUserInteraction)

      // Listen for service worker messages
      const handleServiceWorkerMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'KEEP_ALIVE') {
          // Service worker is keeping us alive, ensure connection is active
          if (channelRef.current) {
            try {
              channelRef.current.send({
                type: 'broadcast',
                event: 'ping',
                payload: { sender: clientIdRef.current, timestamp: Date.now() }
              })
            } catch (error) {
              console.log('Service worker keep-alive ping failed:', error)
            }
          }
        }
      }

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage)
      }

      // Cleanup
      return () => {
        clearInterval(keepAliveInterval)
        document.removeEventListener('touchstart', handleUserInteraction)
        document.removeEventListener('click', handleUserInteraction)
        document.removeEventListener('keydown', handleUserInteraction)
        
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage)
        }
        
        // Clean up Media Session
        if ('mediaSession' in navigator) {
          navigator.mediaSession.setActionHandler('play', null)
          navigator.mediaSession.setActionHandler('pause', null)
          navigator.mediaSession.setActionHandler('previoustrack', null)
          navigator.mediaSession.setActionHandler('nexttrack', null)
          navigator.mediaSession.setActionHandler('seekto', null)
        }
        
        // Release wake locks
        if (wakeLock) {
          try {
            wakeLock.release();
            console.log('Wake lock released');
          } catch (error) {
            console.log('Wake lock release failed:', error);
          }
        }
        
        // Unregister keep-alive from service worker
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then((registration) => {
            if (registration.active) {
              registration.active.postMessage({
                type: 'UNREGISTER_KEEP_ALIVE'
              })
            }
          })
        }
      }
    }
  }, [inRoom, currentTrack, isPlaying, hasPrevious, hasNext, roomCode])

  // AGGRESSIVE Connection Monitoring & Background Detection
  useEffect(() => {
    if (!inRoom) return

    let isPageVisible = true
    let connectionCheckInterval: NodeJS.Timeout | null = null
    
    // More aggressive page visibility detection
    const handleVisibilityChange = () => {
      const wasVisible = isPageVisible
      isPageVisible = !document.hidden
      
      console.log('Page visibility changed:', { wasVisible, isPageVisible, hidden: document.hidden })
      
      if (wasVisible && !isPageVisible) {
        // Page went to background - start aggressive monitoring
        console.log('Page went to background - starting aggressive monitoring')
        startAggressiveMonitoring()
      } else if (!wasVisible && isPageVisible) {
        // Page came back to foreground - stop aggressive monitoring
        console.log('Page came back to foreground - stopping aggressive monitoring')
        stopAggressiveMonitoring()
        
        // Immediately sync with host
        if (channelRef.current && !isHost) {
          channelRef.current.send({
            type: 'broadcast',
            event: 'player:request_state',
            payload: { sender: clientIdRef.current }
          })
        }
      }
    }

    // Start aggressive monitoring when backgrounded
    const startAggressiveMonitoring = () => {
      // Check connection every 5 seconds when backgrounded
      connectionCheckInterval = setInterval(() => {
        if (channelRef.current) {
          try {
            channelRef.current.send({
              type: 'broadcast',
              event: 'ping',
              payload: { sender: clientIdRef.current, timestamp: Date.now() }
            })
          } catch (error) {
            console.log('Aggressive monitoring ping failed:', error)
          }
        }
      }, 5000)
    }

    // Stop aggressive monitoring when foregrounded
    const stopAggressiveMonitoring = () => {
      if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval)
        connectionCheckInterval = null
      }
    }

    // Listen for page visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // Also listen for page focus/blur events as backup
    const handleFocus = () => {
      if (!isPageVisible) {
        isPageVisible = true
        handleVisibilityChange()
      }
    }
    
    const handleBlur = () => {
      if (isPageVisible) {
        isPageVisible = false
        handleVisibilityChange()
      }
    }
    
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    // Cleanup
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      stopAggressiveMonitoring()
    }
  }, [inRoom, isHost])

  return {
    wakeLockRef,
    audioWakeLockRef,
    keepAliveIntervalRef,
    connectionCheckIntervalRef,
    isPageVisibleRef
  }
}
