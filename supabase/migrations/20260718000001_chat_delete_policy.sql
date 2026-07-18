-- ─── Add DELETE policies for chat tables ─────────────────────────────────────
-- The Codex portal uses the anon key (no Supabase auth session).
-- We allow the anon role to delete so the portal's delete buttons work.
-- Access to the Codex portal is already protected by the app-level password.

-- Drop any conflicting policies first (safe to re-run)
DROP POLICY IF EXISTS "anon can delete chat_sessions"  ON chat_sessions;
DROP POLICY IF EXISTS "anon can delete chat_messages"  ON chat_messages;
DROP POLICY IF EXISTS "allow all delete chat_sessions" ON chat_sessions;
DROP POLICY IF EXISTS "allow all delete chat_messages" ON chat_messages;

-- Allow anon + authenticated to delete chat sessions
CREATE POLICY "allow all delete chat_sessions"
  ON chat_sessions FOR DELETE
  TO anon, authenticated
  USING (true);

-- Allow anon + authenticated to delete chat messages
CREATE POLICY "allow all delete chat_messages"
  ON chat_messages FOR DELETE
  TO anon, authenticated
  USING (true);
