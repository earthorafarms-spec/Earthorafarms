-- ─── Chat Sessions Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_agent TEXT,
  started_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

-- Allow anyone (incl. anonymous visitors) to insert their own session
CREATE POLICY "anon can insert chat_sessions"
  ON chat_sessions FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only authenticated admins can read sessions (adjust role check as needed)
CREATE POLICY "admins can read chat_sessions"
  ON chat_sessions FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin' OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');


-- ─── Chat Messages Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT        NOT NULL,
  is_blocked BOOLEAN     DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_started_at ON chat_sessions(started_at DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert messages
CREATE POLICY "anon can insert chat_messages"
  ON chat_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only admins can read messages
CREATE POLICY "admins can read chat_messages"
  ON chat_messages FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin' OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
