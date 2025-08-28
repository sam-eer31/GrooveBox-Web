import React, { useMemo, useState } from 'react'
import { Eye, Pause, Play } from 'lucide-react'
import { useGlobalPlayerState } from '../hooks/useGlobalPlayerState'

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export default function GlobalTracker() {
  const { state, nowPositionMs } = useGlobalPlayerState()
  const [open, setOpen] = useState(false)

  const progress = useMemo(() => {
    const duration = state.duration_ms || 0
    const pos = Math.min(nowPositionMs, duration)
    return duration > 0 ? (pos / duration) * 100 : 0
  }, [state.duration_ms, nowPositionMs])

  return (
    <>
      <button
        className="fixed bottom-4 right-4 z-50 icon-btn bg-white/80 dark:bg-black/50 backdrop-blur"
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle Global Tracker"
        title="Global Tracker"
      >
        <Eye className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-80 panel p-3 shadow-lg animate-in">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{state.track_title || 'No track'}</div>
              <div className="text-xs text-black/60 dark:text-white/60 truncate">{state.track_artist || ''}</div>
            </div>
            <div className="text-xs px-2 py-1 rounded-md border border-black/10 dark:border-white/10">
              {state.status}
            </div>
          </div>

          <div className="mt-3">
            <div className="h-2 w-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-xs tabular-nums">
              <span>{formatTime(nowPositionMs)}</span>
              <span>{formatTime(state.duration_ms || 0)}</span>
            </div>
          </div>

          {/* Read-only UI. If later we add controller controls, show here conditionally. */}
          <div className="mt-3 flex items-center justify-end gap-2">
            {state.status === 'playing' ? (
              <button className="icon-btn opacity-60" disabled>
                <Pause className="h-4 w-4" />
              </button>
            ) : (
              <button className="icon-btn opacity-60" disabled>
                <Play className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}


