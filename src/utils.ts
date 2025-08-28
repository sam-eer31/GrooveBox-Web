// Utility functions extracted from App.tsx
// These are pure functions with no dependencies on React state or effects

export function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function cleanFileName(fileName: string): string {
  // Preserve known audio extension, but strip ALL special characters from the base name
  const trimmed = (fileName || '').trim()
  const lastDot = trimmed.lastIndexOf('.')
  const rawName = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed
  const rawExt = lastDot > 0 ? trimmed.slice(lastDot + 1).toLowerCase() : ''

  // Remove everything that's not a letter, number, or space from the base name
  let base = rawName.replace(/[^a-zA-Z0-9 ]+/g, '')
  base = base.replace(/\s+/g, ' ').trim()
  if (!base) base = 'track'

  // Keep only a safe, known extension set
  const allowedExts = new Set(['mp3', 'wav', 'm4a', 'aac'])
  const ext = allowedExts.has(rawExt) ? rawExt : ''

  return ext ? `${base}.${ext}` : base
}

export function deriveDisplayNameFromObjectName(objectName: string): string {
  // Decode URL-encoded filename first
  const decodedName = decodeURIComponent(objectName)
  // Matches UUID prefixes we add during upload: <uuid>-<original-name>
  const uuidPrefixPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-(.+)$/
  const match = decodedName.match(uuidPrefixPattern)
  return match ? match[1] : decodedName
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function formatSpeed(bytesPerSecond: number): string {
  return formatFileSize(bytesPerSecond) + '/s'
}

// Helper function for alphabetical sort
export function sortTracksAlphabetically(tracks: any[]): any[] {
  return [...tracks].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

// Define logSyncEvent if not already defined
export function logSyncEvent(msg: string, ...args: any[]) {
  console.log(`[SYNC] ${msg}`, ...args)
}

// Enhanced error logging for Supabase Storage uploads
export function logSupabaseUploadError(context: string, e: any) {
  console.error(`[Supabase Upload Error] ${context}:`, e)
  if (e && e.response) {
    if (e.response.status) {
      console.error(`[Supabase Upload Error] ${context} - status:`, e.response.status)
    }
    if (e.response.headers) {
      console.error(`[Supabase Upload Error] ${context} - headers:`, e.response.headers)
    }
    if (typeof e.response.text === 'function') {
      e.response.text().then((txt: string) => {
        console.error(`[Supabase Upload Error] ${context} - response body:`, txt)
      })
    }
  } else if (e && (e.message || e.error_description)) {
    console.error(`[Supabase Upload Error] ${context} - message:`, e.message || e.error_description)
  } else {
    console.error(`[Supabase Upload Error] ${context} - unknown error format`, e)
  }
}
