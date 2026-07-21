import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabaseInstance: ReturnType<typeof createClient>;

if (!supabaseUrl || !supabaseAnonKey) {
  if (import.meta.env.DEV) {
    console.warn('Missing Supabase configuration env variables.');
  }
  supabaseInstance = createClient('https://placeholder.supabase.co', 'placeholder-key');
} else {
  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true },
  });
}

export const supabase = supabaseInstance;
