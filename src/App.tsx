import React, { useEffect, useMemo, useRef, useState } from 'react'
import GlobalTracker from './components/GlobalTracker'
import { Music, Sun, Moon, Upload as UploadIcon, Power, LogOut, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Users, Menu, X, Copy, Check, Shuffle } from 'lucide-react'
import { supabase } from './lib/supabaseClient'
import Header from './components/Header';
import Playlist from './components/Playlist';
import PlayerControls from './components/PlayerControls';
import Toasts from './components/Toasts';
import UploadModal from './components/UploadModal';
import UploadProgressModal from './components/UploadProgressModal';
import ParticipantsDropdown from './components/ParticipantsDropdown';
import type { Track, UploadProgress, Toast } from './types';
import { 
  formatTime, 
  cleanFileName, 
  deriveDisplayNameFromObjectName, 
  formatFileSize, 
  formatSpeed, 
  sortTracksAlphabetically, 
  logSyncEvent, 
  logSupabaseUploadError 
} from './utils';
import { useUpload } from './hooks/useUpload';
import { useRoomManagement } from './hooks/useRoomManagement';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useRoomEnforcement } from './hooks/useRoomEnforcement';
import { useSyncManagement } from './hooks/useSyncManagement';
import { useBackgroundAudio } from './hooks/useBackgroundAudio';
import { useCommandQueue } from './hooks/useCommandQueue';





function useToasts() {
  const addToast = (message: string, type: Toast['type'] = 'info', duration: number = 3000) => {
    const id = crypto.randomUUID?.() || Math.random().toString(36).slice(2)
    const toast: Toast = { id, message, type, duration }
    // setToasts is captured from outer scope via closure when used inside component
    // This function will be rebound below in component with proper setToasts reference
    return toast
  }
  return { addToast }
}





