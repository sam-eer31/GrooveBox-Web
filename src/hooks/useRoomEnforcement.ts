import { useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { logSupabaseUploadError } from '../utils'

interface UseRoomEnforcementProps {
  roomCode: string
  tracksRef: React.MutableRefObject<any[]>
  displayNameRef: React.MutableRefObject<string>
  isHostRef: React.MutableRefObject<boolean>
  channelRef: React.MutableRefObject<any>
  clientIdRef: React.MutableRefObject<string>
  participantNowRef: React.MutableRefObject<Map<string, { index: number; updatedAt: number }>>
  clientIdToNameRef: React.MutableRefObject<Map<string, string>>
}

export function useRoomEnforcement({
  roomCode,
  tracksRef,
  displayNameRef,
  isHostRef,
  channelRef,
  clientIdRef,
  participantNowRef,
  clientIdToNameRef
}: UseRoomEnforcementProps) {
  // Host authority and enforcement helpers
  const roomEnforcementTimerRef = useRef<NodeJS.Timeout | null>(null)
  const roomEnforcementEndAtRef = useRef<number>(0)
  const roomEnforcementIndexRef = useRef<number>(-1)
  const roomNowStartedAtRef = useRef<number>(0)
  const suppressEnforcementRef = useRef<boolean>(false)
  const lastListenersWriteAtRef = useRef<number>(0)
  const roomExpectedPlayingRef = useRef<boolean>(true)
  const roomExpectedFrozenElapsedRef = useRef<number>(0)
  // Meta write guards
  const disableMetaWritesRef = useRef<boolean>(false)
  const lastNowRecordIndexRef = useRef<number>(-1)
  const lastNowRecordAtRef = useRef<number>(0)

  // Persist the room's now playing and append history (host only)
  const recordRoomNowAndHistory = async (index: number) => {
    const sb = supabase
    if (!sb || !roomCode) return
    const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
    const prefix = `rooms/${roomCode}`
    const track = tracksRef.current[index]
    const nowEntry = {
      index,
      trackId: track?.id || track?.path || null,
      trackName: track?.name || null,
      startedAt: new Date().toISOString(),
      startedBy: displayNameRef.current || 'Host',
    }
    // Skip if meta writes were disabled due to previous failures
    if (disableMetaWritesRef.current) return
    // Throttle: only once per index within 3s window
    if (lastNowRecordIndexRef.current === index && Date.now() - lastNowRecordAtRef.current < 3000) return
    try {
      const nowBlob = new Blob([JSON.stringify(nowEntry)], { type: 'application/json' })
      await sb.storage.from(bucket).upload(`${prefix}/meta/now.json`, nowBlob, { upsert: true, cacheControl: 'no-cache' })
      lastNowRecordIndexRef.current = index
      lastNowRecordAtRef.current = Date.now()
    } catch (e) {
      logSupabaseUploadError('now.json', e)
      disableMetaWritesRef.current = true
      return
    }
    try {
      let history: any[] = []
      try {
        const { data } = await sb.storage.from(bucket).download(`${prefix}/meta/history.json`)
        if (data) {
          const text = await data.text()
          history = JSON.parse(text)
          if (!Array.isArray(history)) history = []
        }
      } catch {}
      history.push(nowEntry)
      const histBlob = new Blob([JSON.stringify(history)], { type: 'application/json' })
      await sb.storage.from(bucket).upload(`${prefix}/meta/history.json`, histBlob, { upsert: true, cacheControl: 'no-cache' })
    } catch (e) {
      logSupabaseUploadError('history.json', e)
      disableMetaWritesRef.current = true
    }
  }

  // Start 3s enforcement window to ensure all clients are on the same track and play/pause state
  const startNowEnforcement = (index: number, time: number, expectedPlaying: boolean = true) => {
    const ch = channelRef.current
    if (!ch) return
    roomEnforcementIndexRef.current = index
    roomNowStartedAtRef.current = Date.now() - Math.floor(time * 1000)
    roomEnforcementEndAtRef.current = Date.now() + 3000
    roomExpectedPlayingRef.current = expectedPlaying
    roomExpectedFrozenElapsedRef.current = expectedPlaying ? 0 : Math.max(0, Math.floor(time))

    // Announce now playing to all
    try {
      ch.send({
        type: 'broadcast',
        event: 'room:now_playing',
        payload: { sender: clientIdRef.current, index, startedAt: roomNowStartedAtRef.current }
      })
    } catch {}

    // Clear any previous timer
    if (roomEnforcementTimerRef.current) {
      clearInterval(roomEnforcementTimerRef.current)
      roomEnforcementTimerRef.current = null
    }

    const sendVerify = () => {
      try {
        const expectedPlaying = roomExpectedPlayingRef.current
        const expectedElapsed = expectedPlaying
          ? Math.max(0, Math.floor((Date.now() - roomNowStartedAtRef.current) / 1000))
          : roomExpectedFrozenElapsedRef.current
        ch.send({
          type: 'broadcast',
          event: 'room:verify_now',
          payload: { sender: clientIdRef.current, expectedIndex: index, expectedElapsed, expectedPlaying }
        })
      } catch {}
    }

    // Immediate verify ping, then poll clients every 250ms within the 3s window
    sendVerify()
    roomEnforcementTimerRef.current = setInterval(() => {
      const now = Date.now()
      if (now > roomEnforcementEndAtRef.current) {
        // Write a final listeners snapshot at the end of the window
        try { if (!disableMetaWritesRef.current) void writeListenersSnapshot() } catch {}
        if (roomEnforcementTimerRef.current) {
          clearInterval(roomEnforcementTimerRef.current)
          roomEnforcementTimerRef.current = null
        }
        return
      }
      sendVerify()
    }, 250)
  }

  // Persist snapshot of what each participant is listening to (host only)
  const writeListenersSnapshot = async () => {
    const sb = supabase
    if (!sb || !roomCode || !isHostRef.current) return
    const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
    const prefix = `rooms/${roomCode}`
    const snapshot: Array<{ clientId: string; name: string; index: number; updatedAt: string }> = []
    participantNowRef.current.forEach((val, key) => {
      const name = clientIdToNameRef.current.get(key) || (key === clientIdRef.current ? (displayNameRef.current || 'Host') : 'Guest')
      snapshot.push({ clientId: key, name, index: val.index, updatedAt: new Date(val.updatedAt).toISOString() })
    })
    try {
      const blob = new Blob([JSON.stringify({ updatedAt: new Date().toISOString(), listeners: snapshot })], { type: 'application/json' })
      await sb.storage.from(bucket).upload(`${prefix}/meta/listeners.json`, blob, { upsert: true, cacheControl: 'no-cache' })
    } catch (e) {
      logSupabaseUploadError('listeners.json', e)
    }
  }

  return {
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
  }
}

