import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

if (!supabase) {
  // Warn once in console; UI should handle missing config gracefully
  console.warn('Supabase env vars are missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
}