export default function App(): JSX.Element {
  const [roomCode, setRoomCode] = useState<string>('')

  const [inRoom, setInRoom] = useState<boolean>(false)
  const [isHost, setIsHost] = useState<boolean>(false)
  const [tracks, setTracks] = useState<Track[]>([])
  const [currentIndex, setCurrentIndex] = useState<number>(-1)
  const [error, setError] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false)
  const [displayName, setDisplayName] = useState<string>('')
  const [roomTitle, setRoomTitle] = useState<string>('')
  const [homeTab, setHomeTab] = useState<'create' | 'join'>('create')
  const [participants, setParticipants] = useState<Array<{ key: string; name: string; isHost?: boolean }>>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [playbackBlocked, setPlaybackBlocked] = useState<boolean>(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('groovebox_theme') as 'light' | 'dark') || 'dark')
  const [isParticipantsOpen, setIsParticipantsOpen] = useState<boolean>(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false)
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(true)
  const [previousVolume, setPreviousVolume] = useState<number>(1)
  const [isCodeCopied, setIsCodeCopied] = useState<boolean>(false)
  const [isShuffle, setIsShuffle] = useState<boolean>(false)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const [waitingForSync, setWaitingForSync] = useState(false);
  const [syncRetryCount, setSyncRetryCount] = useState(0);
  const [pendingSyncState, setPendingSyncState] = useState<any>(null);
  const [isOutOfSync, setIsOutOfSync] = useState(false);

  // Close participants dropdown and mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (isParticipantsOpen && !target.closest('.participants-dropdown') && !target.closest('button')) {
        setIsParticipantsOpen(false)
      }
      if (isMobileMenuOpen && !target.closest('.mobile-menu-dropdown') && !target.closest('button')) {
        setIsMobileMenuOpen(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isParticipantsOpen, isMobileMenuOpen])

  const inputRef = useRef<HTMLInputElement | null>(null)
  const shouldAutoplayRef = useRef<boolean>(false)
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null)
  const clientIdRef = useRef<string>('')
  const isApplyingRemoteRef = useRef<boolean>(false)
  

  const pendingRemotePlayRef = useRef<{ index: number; time: number } | null>(null)
  const tracksRef = useRef<Track[]>([])
  const currentIndexRef = useRef<number>(-1)

  const clientIdToNameRef = useRef<Map<string, string>>(new Map())
  const displayNameRef = useRef<string>('')
  const pendingSelfNameRef = useRef<string | null>(null)

  // Host authority and enforcement helpers
  const isHostRef = useRef<boolean>(false)
  const participantNowRef = useRef<Map<string, { index: number; updatedAt: number }>>(new Map())
  const isPlayingRef = useRef<boolean>(false)
  const isShuffleRef = useRef<boolean>(false)

  // Keep refs synchronized with React state
  useEffect(() => { isHostRef.current = isHost }, [isHost])
  useEffect(() => { tracksRef.current = tracks }, [tracks])
  useEffect(() => { currentIndexRef.current = currentIndex }, [currentIndex])
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  useEffect(() => { displayNameRef.current = displayName }, [displayName])

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode)
      setIsCodeCopied(true)
      setTimeout(() => setIsCodeCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy room code:', error)
    }
  }





  // Toast helpers bound to state
  const addToast = (message: string, type: Toast['type'] = 'info', duration: number = 3000) => {
    const id = crypto.randomUUID?.() || Math.random().toString(36).slice(2)
    const toast: Toast = { id, message, type, duration }
    setToasts(prev => [...prev, toast])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, duration)
  }

  // Upload hook
  const {
    isUploading,
    uploadProgress,
    totalUploadSize,
    totalUploaded,
    isUploadOpen,
    isProgressOpen,
    setIsUploadOpen,
    setIsProgressOpen,
    onFiles,
    cancelUpload
  } = useUpload(roomCode, inRoom, setError, addToast, setTracks, channelRef, clientIdRef);

  // Room management hook
  const {
    createName,
    setCreateName,
    joinName,
    setJoinName,
    roomTitleInput,
    setRoomTitleInput,
    joinCodeInput,
    setJoinCodeInput,
    createRoom,
    joinRoom,
    endRoom,
    leaveRoom,
    cleanupRoomState,
    roomExists,
    roomIsActive,
    generateRoomCode,
    generateUniqueRoomCode
  } = useRoomManagement(setError, setRoomCode, setInRoom, setIsHost, setDisplayName, setRoomTitle, setTracks, setCurrentIndex, setIsPlaying, setCurrentTime, channelRef);

  // Audio player hook
  const {
    audioRef,
    togglePlay: togglePlayRaw,
    playCurrent,
    unlockPlayback,
    onLoadedMetadata,
    onTimeUpdate,
    onSeek: onSeekRaw,
    onEnded: onEndedRaw
  } = useAudioPlayer({
    tracks,
    currentIndex,
    isPlaying,
    currentTime,
    duration,
    volume,
    isApplyingRemoteRef,
    shouldAutoplayRef,
    pendingRemotePlayRef,
    tracksRef,
    currentIndexRef,
    isPlayingRef,
    isShuffleRef,
    setCurrentIndex,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setPlaybackBlocked,
    setWaitingForSync,
    setSyncRetryCount,
    setPendingSyncState,
    setIsOutOfSync,
    addToast,
    channelRef,
    clientIdRef,
    logSyncEvent
  });

  // Room enforcement hook
  const {
    roomEnforcementTimerRef,
    roomEnforcementEndAtRef,
    roomEnforcementIndexRef,
    roomNowStartedAtRef,
    suppressEnforcementRef,
    lastListenersWriteAtRef,
    roomExpectedPlayingRef,
    roomExpectedFrozenElapsedRef,
    disableMetaWritesRef,
    lastNowRecordIndexRef,
    lastNowRecordAtRef,
    recordRoomNowAndHistory,
    startNowEnforcement,
    writeListenersSnapshot
  } = useRoomEnforcement({
    roomCode,
    tracksRef,
    displayNameRef,
    isHostRef,
    channelRef,
    clientIdRef,
    participantNowRef,
    clientIdToNameRef
  });

  // Sync management hook
  const {
    syncRequestAttempts,
    requestHostStateWithRetry,
    handleOutOfSync,
    fetchRoomStateFromStorage
  } = useSyncManagement({
    roomCode,
    tracks,
    currentIndex,
    isPlaying,
    currentTime,
    isShuffle,
    isHost,
    isApplyingRemoteRef,
    shouldAutoplayRef,
    tracksRef,
    currentIndexRef,
    isPlayingRef,
    isShuffleRef,
    channelRef,
    clientIdRef,
    setCurrentIndex,
    setCurrentTime,
    setIsPlaying,
    setIsShuffle,
    setPlaybackBlocked,
    setWaitingForSync,
    setSyncRetryCount,
    setPendingSyncState,
    setIsOutOfSync,
    addToast
  });

  // Command queue hook
  const {
    globalCommandQueueRef,
    isProcessingGlobalQueueRef,
    processGlobalQueue,
    enqueueGlobalCommand,
    executePlayCommand,
    executePauseCommand,
    executeSeekCommand,
    executeNextCommand,
    executePreviousCommand,
    executeSelectCommand,
    executeShuffleToggleCommand,
    executeShuffleNextCommand
  } = useCommandQueue({
    tracks,
    currentIndex,
    isPlaying,
    isShuffle,
    isHost,
    channelRef,
    clientIdRef,
    audioRef,
    setCurrentIndex,
    setCurrentTime,
    setIsPlaying,
    setIsShuffle,
    shouldAutoplayRef,
    isApplyingRemoteRef,
    tracksRef,
    currentIndexRef,
    isPlayingRef,
    isShuffleRef,
    suppressEnforcementRef,
    recordRoomNowAndHistory,
    startNowEnforcement
  });

  // Wrapper functions that use the command queue
  const togglePlay = async () => await togglePlayRaw(enqueueGlobalCommand)
  const onSeek = (value: number) => onSeekRaw(value, enqueueGlobalCommand)
  const onEnded = () => onEndedRaw(enqueueGlobalCommand)



  // Cleanup local object URLs on unmount
  useEffect(() => {
    return () => {
      tracks.forEach(t => {
        if (t.url.startsWith('blob:')) URL.revokeObjectURL(t.url)
      })
    }
  }, [tracks])



  // Keep displayName ref in sync to avoid stale closures when tracking presence
  useEffect(() => { displayNameRef.current = displayName }, [displayName])
  // Keep isHost ref in sync
  useEffect(() => { isHostRef.current = isHost }, [isHost])
  // Keep playback state ref in sync
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  // Keep shuffle ref in sync
  useEffect(() => { isShuffleRef.current = isShuffle }, [isShuffle])

  // Keep refs in sync to avoid stale closures in realtime handlers
  useEffect(() => { tracksRef.current = tracks }, [tracks])
  useEffect(() => { currentIndexRef.current = currentIndex }, [currentIndex])

  // Theme apply and persist
  useEffect(() => {
    try { localStorage.setItem('groovebox_theme', theme) } catch {}
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  // Close upload modal on Escape
  useEffect(() => {
    if (!isUploadOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsUploadOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isUploadOpen])

  // Auto-clear errors after a delay
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [error])



  // Load existing songs and room meta for the current room
  useEffect(() => {
    const loadFromSupabase = async () => {
      if (!supabase || !inRoom || !roomCode) return
      const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
      setIsLoadingLibrary(true)
      try {
        const prefix = `rooms/${roomCode}`
        const metaPrefix = `rooms/${roomCode}/meta`
        const tracksPrefix = `rooms/${roomCode}/tracks`
        // Load room meta
        try {
          const { data: metaFile } = await supabase.storage.from(bucket).download(`${metaPrefix}/meta.json`)
          if (metaFile) {
            const text = await metaFile.text()
            const meta = JSON.parse(text) as { roomName?: string, hostName?: string }
            setRoomTitle(meta.roomName || '')
          }
        } catch {}
        // Load track display names if present (optional)
        let nameByPath = new Map<string, string>()
        try {
          const canReadMeta = (import.meta.env.VITE_ENABLE_TRACKS_META as string) === '1'
          if (canReadMeta) {
            const { data: tracksFile } = await supabase.storage.from(bucket).download(`${metaPrefix}/tracks.json`)
            if (tracksFile) {
              const text = await tracksFile.text()
              const list = JSON.parse(text) as Array<{ path: string; name: string }>
              list.forEach(it => nameByPath.set(it.path, it.name))
            }
          }
        } catch {}
        // Read canonical order from meta/tracks.json if available
        let canonicalOrder: Array<{ path: string; name: string }> | null = null
        try {
          const { data: orderFile } = await supabase.storage.from(bucket).download(`${metaPrefix}/tracks.json`)
          if (orderFile) {
            const text = await orderFile.text()
            const parsed = JSON.parse(text)
            if (Array.isArray(parsed)) canonicalOrder = parsed
          }
        } catch {}

        const { data: files, error: listErr } = await supabase.storage.from(bucket).list(tracksPrefix, {
          limit: 100,
          sortBy: { column: 'name', order: 'asc' }
        })
        if (listErr) return
        if (!files || files.length === 0) {
          setTracks([])
          setCurrentIndex(-1)
          return
        }

        const loaded: Track[] = []
        const pushTrack = async (fileName: string, display?: string) => {
          if (!supabase) return;
          const lower = (fileName || '').toLowerCase();
          if (!/\.(mp3|wav|m4a|aac|flac|ogg|oga|opus)$/i.test(lower)) return;
          const path = `${tracksPrefix}/${fileName}`;
          const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
          const url = signed?.signedUrl || supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
          if (!url) return;
          const displayName = display || nameByPath.get(path) || deriveDisplayNameFromObjectName(fileName);
          loaded.push({ id: path, url, name: displayName, path });
        };

        if (canonicalOrder && canonicalOrder.length > 0) {
          for (const it of canonicalOrder) {
            const parts = (it.path || '').split('/')
            const fileName = parts[parts.length - 1]
            if (fileName) await pushTrack(fileName, it.name)
          }
        } else {
          for (const f of files) {
            await pushTrack(f.name)
          }
        }

        setTracks(sortTracksAlphabetically(loaded))
        setCurrentIndex(loaded.length > 0 ? 0 : -1)
        setCurrentTime(0)
        // If a remote play was requested before we loaded, apply now
        if (pendingRemotePlayRef.current && loaded.length > pendingRemotePlayRef.current.index) {
          const { index, time } = pendingRemotePlayRef.current
          pendingRemotePlayRef.current = null
          isApplyingRemoteRef.current = true
          setCurrentIndex(index)
          setCurrentTime(time)
          shouldAutoplayRef.current = true
          setTimeout(() => { isApplyingRemoteRef.current = false }, 0)
        }
      } finally {
        setIsLoadingLibrary(false)
      }
    }

    loadFromSupabase()
  }, [inRoom, roomCode])

  // If the displayName changes while connected, update presence metadata so others see the new name.
  // Also update localStorage so refreshes pick up the latest name.
  useEffect(() => {
    const ch = channelRef.current
    if (!inRoom || !ch) return
    const name = (displayName || 'Guest').trim()
    if (!name) return
    try {
      void ch.track({ name, isHost })
    } catch {}
    try { localStorage.setItem('groovebox_name', name) } catch {}
  }, [displayName, inRoom])

  // If host status changes while connected, update presence metadata so everyone sees the correct host
  useEffect(() => {
    const ch = channelRef.current
    if (!inRoom || !ch) return
    try {
      void ch.track({ name: displayNameRef.current || 'Guest', isHost })
    } catch {}
  }, [isHost, inRoom])

  // Remove the unnecessary periodic sync check - it shows "out of sync" unnecessarily
  // The Force Resync button should only appear when there's a real sync issue

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onFiles(e.dataTransfer.files)
  }

  const onDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }





  // Listen for player:state_response and handle advanced sync
  useEffect(() => {
    if (!inRoom || !waitingForSync) return;
    const handler = ({ payload }: any) => {
      if (!payload || payload.sender === clientIdRef.current || payload.target !== clientIdRef.current) return;
      logSyncEvent('Received state from host for sync recovery', payload);
      setPendingSyncState(payload);
    };
    if (channelRef.current) {
      channelRef.current.on('broadcast', { event: 'player:state_response' }, handler);
    }
    return () => {
      // No cleanup needed; Supabase RealtimeChannel does not support .off
    };
  }, [inRoom, waitingForSync]);

  // When pendingSyncState is set, apply it and play
  useEffect(() => {
    if (!pendingSyncState) return;
    const { index, time, isPlaying: remoteIsPlaying, isShuffle: remoteShuffle } = pendingSyncState;
    if (index >= 0 && index < tracksRef.current.length) {
      isApplyingRemoteRef.current = true;
      if (typeof remoteShuffle === 'boolean') {
        setIsShuffle(remoteShuffle);
      }
      if (index !== currentIndexRef.current) {
        setCurrentIndex(index);
        setCurrentTime(time);
        shouldAutoplayRef.current = remoteIsPlaying;
      } else {
        setCurrentTime(time);
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = time;
        }
      }
      // Try to play after setting state
      setTimeout(() => {
        const audio = audioRef.current;
        if (audio && remoteIsPlaying) {
          audio.currentTime = time;
          audio.play().then(() => {
            setIsPlaying(true);
            setPlaybackBlocked(false);
            setWaitingForSync(false);
            setSyncRetryCount(0);
            setIsOutOfSync(false);
            addToast('Playback resumed and synced!', 'success');
            // Verify sync after 1s
            setTimeout(() => {
              const drift = Math.abs(audio.currentTime - time);
              if (currentIndexRef.current !== index || drift > 1) {
                logSyncEvent('Drift detected after resume, auto-correcting', { drift, index, currentIndex: currentIndexRef.current });
                setCurrentIndex(index);
                setCurrentTime(time);
                audio.currentTime = time;
                addToast('Resynced with host after playback recovery.', 'info');
              }
            }, 1000);
          }).catch((e) => {
            logSyncEvent('Playback failed after sync recovery', e);
            setSyncRetryCount(c => c + 1);
            if (syncRetryCount < 2) {
              // Retry sync
              if (channelRef.current) {
                channelRef.current.send({
                  type: 'broadcast',
                  event: 'player:request_state',
                  payload: { sender: clientIdRef.current }
                });
              }
            } else {
              setIsOutOfSync(true);
              setWaitingForSync(false);
              addToast('Sync failed after multiple attempts. Please force resync.', 'error');
            }
          });
        } else {
          setIsPlaying(false);
          setPlaybackBlocked(false);
          setWaitingForSync(false);
          setSyncRetryCount(0);
          setIsOutOfSync(false);
        }
        isApplyingRemoteRef.current = false;
      }, 200);
    } else {
      setIsOutOfSync(true);
      setWaitingForSync(false);
      addToast('Playlist mismatch during sync recovery. Please force resync.', 'error');
    }
    setPendingSyncState(null);
  }, [pendingSyncState, tracks]);



  const currentTrack = tracks[currentIndex] ?? null
  const fileName = useMemo(() => currentTrack?.name ?? 'No track selected', [currentTrack])
  
  const hasPrevious = tracks.length > 0
  const hasNext = tracks.length > 0
  
  const goPrevious = () => {
    if (tracksRef.current.length === 0) return
    enqueueGlobalCommand('previous', { fromIndex: currentIndexRef.current })
  }
  
  const goNext = () => {
    if (tracksRef.current.length === 0) return
    enqueueGlobalCommand('next', { fromIndex: currentIndexRef.current })
  }

  // Background audio hook
  const {
    wakeLockRef,
    audioWakeLockRef,
    keepAliveIntervalRef,
    connectionCheckIntervalRef,
    isPageVisibleRef
  } = useBackgroundAudio({
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
  });









  // Realtime: subscribe to room events (presence, playlist, player)
  useEffect(() => {
    if (!inRoom || !roomCode || !supabase) return
    if (!clientIdRef.current) clientIdRef.current = crypto.randomUUID?.() || Math.random().toString(36).slice(2)

    const ch = supabase.channel(`room-${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence: { key: clientIdRef.current }
      }
    })

    // Dedupe and ordering state for commands
    const lastSeqRef = { current: 0 } as React.MutableRefObject<number>
    const seenCommandIdsRef = { current: new Set<string>() } as React.MutableRefObject<Set<string>>

    // Mobile backgrounding detection and reconnection
    let isPageVisible = true
    let reconnectTimeout: NodeJS.Timeout | null = null
    
    const handleVisibilityChange = () => {
      const wasVisible = isPageVisible
      isPageVisible = !document.hidden
      
      if (wasVisible && !isPageVisible) {
        // Page went to background - mark as potentially disconnected
        console.log('Page went to background - may lose connection')
      } else if (!wasVisible && isPageVisible) {
        // Page came back to foreground - check connection and reconnect if needed
        console.log('Page came back to foreground - checking connection')
        
        // Clear any existing reconnect timeout
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout)
          reconnectTimeout = null
        }
        
        // Check if we're still connected to the channel
        console.log('Page came back to foreground - checking connection')
        
        // Try to reconnect if needed
        ch.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('Successfully reconnected to room')
            addToast('Reconnected to room!', 'success')
            
            // Request current player state from host
            if (!isHost) {
              ch.send({
                type: 'broadcast',
                event: 'player:request_state',
                payload: { sender: clientIdRef.current }
              })
            }
          } else if (status === 'CLOSED') {
            console.log('Channel closed, attempting to reconnect...')
            addToast('Connection lost, reconnecting...', 'warning')
          }
        })
        
        // Always request current state to sync up
        if (!isHost) {
          ch.send({
            type: 'broadcast',
            event: 'player:request_state',
            payload: { sender: clientIdRef.current }
          })
        }
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

    // Presence: track participants
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as Record<string, Array<{ name?: string; isHost?: boolean }>>
      const entries: Array<{ key: string; name: string; isHost?: boolean }> = []
      Object.entries(state).forEach(([key, metas]) => {
        if (key === clientIdRef.current) return // exclude self from others list
        if (!metas || metas.length === 0) return
        const lastMeta = metas[metas.length - 1] || {}
        const name = (lastMeta?.name as string) || 'Guest'
        const isHostMeta = !!lastMeta?.isHost
        clientIdToNameRef.current.set(key, name)
        entries.push({ key, name, isHost: isHostMeta })
      })
      setParticipants(entries)
    })
          ch.on('presence', { event: 'join' }, ({ key, newPresences }) => {
        const latest = newPresences?.[newPresences.length - 1]
        const name = latest?.name || clientIdToNameRef.current.get(key) || 'Guest'
        clientIdToNameRef.current.set(key, name)
        addToast(`${name} joined the room`, 'success')
        
        // If this is a new user joining (not us), and we're the host, send them current state
        if (key !== clientIdRef.current && isHost) {
          console.log('New user joined, sending current state to:', name)
          const audio = audioRef.current
          const currentTime = audio ? audio.currentTime : 0
          
          // Send current state to the new user
          ch.send({
            type: 'broadcast',
            event: 'player:state_response',
            payload: {
              index: currentIndexRef.current,
              time: currentTime,
              isPlaying: isPlaying,
              sender: clientIdRef.current,
              target: key
            }
          })
        }
      })
    ch.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
      const name = leftPresences?.[0]?.name || clientIdToNameRef.current.get(key) || 'Guest'
      addToast(`${name} left the room`, 'info')
      clientIdToNameRef.current.delete(key)
    })

    ch.on('broadcast', { event: 'playlist:add' }, async ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      const items = Array.isArray((payload as any).items) ? (payload as any).items as Array<{ path: string; name?: string }> : []
      if (items.length === 0) return
      try {
        if (!supabase) return;
        const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music';
        const newTracks: Track[] = [];
        for (const it of items) {
          const path = it.path;
          if (!path) continue;
          const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
          const url = signed?.signedUrl || supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
          if (!url) continue;
          const fileName = path.split('/').pop() || path;
          newTracks.push({ id: path, url, name: it.name || fileName, path });
        }
        if (newTracks.length === 0) return;
        setTracks(prev => sortTracksAlphabetically([...prev, ...newTracks]))
      } catch (e) {
        console.error('Failed to append tracks from playlist:add payload:', e);
      }
    })

    // Handle commands queued by any client
    ch.on('broadcast', { event: 'player:command_queued' }, ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      
      const { command, payload: cmdPayload, sender, timestamp, seq, commandId } = payload as {
        command: string; payload: any; sender: string; timestamp: number; seq?: number; commandId?: string
      }
      // Dedupe by commandId
      if (commandId && seenCommandIdsRef.current.has(commandId)) return
      if (commandId) {
        seenCommandIdsRef.current.add(commandId)
        // Trim set to avoid unbounded growth
        if (seenCommandIdsRef.current.size > 500) {
          const iter = seenCommandIdsRef.current.values()
          for (let i = 0; i < 100; i++) { const v = iter.next(); if (v.done) break; seenCommandIdsRef.current.delete(v.value) }
        }
      }
      // Order by seq if provided
      if (typeof seq === 'number') {
        if (seq <= lastSeqRef.current) return
        lastSeqRef.current = seq
      }
      console.log(`Received queued command from ${sender}: ${command}`, cmdPayload)
      
      // Add to global queue
      globalCommandQueueRef.current.push({ command, payload: cmdPayload, sender, timestamp })
      
      // Process queue
      processGlobalQueue()
    })

    // Handle executed commands from any client
    ch.on('broadcast', { event: 'player:command_executed' }, ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      const { command, payload: cmdPayload } = payload
      console.log(`Received executed command: ${command}`, cmdPayload)
      // No-op: execution already handled via queue on all clients
    })


    // Announcements: room current track (informational)
    ch.on('broadcast', { event: 'room:now_playing' }, ({ payload }) => {
      if (!payload) return
      // Could be used to update UI badges; no-op for now
    })

    // Host polls: clients must report their current state
    ch.on('broadcast', { event: 'room:verify_now' }, ({ payload }) => {
      if (!payload) return
      // All clients respond with their current index/time/state
      const audio = audioRef.current
      const idx = currentIndexRef.current
      const t = audio ? audio.currentTime : 0
      const playing = isPlayingRef.current
      try {
        ch.send({
          type: 'broadcast',
          event: 'client:state',
          payload: { sender: clientIdRef.current, index: idx, time: t, isPlaying: playing }
        })
      } catch {}

      // Proactively self-correct during enforcement window if mismatch is detected
      const expectedIdx = Number((payload as any).expectedIndex)
      const expectedElapsed = Number((payload as any).expectedElapsed) || 0
      const expectedPlaying = Boolean((payload as any).expectedPlaying)
      const withinWindow = Date.now() <= roomEnforcementEndAtRef.current
      if (withinWindow && Number.isFinite(expectedIdx) && expectedIdx >= 0 && expectedIdx < tracksRef.current.length) {
        const needsTrack = idx !== expectedIdx
        const drift = Math.abs(t - expectedElapsed)
        const needsTime = expectedPlaying ? drift > 0.5 : Math.abs(t - expectedElapsed) > 0.25
        const needsPlayPause = playing !== expectedPlaying
        if (needsTrack || needsTime || needsPlayPause) {
          void (async () => {
            try {
              isApplyingRemoteRef.current = true
              if (needsTrack) await executeSelectCommand({ index: expectedIdx })
              const el = audioRef.current
              if (el && (needsTime || needsTrack)) el.currentTime = expectedElapsed
              if (expectedPlaying) {
                await executePlayCommand({ index: needsTrack ? expectedIdx : idx, time: expectedElapsed })
              } else {
                await executePauseCommand({ time: expectedElapsed })
              }
            } finally {
              setTimeout(() => { isApplyingRemoteRef.current = false }, 0)
            }
          })()
        }
      }
    })

    // Host receives client states during enforcement and forces corrections
    ch.on('broadcast', { event: 'client:state' }, ({ payload }) => {
      if (!payload || !isHostRef.current) return
      const clientKey = payload.sender as string
      const clientIndex = Number(payload.index)
      const clientTime = Number(payload.time) || 0
      const clientPlaying = Boolean(payload.isPlaying)
      participantNowRef.current.set(clientKey, { index: clientIndex, updatedAt: Date.now() })

      // Only enforce during active window
      if (Date.now() <= roomEnforcementEndAtRef.current && roomEnforcementIndexRef.current >= 0) {
        const expectedIdx = roomEnforcementIndexRef.current
        const expectedElapsed = roomExpectedPlayingRef.current
          ? Math.max(0, Math.floor((Date.now() - roomNowStartedAtRef.current) / 1000))
          : roomExpectedFrozenElapsedRef.current
        const expectedPlaying = roomExpectedPlayingRef.current
        const drift = Math.abs(clientTime - expectedElapsed)
        if (clientIndex !== expectedIdx || (roomExpectedPlayingRef.current ? drift > 0.5 : drift > 0.25) || clientPlaying !== expectedPlaying) {
          try {
            ch.send({
              type: 'broadcast',
              event: 'host:force_now',
              payload: { target: clientKey, index: expectedIdx, time: expectedElapsed, isPlaying: expectedPlaying }
            })
          } catch {}
        }
      }
    })

    // Clients accept targeted correction and immediately play/pause and seek to the room's current state
    ch.on('broadcast', { event: 'host:force_now' }, async ({ payload }) => {
      if (!payload || payload.target !== clientIdRef.current) return
      try {
        isApplyingRemoteRef.current = true
        suppressEnforcementRef.current = true
        const expectedIdx = Number(payload.index)
        const expectedElapsed = Number(payload.time) || 0
        const expectedPlaying = Boolean(payload.isPlaying)
        if (expectedIdx >= 0 && expectedIdx < tracksRef.current.length) {
          await executeSelectCommand({ index: expectedIdx })
        }
        const el = audioRef.current
        if (el) el.currentTime = expectedElapsed
        if (expectedPlaying) {
          await executePlayCommand({ index: expectedIdx, time: expectedElapsed })
        } else {
          await executePauseCommand({ time: expectedElapsed })
        }
      } finally {
        suppressEnforcementRef.current = false
        setTimeout(() => { isApplyingRemoteRef.current = false }, 0)
      }
    })



    ch.on('broadcast', { event: 'room:ended' }, () => {
      cleanupRoomState()
      try {
        localStorage.removeItem('groovebox_room')
        localStorage.removeItem('groovebox_is_host')
        localStorage.removeItem('groovebox_name') // Clear name when room ends
      } catch {}
      setDisplayName('') // Clear display name when room ends
    })

    // Handle state requests from reconnecting users
    ch.on('broadcast', { event: 'player:request_state' }, ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      // Only host responds to state requests
      if (!isHost) return
      
      // Send current player state to the requesting user
      const audio = audioRef.current
      const currentTime = audio ? audio.currentTime : 0
      
      console.log('Host responding with state:', { 
        index: currentIndexRef.current, 
        time: currentTime, 
        isPlaying: isPlayingRef.current,
        isShuffle: isShuffleRef.current
      })
      
      ch.send({
        type: 'broadcast',
        event: 'player:state_response',
        payload: {
          index: currentIndexRef.current,
          time: currentTime,
          isPlaying: isPlayingRef.current,
          isShuffle: isShuffleRef.current,
          sender: clientIdRef.current,
          target: payload.sender
        }
      })
    })

    // Handle state responses for reconnecting users
    ch.on('broadcast', { event: 'player:state_response' }, ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current || payload.target !== clientIdRef.current) return
      
      const { index, time, isPlaying: remoteIsPlaying, isShuffle: remoteShuffle } = payload as { 
        index: number; 
        time: number; 
        isPlaying: boolean;
        isShuffle?: boolean;
        sender: string;
        target: string;
      }
      
      console.log('Syncing with host state:', { index, time, remoteIsPlaying, currentIndex: currentIndexRef.current, tracksLength: tracksRef.current.length })
      
      // If we don't have tracks yet, queue the state for later
      if (tracksRef.current.length === 0) {
        console.log('No tracks loaded yet, queuing state sync')
        pendingRemotePlayRef.current = { index, time }
        return
      }
      
      // Update local state to match host
      if (index >= 0 && index < tracksRef.current.length) {
        isApplyingRemoteRef.current = true
        if (typeof remoteShuffle === 'boolean') {
          setIsShuffle(remoteShuffle)
        }
        
        if (index !== currentIndexRef.current) {
          console.log('State sync: changing index from', currentIndexRef.current, 'to', index)
          setCurrentIndex(index)
          setCurrentTime(time)
          shouldAutoplayRef.current = remoteIsPlaying
        } else {
          console.log('State sync: updating time to', time, 'and playing state to', remoteIsPlaying)
          setCurrentTime(time)
          const audio = audioRef.current
          if (audio) {
            audio.currentTime = time
          }
        }
        
        if (remoteIsPlaying && !isPlaying) {
          // Host is playing, so we should play too
          console.log('State sync: host is playing, starting playback')
          shouldAutoplayRef.current = true
          const audio = audioRef.current
          if (audio && audio.readyState >= 2) { // HAVE_CURRENT_DATA or higher
            try {
              audio.currentTime = time
              void audio.play()
              setIsPlaying(true)
            } catch (e) {
              console.log('State sync play failed:', e)
              setPlaybackBlocked(true)
            }
          }
        } else if (!remoteIsPlaying && isPlaying) {
          // Host is paused, so we should pause too
          console.log('State sync: host is paused, pausing playback')
          const audio = audioRef.current
          if (audio) {
            audio.pause()
          }
          setIsPlaying(false)
        }
        
        setTimeout(() => { isApplyingRemoteRef.current = false }, 0)
        addToast('Synced with host player state', 'info')
      } else {
        console.log('Invalid index received:', index, 'tracks length:', tracksRef.current.length)
      }
    })

    // Handle ping events for keep-alive
    ch.on('broadcast', { event: 'ping' }, ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      
      // Respond to ping with pong to confirm connection is alive
      try {
        ch.send({
          type: 'broadcast',
          event: 'pong',
          payload: { 
            sender: clientIdRef.current, 
            timestamp: Date.now(),
            respondingTo: payload.sender 
          }
        })
      } catch (error) {
        console.log('Failed to send pong response:', error)
      }
    })

    // Handle pong responses
    ch.on('broadcast', { event: 'pong' }, ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      
      // Log successful keep-alive response
      if (payload.respondingTo === clientIdRef.current) {
        console.log('Keep-alive response received from:', payload.sender)
      }
    })

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Track self presence with name
        const initialName = (pendingSelfNameRef.current || displayNameRef.current || 'Guest').trim()
        await ch.track({ name: initialName, isHost })
        pendingSelfNameRef.current = null
        
        // If we're not the host, immediately request current state
        if (!isHost) {
          console.log('Joined room, requesting current state from host')
          
          // Function to request state with retry
          const requestState = () => {
            ch.send({
              type: 'broadcast',
              event: 'player:request_state',
              payload: { sender: clientIdRef.current }
            })
          }
          
          // Initial request after a small delay
          setTimeout(requestState, 500)
          
          // Retry after 2 seconds if no response
          setTimeout(requestState, 2000)
          
          // Final retry after 5 seconds
          setTimeout(requestState, 5000)
        }
      }
    })
    channelRef.current = ch

    return () => {
      ch.unsubscribe()
      channelRef.current = null
      
      // Clean up event listeners
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      
      // Clear any reconnect timeout
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
      }
    }
  }, [inRoom, roomCode])



  // Restore session on first render, but only if room still exists and has not ended
  useEffect(() => {
    const restore = async () => {
      try {
        const savedRoom = localStorage.getItem('groovebox_room') || ''
        const savedName = localStorage.getItem('groovebox_name') || ''
        const savedHost = localStorage.getItem('groovebox_is_host') || '0'
        
        // Only restore name if it's not empty and valid
        if (savedName && savedName.trim().length > 0) {
          setDisplayName(savedName.trim())
          displayNameRef.current = savedName.trim()
        }
        
        if (savedRoom && supabase) {
          const active = await roomIsActive(savedRoom)
          if (active) {
            setRoomCode(savedRoom)
            setInRoom(true)
            setIsHost(savedHost === '1')
            
            // Don't restore any player state from localStorage - let the host sync us
            // This prevents restart issues when resuming sessions
            console.log('Session restored, waiting for host sync...')
          } else {
            try {
              localStorage.removeItem('groovebox_room')
              localStorage.removeItem('groovebox_is_host')
              localStorage.removeItem('groovebox_name') // Also clear name when room is invalid
            } catch {}
            setInRoom(false)
            setIsHost(false)
            setDisplayName('') // Clear name when room is invalid
          }
        }
      } catch {}
      finally {
        setIsRestoringSession(false)
      }
    }
    
    // Add a timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      setIsRestoringSession(false)
    }, 5000) // 5 second timeout
    
    void restore()
    
    return () => clearTimeout(timeout)
  }, [])

  // Show reconnecting screen while restoring session
  if (isRestoringSession) {
    return (
      <div className={`min-h-full flex flex-col ${theme === 'dark' ? 'bg-black text-white' : 'bg-white text-black'}`}>
        <header className="border-b border-black/10 dark:border-white/10">
          <div className="container-pro flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid place-items-center">
                <img src="/favicon/favicon.svg" alt="GrooveBox" className="h-6 w-6 sm:h-7 sm:w-7" />
              </div>
              <h1 className="text-base md:text-lg font-semibold tracking-tight">GrooveBox</h1>
            </div>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="icon-btn"
              aria-label="Toggle theme"
              title={theme==='dark'?'Switch to light':'Switch to dark'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-500 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold mb-2">Reconnecting to your room...</h2>
            <p className="text-sm text-black/60 dark:text-white/60">Please wait while we restore your session.</p>
          </div>
        </main>
      </div>
    )
  }

  // Render based on state; hooks above are unconditional to preserve order
  if (!inRoom) {
    return (
      <div className={`min-h-full flex flex-col ${theme === 'dark' ? 'bg-black text-white' : 'bg-white text-black'}`}>
        <header className="border-b border-black/10 dark:border-white/10">
          <div className="container-pro flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid place-items-center">
                <img src="/favicon/favicon.svg" alt="GrooveBox" className="h-6 w-6 sm:h-7 sm:w-7" />
              </div>
              <h1 className="text-base md:text-lg font-semibold tracking-tight">GrooveBox</h1>
            </div>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="icon-btn"
              aria-label="Toggle theme"
              title={theme==='dark'?'Switch to light':'Switch to dark'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>
        <main className="flex-1">
          <section className="px-3 sm:px-6 lg:px-8 py-10 md:py-14 max-w-5xl mx-auto">
            <div className="mb-8 text-center md:text-left">
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">Listen together, in sync</h2>
              <p className="mt-2 text-sm text-black/60 dark:text-white/60">Create a room, upload tracks, and share a code. Everyone hears the same thing at the same time.</p>
            </div>
            {/* Small screens: single card with tabs */}
            <div className="md:hidden">
              <div className="panel p-0 overflow-hidden">
                <div className="flex border-b border-black/10 dark:border-white/10">
                  <button
                    className={`flex-1 py-3 text-sm font-medium ${homeTab==='create' ? 'text-brand-500 border-b-2 border-brand-500' : 'text-black/60 dark:text-white/60'}`}
                    onClick={() => setHomeTab('create')}
                  >
                    Create
                  </button>
                  <button
                    className={`flex-1 py-3 text-sm font-medium ${homeTab==='join' ? 'text-brand-500 border-b-2 border-brand-500' : 'text-black/60 dark:text-white/60'}`}
                    onClick={() => setHomeTab('join')}
                  >
                    Join
                  </button>
                </div>
                <div className="p-6">
                  {homeTab === 'create' ? (
                    <div>
                      <h3 className="font-semibold">Create a Room</h3>
                      <p className="mt-1 text-sm text-black/60 dark:text-white/60">Host a synced listening session.</p>
                      <div className="mt-4 grid gap-3">
                        <div className="relative">
                          <input id="create-name-sm" value={createName} onChange={(e)=>setCreateName(e.currentTarget.value)} placeholder=" " className="input peer placeholder-transparent pt-5" />
                          <label htmlFor="create-name-sm" className="absolute left-3 text-black/60 dark:text-white/60 px-1 bg-white dark:bg-black transition-all duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-focus:-top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-[&:not(:placeholder-shown)]:-top-2 peer-[&:not(:placeholder-shown)]:translate-y-0 peer-[&:not(:placeholder-shown)]:text-xs">Your Name</label>
                        </div>
                        <div className="relative">
                          <input id="create-room-title-sm" value={roomTitleInput} onChange={(e)=>setRoomTitleInput(e.currentTarget.value)} placeholder=" " className="input peer placeholder-transparent pt-5" />
                          <label htmlFor="create-room-title-sm" className="absolute left-3 text-black/60 dark:text-white/60 px-1 bg-white dark:bg-black transition-all duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-focus:-top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-[&:not(:placeholder-shown)]:-top-2 peer-[&:not(:placeholder-shown)]:translate-y-0 peer-[&:not(:placeholder-shown)]:text-xs">Room Name (optional)</label>
                        </div>
                        <button onClick={createRoom} className="btn-primary mt-2">Create Room</button>
                        {error && <p className="text-sm text-red-500" role="alert" aria-live="polite">{error}</p>}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <h3 className="font-semibold">Join a Room</h3>
                      <p className="mt-1 text-sm text-black/60 dark:text-white/60">Enter a room code to join.</p>
                      <div className="mt-4 grid gap-3">
                        <div className="relative">
                          <input id="join-name-sm" value={joinName} onChange={(e)=>setJoinName(e.currentTarget.value)} placeholder=" " className="input peer placeholder-transparent pt-5" />
                          <label htmlFor="join-name-sm" className="absolute left-3 text-black/60 dark:text-white/60 px-1 bg-white dark:bg-black transition-all duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-focus:-top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-[&:not(:placeholder-shown)]:-top-2 peer-[&:not(:placeholder-shown)]:translate-y-0 peer-[&:not(:placeholder-shown)]:text-xs">Your Name</label>
                        </div>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input id="join-code-sm" value={joinCodeInput} onChange={(e)=>setJoinCodeInput(e.currentTarget.value)} placeholder=" " className="input font-mono tracking-widest peer placeholder-transparent pt-5" />
                            <label htmlFor="join-code-sm" className="absolute left-3 text-black/60 dark:text-white/60 px-1 bg-white dark:bg-black transition-all duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-focus:-top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-[&:not(:placeholder-shown)]:-top-2 peer-[&:not(:placeholder-shown)]:translate-y-0 peer-[&:not(:placeholder-shown)]:text-xs">Room Code</label>
                          </div>
                          <button onClick={joinRoom} className="btn-outline">Join</button>
                        </div>
                        {error && <p className="text-sm text-red-500" role="alert" aria-live="polite">{error}</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Medium and up: two cards side-by-side */}
            <div className="hidden md:grid md:grid-cols-2 gap-6">
              <div className="panel p-6 md:p-7">
                <h3 className="font-semibold">Create a Room</h3>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">Host a synced listening session.</p>
                <div className="mt-4 grid gap-3">
                  <div className="relative">
                    <input id="create-name-md" value={createName} onChange={(e)=>setCreateName(e.currentTarget.value)} placeholder=" " className="input peer placeholder-transparent pt-5" />
                    <label htmlFor="create-name-md" className="absolute left-3 text-black/60 dark:text-white/60 px-1 bg-white dark:bg-black transition-all duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-focus:-top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-[&:not(:placeholder-shown)]:-top-2 peer-[&:not(:placeholder-shown)]:translate-y-0 peer-[&:not(:placeholder-shown)]:text-xs">Your Name</label>
                  </div>
                  <div className="relative">
                    <input id="create-room-title-md" value={roomTitleInput} onChange={(e)=>setRoomTitleInput(e.currentTarget.value)} placeholder=" " className="input peer placeholder-transparent pt-5" />
                    <label htmlFor="create-room-title-md" className="absolute left-3 text-black/60 dark:text-white/60 px-1 bg-white dark:bg-black transition-all duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-focus:-top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-[&:not(:placeholder-shown)]:-top-2 peer-[&:not(:placeholder-shown)]:translate-y-0 peer-[&:not(:placeholder-shown)]:text-xs">Room Name (optional)</label>
                  </div>
                  <button onClick={createRoom} className="btn-primary mt-2">Create Room</button>
                </div>
              </div>
              <div className="panel p-6 md:p-7">
                <h3 className="font-semibold">Join a Room</h3>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">Enter a room code to join.</p>
                <div className="mt-4 grid gap-3">
                  <div className="relative">
                    <input id="join-name-md" value={joinName} onChange={(e)=>setJoinName(e.currentTarget.value)} placeholder=" " className="input peer placeholder-transparent pt-5" />
                    <label htmlFor="join-name-md" className="absolute left-3 text-black/60 dark:text-white/60 px-1 bg-white dark:bg-black transition-all duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-focus:-top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-[&:not(:placeholder-shown)]:-top-2 peer-[&:not(:placeholder-shown)]:translate-y-0 peer-[&:not(:placeholder-shown)]:text-xs">Your Name</label>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input id="join-code-md" value={joinCodeInput} onChange={(e)=>setJoinCodeInput(e.currentTarget.value)} placeholder=" " className="input font-mono tracking-widest peer placeholder-transparent pt-5" />
                      <label htmlFor="join-code-md" className="absolute left-3 text-black/60 dark:text-white/60 px-1 bg-white dark:bg-black transition-all duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-focus:-top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-[&:not(:placeholder-shown)]:-top-2 peer-[&:not(:placeholder-shown)]:translate-y-0 peer-[&:not(:placeholder-shown)]:text-xs">Room Code</label>
                    </div>
                    <button onClick={joinRoom} className="btn-outline">Join</button>
                  </div>
                  {error && <p className="text-sm text-red-500" role="alert" aria-live="polite">{error}</p>}
                </div>
              </div>
            </div>
          </section>
        </main>
        <footer className="container-pro py-8 text-center text-xs text-black/60 dark:text-white/60">Built with React, Vite, and Tailwind</footer>
      </div>
    )
  }
  

  return (
    <div className={`min-h-full flex flex-col ${theme==='dark'?'bg-black text-white':'bg-white text-black'}`}>
      <div className="fixed top-0 left-0 right-0 h-[15px] sm:hidden bg-white dark:bg-black z-40" />
      <header className="sticky top-[15px] sm:top-0 z-50 bg-white dark:bg-black border-b border-black/10 dark:border-white/10">
        <div className="container-pro flex h-14 sm:h-16 items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-3">
            <img src="/favicon/favicon.svg" alt="GrooveBox" className="h-5 w-5 sm:h-6 sm:w-6" />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base md:text-lg font-semibold tracking-tight">GrooveBox</h1>
              <p className="text-[10px] sm:text-[11px] text-black/60 dark:text-white/60 truncate">
                {isHost && <span className="text-brand-500">Host</span>}
                {roomTitle && <span className="ml-2">· {roomTitle}</span>}
              </p>
            </div>
          </div>

          {/* Centered Room Info (Desktop and larger) */}
          <div className="hidden md:flex flex-1 items-center justify-center">
            {inRoom && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-gradient-to-br from-white/70 via-white/40 to-transparent dark:from-black/70 dark:via-black/40 dark:to-transparent shadow-sm backdrop-blur">
                <span className="text-xs text-black/60 dark:text-white/60">{roomTitle || 'Room'}</span>
                <span className="font-mono text-sm sm:text-base px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10">{roomCode}</span>
                <button
                  onClick={copyRoomCode}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                  aria-label="Copy room code"
                  title="Copy room code"
                >
                  {isCodeCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-green-500" />
                      <span className="text-xs text-green-600 dark:text-green-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-black/60 dark:text-white/60" />
                      <span className="text-xs text-black/60 dark:text-white/60">Copy</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          <input
            id="file-input"
            ref={inputRef}
            type="file"
            accept=".mp3,.wav,.m4a,.aac,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,audio/aac,audio/mp4,audio/m4a,audio/x-m4a,audio/*"
            multiple
            className="sr-only"
            onChange={(e) => onFiles(e.currentTarget.files)}
          />
          {/* Mobile Right Controls: Participants + Menu (small screens) */}
          <div className="relative ml-auto md:ml-0 flex items-center gap-2">
          {/* Participants Button (small screens) */}
          <button
              onClick={() => setIsParticipantsOpen(!isParticipantsOpen)}
              className="icon-btn h-8 w-8 sm:h-9 sm:w-9 relative md:hidden"
              aria-label="View participants"
              title={`${participants.length + 1} participants`}
            >
              <Users className="h-4 w-4" />
              {participants.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-brand-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {participants.length + 1}
                </span>
              )}
            </button>

          {/* Mobile Menu Button */}
          <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="icon-btn h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center"
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
          </button>

            {/* Mobile Menu Dropdown */}
            {isMobileMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-64 bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-lg shadow-soft z-50">
                <div className="p-4 space-y-3">
                  {/* Upload Button */}
                  <button
                    className="w-full btn-primary justify-center"
                    onClick={() => {
                      setIsUploadOpen(true)
                      setIsMobileMenuOpen(false)
                    }}
                  >
                    <UploadIcon className="h-4 w-4 mr-2" /> Upload Tracks
                  </button>
                  
                  {/* Room Controls */}
            {isHost ? (
                    <button 
                      onClick={() => {
                        endRoom(roomCode, isHost)
                        setIsMobileMenuOpen(false)
                      }} 
                      className="w-full btn-outline border-red-500/60 text-red-500 hover:bg-red-500/10 justify-center"
                    >
                      End Room
                    </button>
                  ) : (
          <button
                      onClick={() => {
                        leaveRoom()
                        setIsMobileMenuOpen(false)
                      }} 
                      className="w-full btn-outline justify-center"
                    >
                      Leave Room
          </button>
                  )}
        </div>
            </div>
          )}

          {/* Participants Dropdown (small screens) */}
          {isParticipantsOpen && (
            <div className="absolute top-full right-0 mt-2 w-80 bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-lg shadow-soft z-50 md:hidden">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">Participants ({participants.length + 1})</h3>
                  <button
                    onClick={() => setIsParticipantsOpen(false)}
                    className="text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Current User (You) */}
                <div className="mb-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-brand-500/10 to-brand-500/5 border border-brand-500/20">
                    <div className="relative">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-semibold text-sm">
                        {(displayName || 'Guest').charAt(0).toUpperCase()}
                      </div>
                      {isHost && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center shadow-sm">
                          <svg className="w-2.5 h-2.5 text-black" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 8L15 13.2L18 10.5L17.3 14H6.7L6 10.5L9 13.2L12 8M12 4L8.5 10L3 5L5 16H19L21 5L15.5 10L12 4Z"/>
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-black dark:text-white truncate">{displayName || 'Guest'}</span>
                        {isHost && (
                          <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-[9px] font-medium rounded-full border border-yellow-500/30">
                            HOST
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Other Participants */}
                {participants.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {participants.map((p, i) => (
                      <div key={p.key + i} className="flex items-center gap-3 p-3 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white font-semibold text-sm">
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-black dark:text-white truncate">{p.name}</span>
                            {p.isHost && (
                              <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-[9px] font-medium rounded-full border border-yellow-500/30">
                                HOST
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-black/50 dark:text-white/50">Connected</p>
                        </div>
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 text-black/40 dark:text-white/40">
                    <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <p className="text-xs">You're the only one here</p>
                  </div>
                )}
              </div>
            </div>
          )}
          </div>
          
          {/* Participants Button */}
          <div className="relative hidden md:block">
          <button
              onClick={() => setIsParticipantsOpen(!isParticipantsOpen)}
              className="icon-btn h-8 w-8 sm:h-9 sm:w-9 relative"
              aria-label="View participants"
              title={`${participants.length + 1} participants`}
            >
              <Users className="h-4 w-4" />
              {participants.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-brand-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {participants.length + 1}
                </span>
              )}
          </button>
            {/* Participants Dropdown */}
            {isParticipantsOpen && (
              <div className="participants-dropdown absolute top-full right-0 mt-2 w-80 bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-lg shadow-soft z-50">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">Participants ({participants.length + 1})</h3>
                    <button
                      onClick={() => setIsParticipantsOpen(false)}
                      className="text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
            </div>
            
            {/* Current User (You) */}
            <div className="mb-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-brand-500/10 to-brand-500/5 border border-brand-500/20">
                <div className="relative">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-semibold text-sm">
                    {(displayName || 'Guest').charAt(0).toUpperCase()}
                  </div>
                  {isHost && (
                          <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center shadow-sm">
                            <svg className="w-2.5 h-2.5 text-black" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 8L15 13.2L18 10.5L17.3 14H6.7L6 10.5L9 13.2L12 8M12 4L8.5 10L3 5L5 16H19L21 5L15.5 10L12 4Z"/>
                    </svg>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-black dark:text-white truncate">{displayName || 'Guest'}</span>
                    {isHost && (
                            <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-[9px] font-medium rounded-full border border-yellow-500/30">
                        HOST
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Other Participants */}
                  {participants.length > 0 ? (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                {participants.map((p, i) => (
                        <div key={p.key + i} className="flex items-center gap-3 p-3 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white font-semibold text-sm">
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-black dark:text-white truncate">{p.name}</span>
                        {p.isHost && (
                                <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-[9px] font-medium rounded-full border border-yellow-500/30">
                            HOST
                          </span>
                        )}
                      </div>
                            <p className="text-[10px] text-black/50 dark:text-white/50">Connected</p>
                    </div>
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  </div>
                ))}
              </div>
                  ) : (
                    <div className="text-center py-4 text-black/40 dark:text-white/40">
                      <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                      <p className="text-xs">You're the only one here</p>
              </div>
            )}
          </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setTheme(theme==='dark'?'light':'dark')}
            className="icon-btn ml-1 sm:ml-2 h-8 w-8 sm:h-9 sm:w-9"
            aria-label="Toggle theme"
            title={theme==='dark'?'Switch to light':'Switch to dark'}
          >
            {theme==='dark'? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Mobile subheader with prominent room code */}
      {inRoom && (
        <div className="md:hidden sticky top-[calc(15px+3.5rem)] z-40 bg-white dark:bg-black border-b border-black/10 dark:border-white/10">
          <div className="container-pro py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[11px] text-black/60 dark:text-white/60 truncate">{roomTitle || 'Room'}</span>
                <span className="font-mono text-sm px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10">{roomCode}</span>
              </div>
              <button
                onClick={copyRoomCode}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                aria-label="Copy room code"
              >
                {isCodeCopied ? (
                  <>
                    <Check className="w-4 h-4 text-green-500" />
                    <span className="text-xs text-green-600 dark:text-green-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-black/60 dark:text-white/60" />
                    <span className="text-xs text-black/60 dark:text-white/60">Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1">
        <div className="container-pro py-4 sm:py-6" style={{maxWidth: '1920px'}}>
          {playbackBlocked && (
            <div className="mb-4 rounded-md border border-yellow-500/40 bg-yellow-400/10 text-yellow-200 px-3 py-2 text-sm flex items-center justify-between">
              <span>Playback is blocked by your browser. Click to enable synced playback.</span>
              <button onClick={unlockPlayback} className="ml-3 rounded bg-yellow-400 text-black px-2 py-1 text-xs font-medium" disabled={waitingForSync}>Enable</button>
            </div>
          )}
          {waitingForSync && (
            <div className="mb-4 rounded-md border border-blue-500/40 bg-blue-400/10 text-blue-200 px-3 py-2 text-sm flex items-center justify-between">
              <span>Syncing with room... Please wait.</span>
            </div>
          )}
          {/* Force Resync button only appears when there's a real sync issue */}
          {/* Not just because the host is paused - that's normal behavior */}

          {/* Legacy single-toast placeholder removed; using stacked toasts now */}
          {error && inRoom && <div className="hidden"></div>}

          {/* Professional Layout - Aligned with Header */}
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 justify-center items-center">
            {/* Premium Professional Playlist - Below Player on Small Screens, Left on Large */}
            <div className="w-full max-w-lg order-2 lg:order-1 lg:w-auto lg:flex-1">
              <div className="mt-4 sm:mt-6 bg-gradient-to-br from-white/95 via-white/90 to-white/85 dark:from-black/95 dark:via-black/90 dark:to-black/85 backdrop-blur-xl border border-white/40 dark:border-white/20 rounded-3xl shadow-2xl">
                {/* Premium Playlist Header */}
                <div className="bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-transparent border-b border-white/20 dark:border-white/10 p-8">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <Music className="w-8 h-8 text-white" />
                      </div>
                      <div>
                        <h3 className="text-3xl font-bold text-black dark:text-white mb-1">Playlist</h3>
                        <p className="text-base text-black/70 dark:text-white/70">Your music collection</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-brand-600 dark:text-brand-400 mb-1">
                        {isLoadingLibrary ? '...' : tracks.length}
                      </div>
                      <div className="text-sm text-black/60 dark:text-white/60 font-medium">
                        {isLoadingLibrary ? 'Loading' : tracks.length === 1 ? 'track' : 'tracks'}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Premium Playlist Content */}
                <div className="p-6 min-h-[300px] pb-8">
                  {isLoadingLibrary ? (
                    // Premium Loading State
                    <div className="space-y-4">
                      {[...Array(8)].map((_, i) => (
                        <div key={i} className="flex items-center gap-4 p-5 rounded-2xl bg-gradient-to-r from-black/5 to-black/3 dark:from-white/5 dark:to-white/3 animate-pulse">
                          <div className="w-12 h-12 bg-gradient-to-br from-black/10 to-black/5 dark:from-white/10 dark:to-white/5 rounded-xl"></div>
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-gradient-to-r from-black/10 to-black/5 dark:from-white/10 dark:to-white/5 rounded w-3/4"></div>
                            <div className="h-4 bg-gradient-to-r from-black/10 to-black/5 dark:from-white/10 dark:to-white/5 rounded w-1/2"></div>
                  </div>
                        </div>
                      ))}
                    </div>
                  ) : tracks.length === 0 ? (
                    // Premium Empty State
                    <div className="text-center py-12 min-h-[200px] flex flex-col justify-center">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-brand-500/20 to-brand-500/10 flex items-center justify-center">
                        <Music className="w-8 h-8 text-brand-500" />
                      </div>
                      <h4 className="text-lg font-semibold text-black dark:text-white mb-2">Your playlist is empty</h4>
                      <p className="text-black/60 dark:text-white/60 mb-4">Start building your music collection</p>
                      <div className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500/10 dark:bg-brand-500/10 border border-brand-500/20 dark:border-brand-500/20 rounded-lg text-brand-600 dark:text-brand-400 text-sm font-medium">
                        <UploadIcon className="w-4 h-4" />
                        Upload your first track
                      </div>
                    </div>
                  ) : (
                    // Premium Track List
                    <div className="space-y-3 max-h-[700px] overflow-y-auto px-2 py-2">
                      {tracks.length === 1 && (
                        <div className="text-center py-4 mb-4">
                          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-brand-500/10 dark:bg-brand-500/10 border border-brand-500/20 dark:border-brand-500/20 rounded-full text-brand-600 dark:text-brand-400 text-xs font-medium">
                            <Music className="w-3 h-3" />
                            Single Track
                          </div>
                        </div>
                      )}
                      {tracks.map((t, idx) => {
                        const active = idx === currentIndex
                        return (
                          <div
                            key={t.id}
                            className={`group relative overflow-hidden rounded-2xl transition-all duration-300 ${
                              active 
                                ? 'bg-gradient-to-r from-brand-500/20 via-brand-500/15 to-brand-500/10 shadow-lg ring-2 ring-brand-500/30' 
                                : 'hover:bg-gradient-to-r hover:from-black/8 hover:via-black/5 hover:to-black/3 dark:hover:from-white/8 dark:hover:via-white/5 dark:hover:to-white/3'
                            }`}
                          >
                            <button
                              className="w-full text-left p-5 transition-all duration-300"
                              onClick={() => {
                                enqueueGlobalCommand('select', { index: idx })
                                enqueueGlobalCommand('play', { index: idx, time: 0 })
                              }}
                            >
                              <div className="flex items-center gap-4">
                                {/* Premium Track Number */}
                                <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                                  active 
                                    ? 'bg-brand-500 text-white shadow-lg' 
                                    : 'bg-gradient-to-br from-black/10 to-black/5 dark:from-white/10 dark:to-white/5 text-black/70 dark:text-white/70 group-hover:bg-black/20 dark:group-hover:bg-white/20'
                                }`}>
                                  {active && isPlaying && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div className="flex items-center gap-1">
                                        <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                                        <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
                                        <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
                                      </div>
                                    </div>
                                  )}
                                  {!active || !isPlaying ? idx + 1 : ''}
                                </div>
                                
                                {/* Premium Track Info */}
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-black dark:text-white truncate text-base mb-1">
                                    {t.name}
                                  </div>
                                  {active && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-500/20 dark:bg-brand-500/20 px-2 py-1 rounded-full">
                                        {isPlaying ? 'Now Playing' : 'Paused'}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                
                                {/* Premium Play Button for Non-Active Tracks */}
                                {!active && (
                                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                    <div className="w-8 h-8 bg-brand-500/20 dark:bg-brand-500/20 rounded-full flex items-center justify-center">
                                      <Play className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Player Controls - Above Playlist on Small Screens, Right on Large */}
            <div className="w-full max-w-lg order-1 lg:order-2 lg:w-auto lg:flex-1 flex justify-center items-start">
              {/* Professional Player Control Card - Spotify Style (Tall & Narrow) */}
              <div className="relative mt-4 sm:mt-6 bg-gradient-to-br from-white/80 to-white/40 dark:from-black/80 dark:to-black/40 backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-2xl p-6 sm:p-8 lg:p-10 shadow-soft w-full max-w-lg">
                {/* Player Header - Centered Music Icon */}
                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center mb-4">
                    <div className="h-20 w-20 sm:h-24 sm:w-24 lg:h-28 lg:w-28 rounded-2xl bg-gradient-to-br from-brand-500/20 to-brand-500/10 grid place-items-center ring-1 ring-brand-500/20 shadow-soft">
                      <Music className="h-10 w-10 sm:h-12 sm:w-12 lg:h-14 lg:w-14 text-brand-500" />
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <p className="text-xs uppercase tracking-wider text-black/60 dark:text-white/60 font-medium mb-2">Now Playing</p>
                    {isLoadingLibrary ? (
                      <div className="space-y-2">
                        <div className="h-6 sm:h-7 lg:h-8 bg-black/10 dark:bg-white/10 rounded animate-pulse mx-auto w-3/4"></div>
                        <div className="h-4 sm:h-5 lg:h-6 bg-black/10 dark:bg-white/10 rounded animate-pulse mx-auto w-1/2"></div>
                      </div>
                    ) : (
                      <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-black dark:text-white px-4" title={fileName}>{fileName}</h2>
                    )}
                  </div>
                </div>

                {/* Main Controls */}
                <div className="flex flex-col items-center gap-6">
                  {/* Progress Bar - Moved above controls */}
                  <div className="w-full max-w-lg">
                    <input
                      type="range"
                      min={0}
                      max={duration || 0}
                      step={0.1}
                      value={currentTime}
                      onChange={(e) => onSeek(Number(e.currentTarget.value))}
                      className="w-full accent-brand-500 touch-pan-x h-3 rounded-full bg-black/10 dark:bg-white/10"
                      disabled={!currentTrack || isLoadingLibrary}
                    />
                    <div className="mt-3 flex justify-between text-sm text-black/70 dark:text-white/70 font-medium">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  {/* Playback Controls */}
                  <div className="flex items-center justify-center gap-4 sm:gap-6">
                      <button
                        onClick={() => enqueueGlobalCommand('shuffle_toggle', { enabled: !isShuffleRef.current })}
                        disabled={isLoadingLibrary || tracks.length === 0}
                        className={`icon-btn h-10 w-10 sm:h-12 sm:w-12 rounded-full backdrop-blur-sm border border-white/20 dark:border-white/10 transition-all duration-200 ${isShuffle ? 'bg-brand-500/20 text-brand-600 dark:text-brand-400' : 'bg-white/50 dark:bg-black/50 hover:bg-white/70 dark:hover:bg-black/70'}`}
                        aria-label="Toggle shuffle"
                        title="Shuffle"
                      >
                        <Shuffle className="h-4 w-4 sm:h-5 sm:w-5" />
                      </button>
                      <button
                        onClick={goPrevious}
                        disabled={!hasPrevious || isLoadingLibrary}
                      className="icon-btn h-12 w-12 sm:h-14 sm:w-14 lg:h-16 lg:w-16 rounded-full bg-white/50 dark:bg-black/50 backdrop-blur-sm border border-white/20 dark:border-white/10 hover:bg-white/70 dark:hover:bg-black/70 transition-all duration-200 disabled:opacity-50"
                        aria-label="Previous"
                      >
                      <SkipBack className="h-5 w-5 sm:h-6 sm:w-6" />
                      </button>
                      <button
                        onClick={togglePlay}
                        disabled={!currentTrack || isLoadingLibrary}
                        className="inline-flex items-center justify-center h-10 w-10 sm:h-12 sm:w-12 lg:h-14 lg:w-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white hover:from-brand-400 hover:to-brand-500 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:hover:scale-100"
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                      >
                        {isPlaying ? <Pause className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6" /> : <Play className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 ml-1" />}
                      </button>
                      <button
                        onClick={goNext}
                        disabled={!hasNext || isLoadingLibrary}
                      className="icon-btn h-12 w-12 sm:h-14 sm:w-14 lg:h-16 lg:w-16 rounded-full bg-white/50 dark:bg-black/50 backdrop-blur-sm border border-white/20 dark:border-white/10 hover:bg-white/70 dark:hover:bg-black/70 transition-all duration-200 disabled:opacity-50"
                        aria-label="Next"
                      >
                      <SkipForward className="h-5 w-5 sm:h-6 sm:w-6" />
                      </button>
                    </div>
                  </div>

                {/* Volume Control - Bottom Left Corner */}
                <div className="hidden lg:flex items-center gap-3 absolute bottom-4 left-6">
                  <button
                    onClick={() => {
                      if (volume > 0) {
                        setPreviousVolume(volume)
                        setVolume(0)
                      } else {
                        setVolume(previousVolume)
                      }
                    }}
                    className="hover:opacity-80 transition-opacity"
                    aria-label={volume > 0 ? "Mute" : "Unmute"}
                  >
                    {volume > 0 ? (
                    <Volume2 className="h-4 w-4 text-black/60 dark:text-white/60" />
                    ) : (
                      <VolumeX className="h-4 w-4 text-black/60 dark:text-white/60" />
                    )}
                  </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(e) => setVolume(Number(e.currentTarget.value))}
                    className="w-32 accent-brand-500"
                    />
                  </div>

                {/* Mobile/Tablet Volume Control */}
                <div className="lg:hidden mt-8 flex items-center justify-center gap-3">
                  <button
                    onClick={() => {
                      if (volume > 0) {
                        setPreviousVolume(volume)
                        setVolume(0)
                      } else {
                        setVolume(previousVolume)
                      }
                    }}
                    className="hover:opacity-80 transition-opacity"
                    aria-label={volume > 0 ? "Mute" : "Unmute"}
                  >
                    {volume > 0 ? (
                      <Volume2 className="h-4 w-4 text-black/60 dark:text-white/60" />
                    ) : (
                      <VolumeX className="h-4 w-4 text-black/60 dark:text-white/60" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => setVolume(Number(e.currentTarget.value))}
                    className="w-32 accent-brand-500"
                  />
                </div>


                <audio
                  ref={audioRef}
                  src={currentTrack?.url}
                  onLoadedMetadata={onLoadedMetadata}
                  onTimeUpdate={onTimeUpdate}
                  onEnded={onEnded}
                  className="hidden"
                  controls
                />
              </div>
            </div>


          </div>
        </div>
      </main>

      <footer className="container-pro py-8 text-center text-xs text-black/60 dark:text-white/60">
        Built with React, Vite, and Tailwind · Plays locally in your browser
      </footer>

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[60] space-y-2 w-72">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`rounded-md px-3 py-2 text-sm shadow-soft border 
                ${t.type === 'success' ? 'bg-green-600/10 border-green-600/30 text-green-200' : ''}
                ${t.type === 'info' ? 'bg-brand-500/10 border-brand-500/30 text-brand-500' : ''}
                ${t.type === 'warning' ? 'bg-yellow-600/10 border-yellow-600/30 text-yellow-200' : ''}
                ${t.type === 'error' ? 'bg-red-600/10 border-red-600/30 text-red-200' : ''}
              `}
              role="status"
              aria-live="polite"
            >
              {t.message}
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal (selection) */}
      {isUploadOpen && !isUploading && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/60" onClick={() => setIsUploadOpen(false)} />
          <div className="relative w-full max-w-lg card p-6 md:p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                Upload Tracks
              </h2>
            </div>

            {/* Upload interface */}
            <div
              onDrop={(e)=>{ onDrop(e); setIsUploadOpen(false) }}
              onDragOver={onDragOver}
              className="mt-4 panel p-6 text-center border-2 border-dashed border-black/20 dark:border-white/20 hover:border-brand-500/60 transition"
            >
              <p className="text-black/70 dark:text-white/70">Drag and drop songs here</p>
              <p className="mt-1 text-[11px] text-black/50 dark:text-white/50">MP3, WAV, M4A, AAC</p>
              <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
                <label
                  htmlFor="file-input"
                  className="btn-outline cursor-pointer"
                  onClick={() => { if (inputRef.current) inputRef.current.value = '' }}
                >
                  Choose Files
                </label>
                <button className="btn-ghost" onClick={() => setIsUploadOpen(false)}>Cancel</button>
              </div>
              {isLoadingLibrary && (
                <p className="mt-2 text-sm text-black/60 dark:text-white/60">Loading your library…</p>
              )}
              {error && (
                <p className="mt-2 text-sm text-red-500">{error}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload Progress Modal */}
      {isProgressOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-lg card p-6 md:p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Uploading Tracks...</h2>
            </div>

            <div className="mt-4 space-y-4">
              {/* Overall progress */}
              <div className="panel p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">Overall Progress</span>
                  <span className="text-sm text-black/60 dark:text-white/60">
                    {formatFileSize(totalUploaded)} / {formatFileSize(totalUploadSize)}
                  </span>
                </div>
                <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-2">
                  <div 
                    className="bg-brand-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${totalUploadSize > 0 ? (totalUploaded / totalUploadSize) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Individual file progress */}
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {uploadProgress.map((item, index) => (
                  <div key={index} className="panel p-3">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-sm font-medium truncate flex-1 mr-2" title={item.fileName}>
                        {item.fileName}
                      </span>
                      <span className="text-xs text-black/60 dark:text-white/60 whitespace-nowrap">
                        {item.status === 'completed' ? '100%' : `${Math.round(item.progress)}%`}
                      </span>
                    </div>
                    
                    <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-1.5 mb-2">
                      <div 
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          item.status === 'error' ? 'bg-red-500' : 
                          item.status === 'completed' ? 'bg-green-500' : 'bg-brand-500'
                        }`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>

                    <div className="flex justify-between items-center text-xs text-black/60 dark:text-white/60">
                      <span>
                        {formatFileSize(item.uploaded)} / {formatFileSize(item.total)}
                      </span>
                      <span>
                        {item.status === 'uploading' && item.speed > 0 ? formatSpeed(item.speed) : ''}
                      </span>
                    </div>

                    {item.status === 'error' && item.error && (
                      <p className="text-xs text-red-500 mt-1">{item.error}</p>
                    )}

                    {item.status === 'completed' && (
                      <div className="flex items-center text-xs text-green-600 dark:text-green-400 mt-1">
                        <span className="mr-1">✓</span> Uploaded successfully
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Status message handled by toasts */}

              {/* Cancel button */}
              <div className="flex justify-end">
                <button
                  className="btn-outline border-red-500/60 text-red-500 hover:bg-red-500/10"
                  onClick={cancelUpload}
                >
                  Cancel Uploads
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <GlobalTracker />
    </div>
  )
}




