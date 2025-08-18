import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient'

type Track = {
  id: string
  file?: File
  url: string
  name: string
  path: string
}

const ACCEPTED_TYPES = [
  'audio/mpeg', // mp3
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave'
]

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function App(): JSX.Element {
  const [roomCode, setRoomCode] = useState<string>('')
  const [joinCodeInput, setJoinCodeInput] = useState<string>('')
  const [inRoom, setInRoom] = useState<boolean>(false)
  const [isHost, setIsHost] = useState<boolean>(false)
  const [tracks, setTracks] = useState<Track[]>([])
  const [currentIndex, setCurrentIndex] = useState<number>(-1)
  const [error, setError] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isUploading, setIsUploading] = useState(false)
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false)
  const [displayName, setDisplayName] = useState<string>('')
  const [roomTitle, setRoomTitle] = useState<string>('')
  const [roomTitleInput, setRoomTitleInput] = useState<string>('')

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const shouldAutoplayRef = useRef<boolean>(false)
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null)
  const clientIdRef = useRef<string>('')
  const isApplyingRemoteRef = useRef<boolean>(false)

  // Cleanup local object URLs on unmount
  useEffect(() => {
    return () => {
      tracks.forEach(t => {
        if (t.url.startsWith('blob:')) URL.revokeObjectURL(t.url)
      })
    }
  }, [tracks])

  // Reflect volume changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
    }
  }, [volume])

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
    if (!supabase) {
      setError('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server.')
      return
    }
    if (!inRoom || !roomCode) {
      setError('Join or create a room before uploading.')
      return
    }
    const accepted: File[] = []
    let unsupported = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const lowerName = file.name.toLowerCase()
      const isAccepted = ACCEPTED_TYPES.includes(file.type) || lowerName.endsWith('.mp3') || lowerName.endsWith('.wav')
      if (!isAccepted) {
        unsupported++
      } else {
        accepted.push(file)
      }
    }

    if (accepted.length === 0) {
      setError('Unsupported file type. Please upload MP3 or WAV files.')
      return
    }

    setIsUploading(true)
    setError(unsupported > 0 ? `${unsupported} file(s) were skipped (unsupported type).` : null)
    try {
      const uploadedTracks: Track[] = []
      for (const file of accepted) {
        const path = `rooms/${roomCode}/${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}-${file.name}`
        const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
          contentType: file.type || 'audio/mpeg',
          upsert: false
        })
        if (upErr) {
          setError(`Upload failed for ${file.name}: ${upErr.message}`)
          continue
        }

        // Prefer signed URL so it works even if bucket is private
        const { data: signed, error: signErr } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7)
        if (signErr || !signed?.signedUrl) {
          // Try public URL fallback
          const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path)
          if (!pub?.publicUrl) {
            setError(`Could not generate URL for ${file.name}`)
            continue
          }
          uploadedTracks.push({
            id: path,
            file,
            url: pub.publicUrl,
            name: file.name,
            path
          })
        } else {
          uploadedTracks.push({
            id: path,
            file,
            url: signed.signedUrl,
            name: file.name,
            path
          })
        }
      }

      if (uploadedTracks.length > 0) {
        setTracks(prev => {
          const next = [...prev, ...uploadedTracks]
          if (prev.length === 0) {
            setCurrentIndex(0)
            shouldAutoplayRef.current = true
          }
          return next
        })
        setIsPlaying(false)
        setCurrentTime(0)
        if (channelRef.current) {
          const payload = uploadedTracks.map(t => ({ path: t.path, name: t.name }))
          channelRef.current.send({ type: 'broadcast', event: 'playlist:add', payload: { items: payload, sender: clientIdRef.current } })
        }
      }
    } finally {
      setIsUploading(false)
    }
  }

  // Load existing songs for the current room
  useEffect(() => {
    const loadFromSupabase = async () => {
      if (!supabase || !inRoom || !roomCode) return
      const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
      setIsLoadingLibrary(true)
      try {
        const prefix = `rooms/${roomCode}`
        const { data: files, error: listErr } = await supabase.storage.from(bucket).list(prefix, {
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
        for (const f of files) {
          const path = `${prefix}/${f.name}`
          const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7)
          const url = signed?.signedUrl || supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
          if (!url) continue
          loaded.push({ id: path, url, name: f.name, path })
        }

        setTracks(loaded)
        setCurrentIndex(loaded.length > 0 ? 0 : -1)
        setCurrentTime(0)
      } finally {
        setIsLoadingLibrary(false)
      }
    }

    loadFromSupabase()
  }, [inRoom, roomCode])

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onFiles(e.dataTransfer.files)
  }

  const onDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const togglePlay = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try {
        await audio.play()
        setIsPlaying(true)
        if (channelRef.current) {
          channelRef.current.send({ type: 'broadcast', event: 'player:play', payload: { index: Math.max(0, currentIndex), time: audio.currentTime, sender: clientIdRef.current } })
        }
      } catch (err) {
        setError('Unable to play the audio in this browser.')
      }
    } else {
      audio.pause()
      setIsPlaying(false)
      if (channelRef.current) {
        channelRef.current.send({ type: 'broadcast', event: 'player:pause', payload: { time: audio.currentTime, sender: clientIdRef.current } })
      }
    }
  }

  const playCurrent = async () => {
    const audio = audioRef.current
    if (!audio) return
    try {
      await audio.play()
      setIsPlaying(true)
    } catch {
      // ignore
    }
  }

  const onLoadedMetadata: React.ReactEventHandler<HTMLAudioElement> = (e) => {
    const el = e.currentTarget
    setDuration(el.duration)
  }

  const onTimeUpdate: React.ReactEventHandler<HTMLAudioElement> = (e) => {
    setCurrentTime(e.currentTarget.currentTime)
  }

  const onSeek = (value: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = value
    setCurrentTime(value)
    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'player:seek', payload: { time: value, sender: clientIdRef.current } })
    }
  }

  const currentTrack = tracks[currentIndex] ?? null
  const fileName = useMemo(() => currentTrack?.name ?? 'No track selected', [currentTrack])

  const hasPrevious = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < tracks.length - 1

  const goPrevious = () => {
    if (!hasPrevious) return
    setCurrentIndex(idx => Math.max(0, idx - 1))
    setCurrentTime(0)
    shouldAutoplayRef.current = true
    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'player:previous', payload: { sender: clientIdRef.current } })
    }
  }

  const goNext = () => {
    if (!hasNext) return
    setCurrentIndex(idx => Math.min(tracks.length - 1, idx + 1))
    setCurrentTime(0)
    shouldAutoplayRef.current = true
    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'player:next', payload: { sender: clientIdRef.current } })
    }
  }

  // When metadata loads for a new track, autoplay if flagged
  useEffect(() => {
    if (!currentTrack) return
    const audio = audioRef.current
    if (!audio) return
    const handleLoaded = async () => {
      if (shouldAutoplayRef.current) {
        shouldAutoplayRef.current = false
        await playCurrent()
      }
    }
    audio.addEventListener('loadedmetadata', handleLoaded)
    return () => audio.removeEventListener('loadedmetadata', handleLoaded)
  }, [currentTrack?.url])

  const cleanupRoomState = () => {
    setInRoom(false)
    setIsHost(false)
    setRoomCode('')
    setTracks([])
    setCurrentIndex(-1)
    setIsPlaying(false)
    setCurrentTime(0)
  }

  const endRoom = async () => {
    if (!isHost || !supabase || !roomCode) return
    const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
    try {
      const { data: files } = await supabase.storage.from(bucket).list(`rooms/${roomCode}`, { limit: 100 })
      const paths = (files || []).map(f => `rooms/${roomCode}/${f.name}`)
      if (paths.length > 0) await supabase.storage.from(bucket).remove(paths)
    } catch {}
    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'room:ended', payload: { sender: clientIdRef.current } })
    }
    cleanupRoomState()
  }

  useEffect(() => {
    const handler = () => {
      if (isHost) void endRoom()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isHost, roomCode])

  const generateRoomCode = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code = ''
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
    return code
  }

  const createRoom = async () => {
    if (!supabase) { setError('Supabase not configured'); return }
    if (!displayName.trim()) { setError('Please enter your name'); return }
    const code = generateRoomCode()
    setRoomCode(code)
    setIsHost(true)
    setInRoom(true)
    try {
      const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
      const meta = { roomName: roomTitleInput.trim(), hostName: displayName.trim(), createdAt: new Date().toISOString() }
      const metaBlob = new Blob([JSON.stringify(meta)], { type: 'application/json' })
      await supabase.storage.from(bucket).upload(`rooms/${code}/meta.json`, metaBlob, { upsert: true, cacheControl: 'no-cache' })
      setRoomTitle(meta.roomName || '')
    } catch {}
  }

  const joinRoom = async () => {
    if (!supabase) { setError('Supabase not configured'); return }
    const code = joinCodeInput.trim().toUpperCase()
    if (!displayName.trim()) { setError('Please enter your name'); return }
    if (!code) return
    setRoomCode(code)
    setIsHost(false)
    setInRoom(true)
  }

  // Realtime: subscribe to room events (must be before any early return)
  useEffect(() => {
    if (!inRoom || !roomCode || !supabase) return
    if (!clientIdRef.current) clientIdRef.current = crypto.randomUUID?.() || Math.random().toString(36).slice(2)

    const ch = supabase.channel(`room-${roomCode}`, { config: { broadcast: { self: false } } })

    ch.on('broadcast', { event: 'playlist:add' }, async ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      const items = (payload.items as Array<{ path: string; name: string }>) || []
      const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
      const added: Track[] = []
      for (const it of items) {
        const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(it.path, 60 * 60 * 24 * 7)
        const url = signed?.signedUrl || supabase.storage.from(bucket).getPublicUrl(it.path).data.publicUrl
        if (!url) continue
        added.push({ id: it.path, url, name: it.name, path: it.path })
      }
      if (added.length > 0) {
        setTracks(prev => [...prev, ...added])
      }
    })

    ch.on('broadcast', { event: 'player:play' }, ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      isApplyingRemoteRef.current = true
      const { index, time } = payload as { index: number; time: number }
      setCurrentIndex(index)
      setCurrentTime(time)
      shouldAutoplayRef.current = true
      setTimeout(() => { isApplyingRemoteRef.current = false }, 0)
    })

    ch.on('broadcast', { event: 'player:pause' }, ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      isApplyingRemoteRef.current = true
      const { time } = payload as { time: number }
      const audio = audioRef.current
      if (audio) {
        audio.pause()
        audio.currentTime = time
      }
      setIsPlaying(false)
      setTimeout(() => { isApplyingRemoteRef.current = false }, 0)
    })

    ch.on('broadcast', { event: 'player:seek' }, ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      const { time } = payload as { time: number }
      isApplyingRemoteRef.current = true
      const audio = audioRef.current
      if (audio) audio.currentTime = time
      setCurrentTime(time)
      setTimeout(() => { isApplyingRemoteRef.current = false }, 0)
    })

    ch.on('broadcast', { event: 'player:next' }, () => {
      isApplyingRemoteRef.current = true
      goNext()
      setTimeout(() => { isApplyingRemoteRef.current = false }, 0)
    })

    ch.on('broadcast', { event: 'player:previous' }, () => {
      isApplyingRemoteRef.current = true
      goPrevious()
      setTimeout(() => { isApplyingRemoteRef.current = false }, 0)
    })

    ch.on('broadcast', { event: 'player:select' }, ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      const { index } = payload as { index: number }
      isApplyingRemoteRef.current = true
      setCurrentIndex(index)
      setCurrentTime(0)
      shouldAutoplayRef.current = true
      setTimeout(() => { isApplyingRemoteRef.current = false }, 0)
    })

    ch.on('broadcast', { event: 'room:ended' }, () => {
      cleanupRoomState()
    })

    ch.subscribe()
    channelRef.current = ch

    return () => {
      ch.unsubscribe()
      channelRef.current = null
    }
  }, [inRoom, roomCode])

  // Render based on state; hooks above are unconditional to preserve order
  if (!inRoom) {
    return (
      <div className="min-h-full flex flex-col">
        <header className="p-6 md:p-8">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-brand-500/20 ring-1 ring-brand-500/30 grid place-items-center">
                <span className="text-brand-500 font-bold">♪</span>
              </div>
              <h1 className="text-xl font-semibold tracking-tight">GrooveBox Rooms</h1>
            </div>
          </div>
        </header>
        <main className="flex-1">
          <div className="max-w-md mx-auto px-6 md:px-8">
            <div className="bg-slate-800/60 rounded-xl p-6 ring-1 ring-white/5">
              <h2 className="font-semibold">Listen together</h2>
              <p className="mt-1 text-sm text-slate-400">Create a room or join with a code.</p>
              <div className="mt-6 grid gap-4">
                <div className="grid gap-2">
                  <label className="text-xs text-slate-400">Your Name</label>
                  <input value={displayName} onChange={(e)=>setDisplayName(e.currentTarget.value)} placeholder="e.g. Alex" className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:border-brand-500/60" />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs text-slate-400">Room Name (optional for host)</label>
                  <input value={roomTitleInput} onChange={(e)=>setRoomTitleInput(e.currentTarget.value)} placeholder="e.g. Friday Jam" className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:border-brand-500/60" />
                </div>
                <button onClick={createRoom} className="rounded-md bg-brand-500 text-slate-900 font-medium px-4 py-2">Create Room</button>
                <div className="flex gap-2">
                  <input value={joinCodeInput} onChange={(e)=>setJoinCodeInput(e.currentTarget.value)} placeholder="Enter room code" className="flex-1 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:border-brand-500/60" />
                  <button onClick={joinRoom} className="rounded-md border border-slate-700 px-4 py-2 hover:border-brand-500/60">Join</button>
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
              </div>
            </div>
          </div>
        </main>
        <footer className="px-6 md:px-8 py-8 text-center text-xs text-slate-500">Built with React, Vite, and Tailwind</footer>
      </div>
    )
  }
  

  return (
    <div className="min-h-full flex flex-col">
      <header className="p-6 md:p-8">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-brand-500/20 ring-1 ring-brand-500/30 grid place-items-center">
              <span className="text-brand-500 font-bold">♪</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">GrooveBox</h1>
              <p className="text-xs text-slate-400">Room: <span className="font-mono">{roomCode}</span> {isHost && <span className="ml-2 text-brand-500">(Host)</span>} {roomTitle && <span className="ml-2">· {roomTitle}</span>}</p>
            </div>
          </div>

          <button
            onClick={() => inputRef.current?.click()}
            className="rounded-md bg-brand-500 text-slate-900 font-medium px-4 py-2 hover:brightness-110 active:brightness-110 transition disabled:opacity-50"
          >
            Upload
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.currentTarget.files)}
          />
          {isHost && (
            <button onClick={endRoom} className="ml-3 rounded-md border border-red-500/60 text-red-300 px-4 py-2 hover:bg-red-500/10">End Room</button>
          )}
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-6 md:px-8">
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            className="border-2 border-dashed border-slate-700 rounded-xl p-8 md:p-12 text-center hover:border-brand-500/60 transition"
          >
            <p className="text-slate-300">Drag and drop songs here, or</p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-3 rounded-md border border-slate-700 px-4 py-2 hover:border-brand-500/60 hover:text-brand-500 transition"
            >
              Choose Files
            </button>

            {isUploading && (
              <p className="mt-4 text-sm text-slate-300">Uploading...</p>
            )}
            {isLoadingLibrary && (
              <p className="mt-2 text-sm text-slate-400">Loading your library…</p>
            )}
            {error && (
              <p className="mt-2 text-sm text-red-400">{error}</p>
            )}
          </div>

          {/* Playlist */}
          <div className="mt-8">
            <div className="bg-slate-800/40 rounded-xl p-5 ring-1 ring-white/5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm uppercase tracking-wide text-slate-400">Playlist</h3>
                <span className="text-xs text-slate-500">{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>
              </div>
              {tracks.length === 0 ? (
                <p className="text-slate-400 text-sm">No songs yet. Upload MP3 or WAV files to get started.</p>
              ) : (
                <ul className="divide-y divide-slate-700/40">
                  {tracks.map((t, idx) => {
                    const active = idx === currentIndex
                    return (
                      <li key={t.id}>
                        <button
                          className={`w-full text-left px-3 py-2 rounded-md hover:bg-slate-700/30 transition ${active ? 'bg-slate-700/30 text-brand-500' : ''}`}
                          onClick={() => {
                            setCurrentIndex(idx)
                            setCurrentTime(0)
                            shouldAutoplayRef.current = true
                            if (channelRef.current) {
                              channelRef.current.send({ type: 'broadcast', event: 'player:select', payload: { index: idx, sender: clientIdRef.current } })
                            }
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs w-6 text-slate-400">{idx + 1}</span>
                            <span className="truncate" title={t.name}>{t.name}</span>
                            {active && isPlaying && <span aria-hidden className="ml-auto text-xs">▶</span>}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Player */}
          <div className="mt-8">
            <div className="bg-slate-800/60 rounded-xl p-5 md:p-6 ring-1 ring-white/5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="truncate">
                  <p className="text-sm uppercase tracking-wide text-slate-400">Now Playing</p>
                  <h2 className="mt-1 font-medium truncate" title={fileName}>{fileName}</h2>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={goPrevious}
                    disabled={!hasPrevious}
                    className="h-10 w-10 rounded-full bg-slate-700 text-slate-200 grid place-items-center disabled:opacity-40"
                    aria-label="Previous"
                  >
                    «
                  </button>
                  <button
                    onClick={togglePlay}
                    disabled={!currentTrack}
                    className="h-10 w-10 rounded-full bg-brand-500 text-slate-900 grid place-items-center disabled:opacity-50"
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? '❚❚' : '►'}
                  </button>
                  <button
                    onClick={goNext}
                    disabled={!hasNext}
                    className="h-10 w-10 rounded-full bg-slate-700 text-slate-200 grid place-items-center disabled:opacity-40"
                    aria-label="Next"
                  >
                    »
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                <div className="md:col-span-4">
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={currentTime}
                    onChange={(e) => onSeek(Number(e.currentTarget.value))}
                    className="w-full accent-brand-500"
                    disabled={!currentTrack}
                  />
                  <div className="mt-1 flex justify-between text-xs text-slate-400">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>
                <div className="md:col-span-1 flex items-center gap-2">
                  <span className="text-xs text-slate-400">Vol</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => setVolume(Number(e.currentTarget.value))}
                    className="w-full accent-brand-500"
                  />
                </div>
              </div>

              {/* Audio element */}
              <audio
                ref={audioRef}
                src={currentTrack?.url}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                onEnded={() => {
                  if (hasNext) {
                    goNext()
                  } else {
                    setIsPlaying(false)
                    setCurrentTime(0)
                    shouldAutoplayRef.current = false
                  }
                }}
                className="hidden"
                controls
              />
            </div>
          </div>
        </div>
      </main>

      <footer className="px-6 md:px-8 py-8 text-center text-xs text-slate-500">
        Built with React, Vite, and Tailwind · Plays locally in your browser
      </footer>
    </div>
  )
}


