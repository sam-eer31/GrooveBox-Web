import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Music, Sun, Moon, Upload as UploadIcon, Power, LogOut, Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react'
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
  'audio/wave',
  'audio/aac',
  'audio/mp4', // m4a subtype on some platforms
  'audio/m4a',
  'audio/x-m4a'
]

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function deriveDisplayNameFromObjectName(objectName: string): string {
  // Matches UUID prefixes we add during upload: <uuid>-<original-name>
  const uuidPrefixPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-(.+)$/
  const match = objectName.match(uuidPrefixPattern)
  return match ? match[1] : objectName
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
  const [createName, setCreateName] = useState<string>('')
  const [joinName, setJoinName] = useState<string>('')
  const [roomTitle, setRoomTitle] = useState<string>('')
  const [roomTitleInput, setRoomTitleInput] = useState<string>('')
  const [participants, setParticipants] = useState<Array<{ key: string; name: string }>>([])
  const [toast, setToast] = useState<string | null>(null)
  const [playbackBlocked, setPlaybackBlocked] = useState<boolean>(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('groovebox_theme') as 'light' | 'dark') || 'dark')
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const shouldAutoplayRef = useRef<boolean>(false)
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null)
  const clientIdRef = useRef<string>('')
  const isApplyingRemoteRef = useRef<boolean>(false)
  const pendingRemotePlayRef = useRef<{ index: number; time: number } | null>(null)
  const tracksRef = useRef<Track[]>([])
  const currentIndexRef = useRef<number>(-1)

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
      const type = file.type || ''
      const isAccepted = ACCEPTED_TYPES.includes(type)
        || lowerName.endsWith('.mp3')
        || lowerName.endsWith('.wav')
        || lowerName.endsWith('.m4a')
        || lowerName.endsWith('.aac')
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
        // Optionally persist track metadata (display names) to tracks.json
        const shouldWriteMeta = (import.meta.env.VITE_ENABLE_TRACKS_META as string) === '1'
        if (shouldWriteMeta) {
          try {
            const metaPath = `rooms/${roomCode}/tracks.json`
            const { data: existing } = await supabase.storage.from(bucket).download(metaPath)
            let trackMeta: Array<{ path: string; name: string }> = []
            if (existing) {
              try { trackMeta = JSON.parse(await existing.text()) as Array<{ path: string; name: string }> } catch {}
            }
            const toAppend = uploadedTracks.map(t => ({ path: t.path, name: t.name }))
            // Merge unique by path
            const seen = new Set(trackMeta.map(i => i.path))
            for (const it of toAppend) { if (!seen.has(it.path)) trackMeta.push(it) }
            const blob = new Blob([JSON.stringify(trackMeta, null, 2)], { type: 'application/json' })
            await supabase.storage.from(bucket).upload(metaPath, blob, { upsert: true })
          } catch {}
        }

        setTracks(prev => {
          const next = [...prev, ...uploadedTracks]
          if (prev.length === 0) {
            setCurrentIndex(0)
            // Do not autoplay on upload; wait for explicit play action
            shouldAutoplayRef.current = false
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

  // Load existing songs and room meta for the current room
  useEffect(() => {
    const loadFromSupabase = async () => {
      if (!supabase || !inRoom || !roomCode) return
      const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
      setIsLoadingLibrary(true)
      try {
        const prefix = `rooms/${roomCode}`
        // Load room meta
        try {
          const { data: metaFile } = await supabase.storage.from(bucket).download(`${prefix}/meta.json`)
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
            const { data: tracksFile } = await supabase.storage.from(bucket).download(`${prefix}/tracks.json`)
            if (tracksFile) {
              const text = await tracksFile.text()
              const list = JSON.parse(text) as Array<{ path: string; name: string }>
              list.forEach(it => nameByPath.set(it.path, it.name))
            }
          }
        } catch {}
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
          if (f.name === 'meta.json') continue
          if (f.name === 'tracks.json') continue
          const path = `${prefix}/${f.name}`
          const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7)
          const url = signed?.signedUrl || supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
          if (!url) continue
          const displayName = nameByPath.get(path) || deriveDisplayNameFromObjectName(f.name)
          loaded.push({ id: path, url, name: displayName, path })
        }

        setTracks(loaded)
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

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onFiles(e.dataTransfer.files)
  }

  const onDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const broadcastState = (event: 'play' | 'pause', payload: any) => {
    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: `player:${event}`, payload: { ...payload, sender: clientIdRef.current } })
    }
  }

  const togglePlay = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try {
        await audio.play()
        setIsPlaying(true)
        broadcastState('play', { index: Math.max(0, currentIndexRef.current), time: audio.currentTime })
      } catch (err) {
        setError('Unable to play the audio in this browser.')
      }
    } else {
      audio.pause()
      setIsPlaying(false)
      broadcastState('pause', { time: audio.currentTime })
    }
  }

  const playCurrent = async () => {
    const audio = audioRef.current
    if (!audio) return
    try {
      await audio.play()
      setIsPlaying(true)
    } catch (err) {
      // Likely autoplay is blocked until user interacts
      setPlaybackBlocked(true)
    }
  }

  const unlockPlayback = async () => {
    const audio = audioRef.current
    if (!audio) { setPlaybackBlocked(false); return }
    try {
      const pending = pendingRemotePlayRef.current
      if (pending) {
        pendingRemotePlayRef.current = null
        const { index, time } = pending
        if (currentIndexRef.current !== index) {
          setCurrentIndex(index)
          setCurrentTime(time)
          shouldAutoplayRef.current = true
          // Wait a tick for state to propagate and metadata to load
          await new Promise(resolve => setTimeout(resolve, 0))
        } else {
          audio.currentTime = time
        }
      }
      await audio.play()
      setIsPlaying(true)
      setPlaybackBlocked(false)
    } catch {
      // If still blocked, leave banner visible
    }
  }

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
    const hasPrev = currentIndexRef.current > 0
    if (!hasPrev) return
    const nextIndex = Math.max(0, currentIndexRef.current - 1)
    setCurrentIndex(nextIndex)
    setCurrentTime(0)
    shouldAutoplayRef.current = true
    if (channelRef.current && !isApplyingRemoteRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'player:previous', payload: { sender: clientIdRef.current } })
    }
  }

  const goNext = () => {
    const hasN = currentIndexRef.current >= 0 && currentIndexRef.current < tracksRef.current.length - 1
    if (!hasN) return
    const nextIndex = Math.min(tracksRef.current.length - 1, currentIndexRef.current + 1)
    setCurrentIndex(nextIndex)
    setCurrentTime(0)
    shouldAutoplayRef.current = true
    if (channelRef.current && !isApplyingRemoteRef.current) {
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
      const limit = 100
      let offset = 0
      while (true) {
        const { data: files, error: listErr } = await supabase.storage.from(bucket).list(`rooms/${roomCode}`, { limit, offset, sortBy: { column: 'name', order: 'asc' } })
        if (listErr) break
        const batch = (files || []).map(f => `rooms/${roomCode}/${f.name}`)
        if (batch.length === 0) break
        // Remove in chunks to avoid limits
        const chunkSize = 100
        for (let i = 0; i < batch.length; i += chunkSize) {
          const chunk = batch.slice(i, i + chunkSize)
          await supabase.storage.from(bucket).remove(chunk)
        }
        if (batch.length < limit) break
        offset += limit
      }
      // Attempt to remove the now-empty folder marker by uploading a tombstone and removing it (some providers keep a prefix until a write occurs)
      try {
        const tomb = new Blob([" "])
        await supabase.storage.from(bucket).upload(`rooms/${roomCode}/.tomb`, tomb, { upsert: true })
        await supabase.storage.from(bucket).remove([`rooms/${roomCode}/.tomb`])
      } catch {}
      // Finally, remove meta.json explicitly in case it was cached/generated late
      try {
        await supabase.storage.from(bucket).remove([`rooms/${roomCode}/meta.json`])
      } catch {}
      // Write an ended flag so clients won't restore into a deleted room even if some cached URLs exist
      try {
        const endedBlob = new Blob([JSON.stringify({ code: roomCode, endedAt: new Date().toISOString() })], { type: 'application/json' })
        await supabase.storage.from(bucket).upload(`ended/${roomCode}.json`, endedBlob, { upsert: true, cacheControl: 'no-cache' })
      } catch {}
    } catch {}
    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'room:ended', payload: { sender: clientIdRef.current } })
    }
    cleanupRoomState()
    try {
      localStorage.removeItem('groovebox_room')
      localStorage.removeItem('groovebox_is_host')
    } catch {}
  }

  const leaveRoom = async () => {
    try { localStorage.removeItem('groovebox_room') } catch {}
    try { localStorage.removeItem('groovebox_is_host') } catch {}
    if (channelRef.current) {
      channelRef.current.unsubscribe()
      channelRef.current = null
    }
    cleanupRoomState()
  }

  // Do not end the room automatically on refresh/navigation.
  // Hosts remain hosts after refresh; room persists until explicitly ended.
  useEffect(() => {
    const handler = () => {}
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const generateRoomCode = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code = ''
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
    return code
  }

  const roomExists = async (code: string): Promise<boolean> => {
    if (!supabase) return false
    const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
    try {
      const { data: list } = await supabase.storage.from(bucket).list(`rooms/${code}`, {
        limit: 1,
        search: 'meta.json'
      })
      return Array.isArray(list) && list.some(f => f.name === 'meta.json')
    } catch {
      return false
    }
  }

  const roomEndedFlagExists = async (code: string): Promise<boolean> => {
    if (!supabase) return false
    const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
    try {
      const { data: list } = await supabase.storage.from(bucket).list('ended', {
        limit: 1,
        search: `${code}.json`
      })
      return Array.isArray(list) && list.some(f => f.name === `${code}.json`)
    } catch {
      return false
    }
  }

  const roomIsActive = async (code: string): Promise<boolean> => {
    const ended = await roomEndedFlagExists(code)
    if (ended) return false
    return await roomExists(code)
  }

  const generateUniqueRoomCode = async (): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateRoomCode()
      if (!supabase) return code
      const exists = await roomExists(code)
      if (!exists) return code
    }
    return generateRoomCode()
  }

  const createRoom = async () => {
    setError(null)
    if (!supabase) { setError('Supabase not configured'); return }
    const name = (createName || displayName).trim()
    if (!name) { setError('Please enter your name'); return }
    const code = await generateUniqueRoomCode()
    setRoomCode(code)
    setIsHost(true)
    setInRoom(true)
    setError(null)
    try {
      localStorage.setItem('groovebox_room', code)
      localStorage.setItem('groovebox_name', name)
      localStorage.setItem('groovebox_is_host', '1')
    } catch {}
    try {
      const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
      const meta = { roomName: roomTitleInput.trim(), hostName: name, createdAt: new Date().toISOString() }
      const metaBlob = new Blob([JSON.stringify(meta)], { type: 'application/json' })
      await supabase.storage.from(bucket).upload(`rooms/${code}/meta.json`, metaBlob, { upsert: true, cacheControl: 'no-cache' })
      // Clear any ended flag if it exists for this code reuse (defensive)
      try { await supabase.storage.from(bucket).remove([`ended/${code}.json`]) } catch {}
      setRoomTitle(meta.roomName || '')
    } catch {}
  }

  const joinRoom = async () => {
    setError(null)
    if (!supabase) { setError('Supabase not configured'); return }
    const code = joinCodeInput.trim().toUpperCase()
    const name = (joinName || displayName).trim()
    if (!name) { setError('Please enter your name'); return }
    if (!code) return
    const validCode = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)
    if (!validCode) { setError('Invalid room code'); return }
    const active = await roomIsActive(code)
    if (!active) { setError('Room not found or has ended'); return }
    setRoomCode(code)
    setIsHost(false)
    setInRoom(true)
    setError(null)
    try {
      localStorage.setItem('groovebox_room', code)
      localStorage.setItem('groovebox_name', name)
      localStorage.setItem('groovebox_is_host', '0')
    } catch {}
  }

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

    // Presence: track participants
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as Record<string, Array<{ name?: string }>>
      const entries: Array<{ key: string; name: string }> = []
      Object.entries(state).forEach(([key, metas]) => {
        if (key === clientIdRef.current) return // exclude self from others list
        metas.forEach(meta => entries.push({ key, name: meta?.name || 'Guest' }))
      })
      setParticipants(entries)
    })
    ch.on('presence', { event: 'join' }, ({ key }) => {
      setToast('Someone joined the room')
      setTimeout(()=>setToast(null), 2500)
    })
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      setToast('Someone left the room')
      setTimeout(()=>setToast(null), 2500)
    })

    ch.on('broadcast', { event: 'playlist:add' }, async ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      const sb = supabase
      if (!sb) return
      const items = (payload.items as Array<{ path: string; name: string }>) || []
      const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
      const added: Track[] = []
      for (const it of items) {
        if (it.name === 'meta.json') continue
        const { data: signed } = await sb.storage.from(bucket).createSignedUrl(it.path, 60 * 60 * 24 * 7)
        const url = signed?.signedUrl || sb.storage.from(bucket).getPublicUrl(it.path).data.publicUrl
        if (!url) continue
        added.push({ id: it.path, url, name: it.name, path: it.path })
      }
      if (added.length > 0) {
        setTracks(prev => [...prev, ...added])
      }
    })

    ch.on('broadcast', { event: 'player:play' }, ({ payload }) => {
      if (!payload || payload.sender === clientIdRef.current) return
      const { index, time } = payload as { index: number; time: number }
      // If we don't yet have tracks or the index is out of range, queue it
      if (tracksRef.current.length === 0 || index >= tracksRef.current.length) {
        pendingRemotePlayRef.current = { index, time }
        return
      }
      isApplyingRemoteRef.current = true
      shouldAutoplayRef.current = true
      // If index changed, update and wait for metadata; else just play current
      if (currentIndexRef.current !== index) {
        setCurrentIndex(index)
        setCurrentTime(time)
      } else {
        const audio = audioRef.current
        if (audio) {
          try {
            audio.currentTime = time
            void audio.play()
            setIsPlaying(true)
          } catch (e) {
            // Autoplay blocked; defer until user unlocks
            setPlaybackBlocked(true)
            pendingRemotePlayRef.current = { index, time }
          }
        }
      }
      // Try to play immediately; if metadata not ready, loadedmetadata handler will also trigger play
      setTimeout(() => {
        const audio = audioRef.current
        if (audio) {
          try {
            audio.currentTime = time
            void audio.play()
            setIsPlaying(true)
          } catch (e) {
            setPlaybackBlocked(true)
            pendingRemotePlayRef.current = { index, time }
          }
        }
        isApplyingRemoteRef.current = false
      }, 0)
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
      shouldAutoplayRef.current = false
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
      const nextIndex = Math.min(tracksRef.current.length - 1, Math.max(0, currentIndexRef.current + 1))
      pendingRemotePlayRef.current = { index: nextIndex, time: 0 }
      goNext()
      setTimeout(() => { isApplyingRemoteRef.current = false }, 0)
    })

    ch.on('broadcast', { event: 'player:previous' }, () => {
      isApplyingRemoteRef.current = true
      const prevIndex = Math.max(0, Math.min(tracksRef.current.length - 1, currentIndexRef.current - 1))
      pendingRemotePlayRef.current = { index: prevIndex, time: 0 }
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
      try {
        localStorage.removeItem('groovebox_room')
        localStorage.removeItem('groovebox_is_host')
      } catch {}
    })

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Track self presence with name
        await ch.track({ name: displayName || 'Guest' })
      }
    })
    channelRef.current = ch

    return () => {
      ch.unsubscribe()
      channelRef.current = null
    }
  }, [inRoom, roomCode])

  // Restore session on first render, but only if room still exists and has not ended
  useEffect(() => {
    const restore = async () => {
      try {
        const savedRoom = localStorage.getItem('groovebox_room') || ''
        const savedName = localStorage.getItem('groovebox_name') || ''
        const savedHost = localStorage.getItem('groovebox_is_host') || '0'
        if (savedName) setDisplayName(savedName)
        if (savedRoom && supabase) {
          const active = await roomIsActive(savedRoom)
          if (active) {
            setRoomCode(savedRoom)
            setInRoom(true)
            setIsHost(savedHost === '1')
          } else {
            try {
              localStorage.removeItem('groovebox_room')
              localStorage.removeItem('groovebox_is_host')
            } catch {}
            setInRoom(false)
            setIsHost(false)
          }
        }
      } catch {}
    }
    void restore()
  }, [])

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
          <section className="container-pro py-10 md:py-14">
            <div className="mb-8 text-center md:text-left">
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">Listen together, in sync</h2>
              <p className="mt-2 text-sm text-black/60 dark:text-white/60">Create a room, upload tracks, and share a code. Everyone hears the same thing at the same time.</p>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="panel p-6 md:p-7">
                <h3 className="font-semibold">Create a Room</h3>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">Host a synced listening session.</p>
                <div className="mt-4 grid gap-3">
                  <div className="grid gap-1.5">
                    <label className="label">Your Name</label>
                    <input value={createName} onChange={(e)=>setCreateName(e.currentTarget.value)} placeholder="e.g. Alex" className="input" />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="label">Room Name (optional)</label>
                    <input value={roomTitleInput} onChange={(e)=>setRoomTitleInput(e.currentTarget.value)} placeholder="e.g. Friday Jam" className="input" />
                  </div>
                  <button onClick={createRoom} className="btn-primary mt-2">Create Room</button>
                </div>
              </div>
              <div className="panel p-6 md:p-7">
                <h3 className="font-semibold">Join a Room</h3>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">Enter a room code to join.</p>
                <div className="mt-4 grid gap-3">
                  <div className="grid gap-1.5">
                    <label className="label">Your Name</label>
                    <input value={joinName} onChange={(e)=>setJoinName(e.currentTarget.value)} placeholder="e.g. Alex" className="input" />
                  </div>
                  <div className="flex gap-2">
                    <input value={joinCodeInput} onChange={(e)=>setJoinCodeInput(e.currentTarget.value)} placeholder="Enter room code" className="input font-mono tracking-widest" />
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
      <header className="border-b border-black/10 dark:border-white/10">
        <div className="container-pro flex h-14 sm:h-16 items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-3 flex-1">
            <img src="/favicon/favicon.svg" alt="GrooveBox" className="h-5 w-5 sm:h-6 sm:w-6" />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base md:text-lg font-semibold tracking-tight">GrooveBox</h1>
              <p className="text-[10px] sm:text-[11px] text-black/60 dark:text-white/60 truncate">
                Room <span className="font-mono px-1 py-0.5 rounded-md bg-black/5 dark:bg-white/10">{roomCode}</span>
                {isHost && <span className="ml-2 text-brand-500">Host</span>}
                {roomTitle && <span className="ml-2">· {roomTitle}</span>}
              </p>
            </div>
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
          <button
            className="btn-primary hidden sm:inline-flex"
            onClick={() => setIsUploadOpen(true)}
          >
            <UploadIcon className="h-4 w-4" /> Upload
          </button>

          <div className="ml-2 hidden sm:flex items-center gap-2">
            {isHost ? (
              <button onClick={endRoom} className="btn-outline border-red-500/60 text-red-500 hover:bg-red-500/10">End Room</button>
            ) : (
              <button onClick={leaveRoom} className="btn-outline">Leave</button>
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

      <main className="flex-1">
        <div className="container-pro py-4 sm:py-6">
          {playbackBlocked && (
            <div className="mb-4 rounded-md border border-yellow-500/40 bg-yellow-400/10 text-yellow-200 px-3 py-2 text-sm flex items-center justify-between">
              <span>Playback is blocked by your browser. Click to enable synced playback.</span>
              <button onClick={unlockPlayback} className="ml-3 rounded bg-yellow-400 text-black px-2 py-1 text-xs font-medium">Enable</button>
            </div>
          )}

          <div className="mb-4 flex items-center justify-between text-xs">
            <div className="text-black/60 dark:text-white/60">You: <span className="font-medium text-black dark:text-white">{displayName || 'Guest'}</span></div>
            <div className="text-black/60 dark:text-white/60">Participants: <span className="font-medium text-black dark:text-white">{participants.length + 1}</span></div>
          </div>
          {participants.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {participants.map((p, i) => (
                <span key={p.key + i} className="px-2 py-1 rounded-md text-[11px] bg-black/5 dark:bg-white/10 text-black/70 dark:text-white/70">{p.name}</span>
              ))}
            </div>
          )}
          {toast && <div className="mb-3 text-xs text-black/70 dark:text-white/70">{toast}</div>}
          {error && inRoom && <div className="hidden">{setTimeout(()=>setError(null),0)}</div>}

          <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
            <div className="lg:col-span-2 min-w-0">
              {/* Upload area moved to modal */}

              <div className="mt-4 sm:mt-6 card p-3 sm:p-6 md:p-7 shadow-soft">
                <div className="flex flex-col sm:flex-row items-center gap-2.5 sm:gap-5">
                  <div className="h-10 w-10 sm:h-16 sm:w-16 md:h-20 md:w-20 rounded-lg bg-gradient-to-br from-brand-500/30 to-white/10 grid place-items-center ring-1 ring-white/10 shrink-0">
                    <Music className="h-5 w-5 sm:h-7 sm:w-7 text-brand-500" />
                  </div>
                  <div className="min-w-0 flex-1 w-full">
                    <p className="hidden sm:block text-[11px] uppercase tracking-wide text-black/60 dark:text-white/60">Now Playing</p>
                    <h2 className="mt-1 text-[13px] sm:text-base md:text-lg font-semibold truncate text-center sm:text-left" title={fileName}>{fileName}</h2>
                    <div className="mt-2 flex items-center justify-center gap-1.5 sm:gap-3 flex-wrap">
                      <button
                        onClick={goPrevious}
                        disabled={!hasPrevious}
                        className="icon-btn h-8 w-8 sm:h-10 sm:w-10 rounded-full"
                        aria-label="Previous"
                      >
                        <SkipBack className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </button>
                      <button
                        onClick={togglePlay}
                        disabled={!currentTrack}
                        className="inline-flex items-center justify-center h-9 w-9 sm:h-12 sm:w-12 rounded-full bg-brand-500 text-black hover:brightness-110 disabled:opacity-50"
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                      >
                        {isPlaying ? <Pause className="h-5 w-5 sm:h-6 sm:w-6" /> : <Play className="h-5 w-5 sm:h-6 sm:w-6" />}
                      </button>
                      <button
                        onClick={goNext}
                        disabled={!hasNext}
                        className="icon-btn h-8 w-8 sm:h-10 sm:w-10 rounded-full"
                        aria-label="Next"
                      >
                        <SkipForward className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="hidden md:flex items-center gap-2 w-44 shrink-0">
                    <Volume2 className="h-4 w-4 text-black/60 dark:text-white/60" />
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
                <div className="mt-3">
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={currentTime}
                    onChange={(e) => onSeek(Number(e.currentTarget.value))}
                    className="w-full accent-brand-500 touch-pan-x h-2"
                    disabled={!currentTrack}
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-black/60 dark:text-white/60">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                  {/* Hide mobile volume; device buttons control volume on mobile like Spotify */}
                </div>

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

            <div className="min-w-0">
              <div className="panel p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs uppercase tracking-wide text-black/60 dark:text-white/60">Playlist</h3>
                  <span className="text-[11px] text-black/60 dark:text-white/60">{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>
                </div>
                {tracks.length === 0 ? (
                  <p className="text-sm text-black/60 dark:text-white/60">No songs yet. Upload MP3 or WAV files to get started.</p>
                ) : (
                  <ul className="divide-y divide-black/10 dark:divide-white/10">
                    {tracks.map((t, idx) => {
                      const active = idx === currentIndex
                      return (
                        <li key={t.id}>
                          <button
                            className={`w-full text-left px-2.5 sm:px-3 py-2 rounded-md transition ${active ? 'bg-black/5 dark:bg-white/10 text-brand-500' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                            onClick={() => {
                              setCurrentIndex(idx)
                              setCurrentTime(0)
                              shouldAutoplayRef.current = true
                              const audio = audioRef.current
                              if (audio) {
                                try { audio.currentTime = 0; void audio.play(); setIsPlaying(true) } catch { setPlaybackBlocked(true) }
                              }
                              if (channelRef.current) {
                                channelRef.current.send({ type: 'broadcast', event: 'player:select', payload: { index: idx, sender: clientIdRef.current } })
                                channelRef.current.send({ type: 'broadcast', event: 'player:play', payload: { index: idx, time: 0, sender: clientIdRef.current } })
                              }
                            }}
                          >
                            <div className="flex items-center gap-2.5 sm:gap-3">
                              <span className="text-[10px] sm:text-[11px] w-6 text-black/60 dark:text-white/60">{idx + 1}</span>
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

              <div className="mt-4 sm:hidden">
                <button
                  className="btn-primary w-full text-center"
                  onClick={() => setIsUploadOpen(true)}
                >
                  <UploadIcon className="h-4 w-4 mr-2" /> Upload
                </button>
                <div className="mt-2 flex gap-2">
                  {isHost ? (
                    <button onClick={endRoom} className="btn-outline border-red-500/60 text-red-500 hover:bg-red-500/10 w-full">End Room</button>
                  ) : (
                    <button onClick={leaveRoom} className="btn-outline w-full">Leave</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="container-pro py-8 text-center text-xs text-black/60 dark:text-white/60">
        Built with React, Vite, and Tailwind · Plays locally in your browser
      </footer>

      {/* Upload Modal */}
      {isUploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/60" onClick={() => setIsUploadOpen(false)} />
          <div className="relative w-full max-w-lg card p-6 md:p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Upload Tracks</h2>
              <button className="icon-btn" onClick={() => setIsUploadOpen(false)} aria-label="Close">✕</button>
            </div>
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
              {isUploading && (
                <p className="mt-4 text-sm text-black/70 dark:text-white/70">Uploading...</p>
              )}
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
    </div>
  )
}


