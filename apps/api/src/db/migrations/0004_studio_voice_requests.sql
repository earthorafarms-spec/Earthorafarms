-- Durable receipt makes Studio outbox retries safe across worker/API restarts.
CREATE TABLE IF NOT EXISTS studio_voice_requests (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{32}$'),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  flow_id text NOT NULL,
  config_revision integer NOT NULL,
  fields jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_id)
);
