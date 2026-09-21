-- Voice drafts are confirmation/idempotency records; submitted enquiries reuse
-- Contact_details/escalations and the existing notification job handlers.
CREATE TABLE IF NOT EXISTS voice_request_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('contact','callback')),
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  confirmation_hash text,
  review_user_seq bigint,
  review_expires_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_request_one_open_kind
  ON voice_request_drafts (conversation_id, request_type) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS voice_request_conversation ON voice_request_drafts (conversation_id, updated_at DESC);
