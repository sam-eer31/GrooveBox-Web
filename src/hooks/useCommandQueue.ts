import { useRef } from 'react'
import type { Track } from '../types'

interface CommandQueueProps {
  tracks: Track[]
  currentIndex: number
  isPlaying: boolean
  isShuffle: boolean
  isHost: boolean
  channelRef: React.MutableRefObject<any>
  clientIdRef: React.MutableRefObject<string>
  audioRef: React.MutableRefObject<HTMLAudioElement | null>
  setCurrentIndex: (index: number) => void
  setCurrentTime: (time: number) => void
  setIsPlaying: (playing: boolean) => void
  setIsShuffle: (shuffle: boolean) => void
  shouldAutoplayRef: React.MutableRefObject<boolean>
  isApplyingRemoteRef: React.MutableRefObject<boolean>
  tracksRef: React.MutableRefObject<Track[]>
  currentIndexRef: React.MutableRefObject<number>
  isPlayingRef: React.MutableRefObject<boolean>
  isShuffleRef: React.MutableRefObject<boolean>
  suppressEnforcementRef: React.MutableRefObject<boolean>
  recordRoomNowAndHistory: (index: number) => Promise<void>
  startNowEnforcement: (index: number, time: number, playing?: boolean) => void
}

export function useCommandQueue({
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
}: CommandQueueProps) {
  // Global command queue for room-wide synchronization
  const globalCommandQueueRef = useRef<Array<{ command: string; payload: any; sender: string; timestamp: number }>>([])
  const isProcessingGlobalQueueRef = useRef<boolean>(false)
  // Monotonic sequence for ordering and dedupe
  const lastOutboundSeqRef = useRef<number>(0)

  const processGlobalQueue = async () => {
    if (isProcessingGlobalQueueRef.current) return
    
    if (globalCommandQueueRef.current.length === 0) return
    
    isProcessingGlobalQueueRef.current = true
    
    while (globalCommandQueueRef.current.length > 0) {
      const { command, payload, sender, timestamp } = globalCommandQueueRef.current.shift()!
      
      // Skip old commands (older than 5 seconds)
      if (Date.now() - timestamp > 5000) continue
      
      try {
        console.log(`Processing global command: ${command} from ${sender}`, payload)
        
        // Execute the command locally
        switch (command) {
          case 'play':
            await executePlayCommand(payload)
            break
          case 'pause':
            await executePauseCommand(payload)
            break
          case 'seek':
            await executeSeekCommand(payload)
            break
          case 'next':
            await executeNextCommand(payload)
            break
          case 'previous':
            await executePreviousCommand(payload)
            break
          case 'shuffle_toggle':
            await executeShuffleToggleCommand(payload)
            break
          case 'shuffle_next':
            await executeShuffleNextCommand(payload)
            break
          case 'select':
            await executeSelectCommand(payload)
            break
        }
        
        // Broadcast the executed command to all clients
        if (channelRef.current) {
          channelRef.current.send({
            type: 'broadcast',
            event: 'player:command_executed',
            payload: { command, payload, sender, timestamp }
          })
        }
        
      } catch (error) {
        console.warn(`Global command ${command} failed:`, error)
      }
    }
    
    isProcessingGlobalQueueRef.current = false
  }

  const enqueueGlobalCommand = (command: string, payload: any) => {
    const timestamp = Date.now()
    lastOutboundSeqRef.current += 1
    const seq = lastOutboundSeqRef.current
    const commandId = (crypto as any)?.randomUUID?.() || Math.random().toString(36).slice(2)
    globalCommandQueueRef.current.push({ command, payload, sender: clientIdRef.current, timestamp })
    
    // Broadcast to all clients to add to their queues
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'player:command_queued',
        payload: { command, payload, sender: clientIdRef.current, timestamp, seq, commandId }
      })
    }
    
    // Process queue immediately
    processGlobalQueue()
  }

  // Command execution handlers (same for all clients)
  const executePlayCommand = async (payload: any) => {
    const { index, time } = payload
    const audio = audioRef.current
    if (!audio) return
    
    if (index !== currentIndexRef.current) {
      setCurrentIndex(index)
      setCurrentTime(time)
      shouldAutoplayRef.current = true
      await new Promise(r => setTimeout(r, 100))
    }
    
    audio.currentTime = time
    await audio.play()
    setIsPlaying(true)

    // Host records now-playing + kicks off 3s enforcement window
    if (isHost && !suppressEnforcementRef.current) {
      try {
        await recordRoomNowAndHistory(index)
        startNowEnforcement(index, time)
      } catch (e) {
        console.log('record/enforce error:', e)
      }
    }
  }

  const executePauseCommand = async (payload: any) => {
    const { time } = payload
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = time
    }
    setIsPlaying(false)
    shouldAutoplayRef.current = false
    setCurrentTime(time)

    // Host also enforces paused state for 3s window
    if (isHost && !suppressEnforcementRef.current) {
      try {
        startNowEnforcement(currentIndexRef.current, time, false)
      } catch (e) {
        console.log('pause enforce error:', e)
      }
    }
  }

  const executeSeekCommand = async (payload: any) => {
    const { time } = payload
    const audio = audioRef.current
    if (audio) audio.currentTime = time
    setCurrentTime(time)
  }

  const executeNextCommand = async (payload: any) => {
    const total = tracksRef.current.length
    if (total === 0) return
    const fromIndex = typeof payload?.fromIndex === 'number' ? payload.fromIndex : currentIndexRef.current
    // If shuffle is active and a specific nextIndex is provided, honor it; otherwise compute sequential
    const providedIndex = typeof payload?.nextIndex === 'number' ? payload.nextIndex : null
    const nextIndex = providedIndex !== null ? providedIndex : (fromIndex + 1 + total) % total
    setCurrentIndex(nextIndex)
    setCurrentTime(0)
    shouldAutoplayRef.current = true
    // Host triggers explicit play so enforcement always runs for 3s
    if (isHost) {
      enqueueGlobalCommand('play', { index: nextIndex, time: 0 })
    }
  }

  const executePreviousCommand = async (payload: any) => {
    const total = tracksRef.current.length
    if (total === 0) return
    const fromIndex = typeof payload?.fromIndex === 'number' ? payload.fromIndex : currentIndexRef.current
    const providedIndex = typeof payload?.prevIndex === 'number' ? payload.prevIndex : null
    const prevIndex = providedIndex !== null ? providedIndex : (fromIndex - 1 + total) % total
    setCurrentIndex(prevIndex)
    setCurrentTime(0)
    shouldAutoplayRef.current = true
    // Host triggers explicit play so enforcement always runs for 3s
    if (isHost) {
      enqueueGlobalCommand('play', { index: prevIndex, time: 0 })
    }
  }

  const executeSelectCommand = async (payload: any) => {
    const { index } = payload
    setCurrentIndex(index)
    setCurrentTime(0)
    shouldAutoplayRef.current = true
  }

  // Shuffle command handlers
  const executeShuffleToggleCommand = async (payload: any) => {
    const { enabled } = payload as { enabled: boolean }
    setIsShuffle(Boolean(enabled))
  }

  const executeShuffleNextCommand = async (payload: any) => {
    const { nextIndex } = payload as { nextIndex: number }
    if (typeof nextIndex !== 'number') return
    await executeNextCommand({ fromIndex: currentIndexRef.current, nextIndex })
  }

  return {
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
  }
}
