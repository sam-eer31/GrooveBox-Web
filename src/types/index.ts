// Track type for audio tracks
export type Track = {
  id: string
  file?: File
  url: string
  name: string
  path: string
}

// Upload progress type for file uploads
export type UploadProgress = {
  fileName: string
  progress: number
  uploaded: number
  total: number
  speed: number
  status: 'pending' | 'uploading' | 'completed' | 'error'
  error?: string
}

// Toast notification type
export type Toast = {
  id: string
  message: string
  type: 'success' | 'info' | 'warning' | 'error'
  duration?: number
}
