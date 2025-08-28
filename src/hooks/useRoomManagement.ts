import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useRoomManagement(
  setError: (error: string | null) => void,
  setRoomCode: (code: string) => void,
  setInRoom: (inRoom: boolean) => void,
  setIsHost: (isHost: boolean) => void,
  setDisplayName: (name: string) => void,
  setRoomTitle: (title: string) => void,
  setTracks: React.Dispatch<React.SetStateAction<any[]>>,
  setCurrentIndex: (index: number) => void,
  setIsPlaying: (playing: boolean) => void,
  setCurrentTime: (time: number) => void,
  channelRef: React.MutableRefObject<any>
) {
  const [createName, setCreateName] = useState<string>('')
  const [joinName, setJoinName] = useState<string>('')
  const [roomTitleInput, setRoomTitleInput] = useState<string>('')
  const [joinCodeInput, setJoinCodeInput] = useState<string>('')

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
      const { data } = await supabase.storage.from(bucket).download(`rooms/${code}/meta/meta.json`)
      return !!data
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
    
    // Always require a name from the input field, don't fall back to displayName
    const name = createName.trim()
    if (!name) { 
      setError('Please enter your name'); 
      return 
    }
    
    const code = await generateUniqueRoomCode()
    // Ensure name is set before we subscribe to presence
    setDisplayName(name)
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
      await supabase.storage.from(bucket).upload(`rooms/${code}/meta/meta.json`, metaBlob, { upsert: true, cacheControl: 'no-cache' })
      // Clear any ended flag if it exists for this code reuse (defensive)
      try { await supabase.storage.from(bucket).remove([`ended/${code}.json`]) } catch {}
      setRoomTitle(meta.roomName || '')
    } catch {}
  }

  const joinRoom = async () => {
    setError(null)
    if (!supabase) { setError('Supabase not configured'); return }
    const code = joinCodeInput.trim().toUpperCase()
    
    // Always require a name from the input field, don't fall back to displayName
    const name = joinName.trim()
    if (!name) { 
      setError('Please enter your name'); 
      return 
    }
    
    if (!code) return
    const validCode = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)
    if (!validCode) { setError('Invalid room code'); return }
    const active = await roomIsActive(code)
    if (!active) { setError('Room not found or has ended'); return }
    
    // Ensure name is set before we subscribe to presence
    setDisplayName(name)
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

  const cleanupRoomState = () => {
    setInRoom(false)
    setIsHost(false)
    setRoomCode('')
    setTracks([])
    setCurrentIndex(-1)
    setIsPlaying(false)
    setCurrentTime(0)
  }

  const endRoom = async (roomCode: string, isHost: boolean) => {
    if (!isHost || !supabase || !roomCode) return
    const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
    try {
      const limit = 100
      let offset = 0
      while (true) {
        const { data: files, error: listErr } = await supabase.storage.from(bucket).list(`rooms/${roomCode}`, { limit, offset, sortBy: { column: 'name', order: 'asc' } })
        if (listErr) break
        const batch = (files || []).flatMap(f => [
          `rooms/${roomCode}/${f.name}`,
          `rooms/${roomCode}/tracks/${f.name}`,
          `rooms/${roomCode}/meta/${f.name}`
        ])
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
      channelRef.current.send({ type: 'broadcast', event: 'room:ended', payload: { sender: 'host' } })
    }
    cleanupRoomState()
    try {
      localStorage.removeItem('groovebox_room')
      localStorage.removeItem('groovebox_is_host')
      localStorage.removeItem('groovebox_name') // Clear name when ending room
    } catch {}
    setDisplayName('') // Clear display name when ending room
  }

  const leaveRoom = async () => {
    try { localStorage.removeItem('groovebox_room') } catch {}
    try { localStorage.removeItem('groovebox_is_host') } catch {}
    try { localStorage.removeItem('groovebox_name') } catch {} // Clear name when leaving room
    if (channelRef.current) {
      channelRef.current.unsubscribe()
      channelRef.current = null
    }
    cleanupRoomState()
    setDisplayName('') // Clear display name when leaving room
  }

  return {
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
  }
}
