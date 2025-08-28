import { useState, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { Track, UploadProgress, Toast } from '../types'
import { cleanFileName, formatFileSize, formatSpeed, sortTracksAlphabetically, logSupabaseUploadError } from '../utils'

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

export function useUpload(
  roomCode: string,
  inRoom: boolean,
  setError: (error: string | null) => void,
  addToast: (message: string, type: Toast['type'], duration?: number) => void,
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>,
  channelRef: React.MutableRefObject<any>,
  clientIdRef: React.MutableRefObject<string>
) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([])
  const [totalUploadSize, setTotalUploadSize] = useState(0)
  const [totalUploaded, setTotalUploaded] = useState(0)
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false)
  const [isProgressOpen, setIsProgressOpen] = useState<boolean>(false)
  
  const activeXhrsRef = useRef<XMLHttpRequest[]>([])
  const uploadCancelRef = useRef<boolean>(false)
  const uploadedPathsRef = useRef<string[]>([])

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

    // Clear any previous errors
    setError(null)

    // Initialize upload progress and open progress modal
    const totalSize = accepted.reduce((sum, file) => sum + file.size, 0)
    const progressItems: UploadProgress[] = accepted.map(file => ({
      fileName: file.name,
      progress: 0,
      uploaded: 0,
      total: file.size,
      speed: 0,
      status: 'pending'
    }))

    setUploadProgress(progressItems)
    setTotalUploadSize(totalSize)
    setTotalUploaded(0)
    setIsUploading(true)
    setIsUploadOpen(false)
    setIsProgressOpen(true)
    if (unsupported > 0) addToast(`${unsupported} file(s) were skipped (unsupported type).`, 'warning')

    try {
      const uploadedTracks: Track[] = []
      uploadCancelRef.current = false
      activeXhrsRef.current = []
      uploadedPathsRef.current = []
      
      for (let i = 0; i < accepted.length; i++) {
        // Check if upload was cancelled
        if (uploadCancelRef.current) {
          break
        }

        const file = accepted[i]
        const startTime = Date.now()
        let lastUpdateTime = startTime
        let lastUploaded = 0

        // Update status to uploading
        setUploadProgress(prev => prev.map((item, index) => 
          index === i ? { ...item, status: 'uploading' } : item
        ))

        // Clean the filename by removing brackets and other problematic characters
        const cleanedFileName = cleanFileName(file.name)
        // Encode the cleaned filename to handle special characters safely
        const encodedFileName = encodeURIComponent(cleanedFileName)
        const path = `rooms/${roomCode}/tracks/${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}-${encodedFileName}`

        // Create a custom upload with progress tracking
        const uploadWithProgress = async (): Promise<{ error?: any }> => {
          return new Promise((resolve) => {
            const xhr = new XMLHttpRequest()
            activeXhrsRef.current.push(xhr)
            
            xhr.upload.addEventListener('progress', (e) => {
              // Check if cancelled during progress
              if (uploadCancelRef.current) {
                xhr.abort()
                return
              }

              if (e.lengthComputable) {
                const now = Date.now()
                const timeDiff = (now - lastUpdateTime) / 1000 // seconds
                const uploadedDiff = e.loaded - lastUploaded
                const speed = timeDiff > 0 ? uploadedDiff / timeDiff : 0

                setUploadProgress(prev => prev.map((item, index) => 
                  index === i ? {
                    ...item,
                    progress: (e.loaded / e.total) * 100,
                    uploaded: e.loaded,
                    speed
                  } : item
                ))

                setTotalUploaded(prev => prev + uploadedDiff)
                lastUpdateTime = now
                lastUploaded = e.loaded
              }
            })

            xhr.addEventListener('load', () => {
              if (xhr.status === 200) {
                resolve({})
              } else {
                resolve({ error: new Error(`Upload failed with status ${xhr.status}`) })
              }
            })

            xhr.addEventListener('error', () => {
              resolve({ error: new Error('Upload failed') })
            })

            xhr.addEventListener('abort', () => {
              resolve({ error: new Error('Upload cancelled') })
            })

            // Get upload URL from Supabase
            if (!supabase) {
              resolve({ error: new Error('Supabase client not available') })
              return
            }
            supabase.storage.from(bucket).createSignedUploadUrl(path).then(({ data, error }) => {
              // Check if cancelled before starting upload
              if (uploadCancelRef.current) {
                xhr.abort()
                return
              }

              if (error || !data?.signedUrl) {
                resolve({ error: error || new Error('Failed to get upload URL') })
                return
              }

              xhr.open('PUT', data.signedUrl)
              xhr.setRequestHeader('Content-Type', file.type || 'audio/mpeg')
              xhr.send(file)
            })
          })
        }

        const { error: upErr } = await uploadWithProgress()
        
        // Check if cancelled after upload attempt
        if (uploadCancelRef.current) {
          break
        }
        
        if (upErr) {
          setUploadProgress(prev => prev.map((item, index) => 
            index === i ? { ...item, status: 'error', error: upErr.message } : item
          ))
          // Don't set error for cancelled uploads
          if (!upErr.message.includes('cancelled')) {
            setError(`Upload failed for ${file.name}: ${upErr.message}`)
          }
          continue
        }

        // Mark as completed
        setUploadProgress(prev => prev.map((item, index) => 
          index === i ? { ...item, status: 'completed', progress: 100 } : item
        ))

        // Prefer signed URL so it works even if bucket is private
        // The path already contains the encoded filename, so we don't need to encode again
        const { data: signed, error: signErr } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7)
        if (signErr || !signed?.signedUrl) {
          // Try public URL fallback
          const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path)
          if (!pub?.publicUrl) {
            setError(`Could not generate URL for ${file.name}`)
            addToast(`Could not generate URL for ${file.name}`, 'error')
            continue
          }
          uploadedTracks.push({
            id: path,
            file,
            url: pub.publicUrl,
            name: cleanFileName(file.name),
            path
          })
        } else {
          uploadedTracks.push({
            id: path,
            file,
            url: signed.signedUrl,
            name: cleanFileName(file.name),
            path
          })
        }
        uploadedPathsRef.current.push(path)
      }

      // Check if upload was cancelled
      if (uploadCancelRef.current) {
        // Clean up any uploaded files
        if (uploadedPathsRef.current.length > 0) {
          try {
            const paths = [...uploadedPathsRef.current]
            uploadedPathsRef.current = []
            if (supabase) {
              // Remove in chunks of 100
              const chunkSize = 100
              for (let i = 0; i < paths.length; i += chunkSize) {
                const chunk = paths.slice(i, i + chunkSize)
                await supabase.storage.from(bucket).remove(chunk)
              }
            }
          } catch (error) {
            console.error('Failed to clean up uploaded files:', error)
          }
        }
        
        // Reset UI state
        setIsUploading(false)
        setIsProgressOpen(false)
        setUploadProgress([])
        setTotalUploadSize(0)
        setTotalUploaded(0)
        return
      }

      if (uploadedTracks.length > 0) {
        // Optionally persist track metadata (display names) to tracks.json
        const shouldWriteMeta = (import.meta.env.VITE_ENABLE_TRACKS_META as string) === '1'
        if (shouldWriteMeta) {
          try {
            const metaPath = `rooms/${roomCode}/meta/tracks.json`
            const { data: existing } = await supabase.storage.from(bucket).download(metaPath)
            let trackMeta: Array<{ path: string; name: string }> = []
            if (existing) {
              try { trackMeta = JSON.parse(await existing.text()) as Array<{ path: string; name: string }> } catch {}
            }
            const toAppend = uploadedTracks.map(t => ({ path: t.path, name: cleanFileName(t.name) }))
            // Merge unique by path
            const seen = new Set(trackMeta.map(i => i.path))
            for (const it of toAppend) { if (!seen.has(it.path)) trackMeta.push(it) }
            const blob = new Blob([JSON.stringify(trackMeta, null, 2)], { type: 'application/json' })
            await supabase.storage.from(bucket).upload(metaPath, blob, { upsert: true })
          } catch {}
        }

        setTracks(prev => sortTracksAlphabetically([...prev, ...uploadedTracks]))
        
        // Broadcast new tracks to all users in the room
        if (channelRef.current) {
          const payload = uploadedTracks.map(t => ({ path: t.path, name: cleanFileName(t.name) }))
          channelRef.current.send({ type: 'broadcast', event: 'playlist:add', payload: { items: payload, sender: clientIdRef.current } })
        }
      }

      // All uploads completed successfully (if not cancelled)
      if (uploadedTracks.length > 0) {
        // Show success message
        addToast(`Successfully uploaded ${uploadedTracks.length} track(s)!`, 'success')
        
        // Close upload modal after a short delay
        setTimeout(() => {
          setIsUploadOpen(false)
          setIsProgressOpen(false)
          setUploadProgress([])
          setTotalUploadSize(0)
          setTotalUploaded(0)
        }, 1500)
      } else {
        // No successful uploads, close modal immediately
        setIsUploadOpen(false)
        setIsProgressOpen(false)
        setUploadProgress([])
        setTotalUploadSize(0)
        setTotalUploaded(0)
      }
    } finally {
      setIsUploading(false)
      // Clear active xhrs list
      activeXhrsRef.current = []
    }
  }

  const cancelUpload = async () => {
    // Mark cancellation flag
    uploadCancelRef.current = true
    
    // Abort all active uploads
    activeXhrsRef.current.forEach(x => { 
      try { 
        x.abort() 
      } catch (error) {
        console.error('Error aborting upload:', error)
      } 
    })
    activeXhrsRef.current = []
    
    // Remove any successfully uploaded files from server
    try {
      const bucket = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'groovebox-music'
      const paths = [...uploadedPathsRef.current]
      uploadedPathsRef.current = []
      if (paths.length > 0 && supabase) {
        const chunkSize = 100
        for (let i = 0; i < paths.length; i += chunkSize) {
          const chunk = paths.slice(i, i + chunkSize)
          await supabase.storage.from(bucket).remove(chunk)
        }
      }
    } catch (error) {
      console.error('Error cleaning up uploaded files:', error)
    }

    // Clear any errors
    setError(null)
    
    // Reset UI state
    setIsUploading(false)
    setIsProgressOpen(false)
    setUploadProgress([])
    setTotalUploadSize(0)
    setTotalUploaded(0)
  }

  return {
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
  }
}
