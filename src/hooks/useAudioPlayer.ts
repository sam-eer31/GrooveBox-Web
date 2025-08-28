import { useRef, useState, useEffect } from 'react'
import type { Track } from '../types'

interface UseAudioPlayerProps {
  tracks: Track[]
  currentIndex: number
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isApplyingRemoteRef: React.MutableRefObject<boolean>
  shouldAutoplayRef: React.MutableRefObject<boolean>
  pendingRemotePlayRef: React.MutableRefObject<{ index: number; time: number } | null>
  tracksRef: React.MutableRefObject<Track[]>
  currentIndexRef: React.MutableRefObject<number>
  isPlayingRef: React.MutableRefObject<boolean>
  isShuffleRef: React.MutableRefObject<boolean>
  setCurrentIndex: (index: number) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setIsPlaying: (playing: boolean) => void
  setPlaybackBlocked: (blocked: boolean) => void
  setWaitingForSync: (waiting: boolean) => void
  setSyncRetryCount: (count: number) => void
  setPendingSyncState: (state: any) => void
  setIsOutOfSync: (outOfSync: boolean) => void
  addToast: (message: string, type?: 'success' | 'info' | 'warning' | 'error', duration?: number) => void
  channelRef: React.MutableRefObject<any>
  clientIdRef: React.MutableRefObject<string>
  logSyncEvent: (message: string, data?: any) => void
}

export function useAudioPlayer({
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
}: UseAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Reflect volume changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
    }
  }, [volume])

  const togglePlay = async (enqueueGlobalCommand: (command: string, payload: any) => void) => {
    if (isApplyingRemoteRef.current) return
    const audio = audioRef.current
    if (!audio) return
    
    if (audio.paused) {
      enqueueGlobalCommand('play', { index: Math.max(0, currentIndexRef.current), time: audio.currentTime })
    } else {
      enqueueGlobalCommand('pause', { time: audio.currentTime })
    }
  }

  const playCurrent = async () => {
    const audio = audioRef.current
    if (!audio) return
    try {
      // Only load if audio is in error state or not ready
      if (audio.readyState === 0 || audio.error) {
        audio.load()
      }
      await audio.play()
      setIsPlaying(true)
    } catch (err) {
      console.warn('Playback error:', err)
      // Likely autoplay is blocked until user interacts
      setPlaybackBlocked(true)
    }
  }

  // Modified unlockPlayback to request state from host
  const unlockPlayback = async () => {
    setWaitingForSync(true);
    setSyncRetryCount(0);
    setPendingSyncState(null);
    if (channelRef.current) {
      logSyncEvent('User clicked Enable, requesting state from host');
      channelRef.current.send({
        type: 'broadcast',
        event: 'player:request_state',
        payload: { sender: clientIdRef.current }
      });
    }
  };

  const onLoadedMetadata: React.ReactEventHandler<HTMLAudioElement> = (e) => {
    const el = e.currentTarget
    setDuration(el.duration)
    // If a local action requested autoplay, honor it immediately
    if (shouldAutoplayRef.current) {
      shouldAutoplayRef.current = false
      void playCurrent()
    }
    // Apply any pending remote play now that metadata is ready
    if (pendingRemotePlayRef.current) {
      const { index, time } = pendingRemotePlayRef.current
      pendingRemotePlayRef.current = null
      try {
        el.currentTime = time
        void el.play()
        setIsPlaying(true)
      } catch {
        setPlaybackBlocked(true)
        pendingRemotePlayRef.current = { index, time }
      }
    }
  }

  const onTimeUpdate: React.ReactEventHandler<HTMLAudioElement> = (e) => {
    setCurrentTime(e.currentTarget.currentTime)
  }

  const onSeek = (value: number, enqueueGlobalCommand: (command: string, payload: any) => void) => {
    if (isApplyingRemoteRef.current) return
    enqueueGlobalCommand('seek', { time: value })
  }

  // When metadata loads for a new track, autoplay if flagged
  useEffect(() => {
    const currentTrack = tracks[currentIndex]
    if (!currentTrack) return
    const audio = audioRef.current
    if (!audio) return
    const handleLoaded = async () => {
      if (shouldAutoplayRef.current) {
        shouldAutoplayRef.current = false
        await playCurrent()
      }
      // Apply any pending remote play now that metadata is ready
      if (pendingRemotePlayRef.current) {
        const { index, time } = pendingRemotePlayRef.current
        pendingRemotePlayRef.current = null
        try {
          audio.currentTime = time
          await audio.play()
          setIsPlaying(true)
        } catch {}
      }
    }
    audio.addEventListener('loadedmetadata', handleLoaded)
    return () => audio.removeEventListener('loadedmetadata', handleLoaded)
  }, [tracks, currentIndex])

  const onEnded = (enqueueGlobalCommand: (command: string, payload: any) => void) => {
    if (tracksRef.current.length === 0) {
      setIsPlaying(false)
      setCurrentTime(0)
      shouldAutoplayRef.current = false
      return
    }
    // Auto-advance: follow shuffle if enabled, else sequential next
    if (isShuffleRef.current) {
      const total = tracksRef.current.length
      if (total <= 1) {
        setIsPlaying(false)
        setCurrentTime(0)
        shouldAutoplayRef.current = false
        return
      }
      const from = currentIndexRef.current
      let nextIndex = Math.floor(Math.random() * (total - 1))
      if (nextIndex >= from) nextIndex += 1
      enqueueGlobalCommand('next', { fromIndex: from, nextIndex })
    } else {
      enqueueGlobalCommand('next', { fromIndex: currentIndexRef.current })
    }
  }

  return {
    audioRef,
    togglePlay,
    playCurrent,
    unlockPlayback,
    onLoadedMetadata,
    onTimeUpdate,
    onSeek,
    onEnded
  }
}
