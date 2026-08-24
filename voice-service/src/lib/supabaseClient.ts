import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

// Server-only client using the service-role key. This bypasses RLS entirely
// by design — voice-service IS the trust boundary for every new voice_*
// table (see the migration's RLS comments). Never construct a client with
// this key anywhere reachable from a browser.
export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
