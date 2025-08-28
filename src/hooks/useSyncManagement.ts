import { useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { logSyncEvent } from '../utils'

interface UseSyncManagementProps {
  roomCode: string
  tracks: any[]
  currentIndex: number
  isPlaying: boolean
  currentTime: number
  isShuffle: boolean
  isHost: boolean
  isApplyingRemoteRef: React.MutableRefObject<boolean>
  shouldAutoplayRef: React.MutableRefObject<boolean>
  tracksRef: React.MutableRefObject<any[]>
  currentIndexRef: React.MutableRefObject<number>
  isPlayingRef: React.MutableRefObject<boolean>
  isShuffleRef: React.MutableRefObject<boolean>
  channelRef: React.MutableRefObject<any>
  clientIdRef: React.MutableRefObject<string>
  setCurrentIndex: (index: number) => void
  setCurrentTime: (time: number) => void
  setIsPlaying: (playing: boolean) => void
  setIsShuffle: (shuffle: boolean) => void
  setPlaybackBlocked: (blocked: boolean) => void
  setWaitingForSync: (waiting: boolean) => void
  setSyncRetryCount: (count: number) => void
  setPendingSyncState: (state: any) => void
  setIsOutOfSync: (outOfSync: boolean) => void
  addToast: (message: string, type?: 'success' | 'info' | 'warning' | 'error', duration?: number) => void
}

export function useSyncManagement({
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
}: UseSyncManagementProps) {
  const syncRequestAttempts = useRef(0)

  function requestHostStateWithRetry(maxRetries = 3) {
    if (!channelRef.current) return;
    syncRequestAttempts.current = 0;
    function attempt() {
      if (!channelRef.current) return;
      channelRef.current.send({
        type: 'broadcast',
        event: 'player:request_state',
        payload: { sender: clientIdRef.current }
      });
      syncRequestAttempts.current++;
      if (syncRequestAttempts.current < maxRetries) {
        setTimeout(() => {
          // Note: isOutOfSync would need to be passed as a ref or state
          // For now, we'll keep this logic in the main component
        }, 5000);
      }
    }
    attempt();
  }

  // Handle out of sync state - sync with ROOM state, not host
  function handleOutOfSync() {
    logSyncEvent('User clicked Force Resync, syncing with ROOM state');
    setWaitingForSync(true);
    setSyncRetryCount(0);
    setPendingSyncState(null);
    
    // Fetch current room state directly from storage (room-centric, not host-centric)
    fetchRoomStateFromStorage();
  }

  // Fetch current room state directly from storage (room-centric sync)
  async function fetchRoomStateFromStorage() {
    if (!supabase || !roomCode) {
      logSyncEvent('Cannot fetch room state: missing supabase or roomCode');
      setWaitingForSync(false);
      return;
    }

    try {
      const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music';
      const nowPath = `rooms/${roomCode}/meta/now.json`;
      
      logSyncEvent('Fetching room state from storage:', nowPath);
      
      const { data: nowFile, error } = await supabase.storage.from(bucket).download(nowPath);
      
      if (error || !nowFile) {
        logSyncEvent('Failed to download now.json:', error);
        setWaitingForSync(false);
        return;
      }

      const nowText = await nowFile.text();
      const nowData = JSON.parse(nowText);
      
      logSyncEvent('Successfully fetched room state from storage:', nowData);
      
      // Apply the room state directly
      if (nowData.index !== undefined) {
        setCurrentIndex(nowData.index);
        
        // If there's a startedAt timestamp, assume the room is playing
        const isRoomPlaying = !!nowData.startedAt;
        setIsPlaying(isRoomPlaying);
        
        // Calculate current time from startedAt when available
        let computedTime = 0;
        if (isRoomPlaying && typeof nowData.startedAt === 'string') {
          const startedMs = Date.parse(nowData.startedAt);
          if (!Number.isNaN(startedMs)) {
            computedTime = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
          }
        }
        setCurrentTime(computedTime);
        
        if (isRoomPlaying) {
          const audio = document.querySelector('audio') as HTMLAudioElement;
          if (audio) {
            try {
              audio.currentTime = computedTime;
              await audio.play();
              setIsPlaying(true);
              logSyncEvent('Successfully resumed playback from room state');
            } catch (err) {
              logSyncEvent('Failed to resume playback:', err);
              setPlaybackBlocked(true);
            }
          }
        }
        
        setIsOutOfSync(false);
        logSyncEvent('Successfully synced with room state');
      }
      
    } catch (e) {
      logSyncEvent('Error fetching room state from storage:', e);
    } finally {
      setWaitingForSync(false);
    }
  }

  return {
    syncRequestAttempts,
    requestHostStateWithRetry,
    handleOutOfSync,
    fetchRoomStateFromStorage
  }
}
