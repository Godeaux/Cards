import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigError =
  !supabaseUrl || !supabaseKey
    ? 'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY at build time.'
    : null

export const supabase = supabaseConfigError ? null : createClient(supabaseUrl, supabaseKey)
