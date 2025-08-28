import { useEffect, useMemo, useRef, useState } from 'react'

export type GlobalPlayerStatus = 'playing' | 'paused' | 'stopped'

export type GlobalPlayerState = {
  track_id: string | null
  track_title: string | null
  track_artist: string | null
  duration_ms: number
  status: GlobalPlayerStatus
  position_ms: number
  last_updated_at: string
  updated_by: string | null
}

const DEFAULT_STATE: GlobalPlayerState = {
  track_id: null,
  track_title: null,
  track_artist: null,
  duration_ms: 0,
  status: 'stopped',
  position_ms: 0,
  last_updated_at: new Date().toISOString(),
  updated_by: null,
}

/**
 * Fetch initial state once and subscribe to Realtime updates if available.
 * Falls back to polling every 5s if Realtime env is not configured.
 */
export function useGlobalPlayerState() {
  const [state, setState] = useState<GlobalPlayerState>(DEFAULT_STATE)
  const [connected, setConnected] = useState(false)
  const pollingRef = useRef<number | null>(null)

  // Derived current position from base state
  const nowPositionMs = useMemo(() => {
    if (!state) return 0
    const base = state.position_ms || 0
    if (state.status !== 'playing') return Math.min(base, state.duration_ms || 0)
    const last = new Date(state.last_updated_at).getTime()
    const delta = Date.now() - last
    return Math.min(base + Math.max(0, delta), state.duration_ms || 0)
  }, [state])

  useEffect(() => {
    let aborted = false

    const fetchOnce = async () => {
      try {
        const res = await fetch('/api/global-player/state')
        if (!res.ok) throw new Error('Failed initial fetch')
        const data = await res.json()
        if (!aborted) setState(data)
      } catch (_) {}
    }

    const startPolling = () => {
      if (pollingRef.current != null) return
      pollingRef.current = window.setInterval(fetchOnce, 5000)
    }

    const stopPolling = () => {
      if (pollingRef.current != null) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }

    fetchOnce()
    // For now, rely on polling-only. Can be upgraded to Realtime later.
    setConnected(false)
    startPolling()

    return () => {
      aborted = true
      if (pollingRef.current != null) clearInterval(pollingRef.current)
    }
  }, [])

  return {
    state,
    connected,
    nowPositionMs,
  }
}


