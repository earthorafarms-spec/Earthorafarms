-- AI platform: tenants, channels, knowledgebase (+pgvector), workflows, functions, conversations, reliability.

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tenants (slug, name) VALUES ('earthora', 'Earthora Farms') ON CONFLICT (slug) DO NOTHING;

-- ── Channels ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('chat','voice','whatsapp','calls')),
  slug text NOT NULL,
  name text NOT NULL,
  public_key text UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  draft_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  version int NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type, slug)
);
CREATE TABLE IF NOT EXISTS channel_versions (
  id bigserial PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  version int NOT NULL,
  config jsonb NOT NULL,
  published_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Knowledgebase ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kb_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  authority int NOT NULL DEFAULT 3,           -- 1 highest .. 5 lowest
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','internal')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS kb_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collection_id uuid REFERENCES kb_collections(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('file','url','website','db_sync','manual')),
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {url, maxPages, includeArchived, ...}
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'idle',
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id uuid REFERENCES kb_sources(id) ON DELETE CASCADE,
  collection_id uuid REFERENCES kb_collections(id) ON DELETE SET NULL,
  title text NOT NULL,
  uri text,
  mime text DEFAULT 'text/plain',
  content_hash text,
  language text DEFAULT 'en',
  tags text[] NOT NULL DEFAULT '{}',
  workflow_ids uuid[] NOT NULL DEFAULT '{}',
  product_ids uuid[] NOT NULL DEFAULT '{}',
  summary text DEFAULT '',
  authority int NOT NULL DEFAULT 3,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','internal')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','indexed','disabled','failed')),
  version int NOT NULL DEFAULT 1,
  effective_from timestamptz DEFAULT now(),
  effective_until timestamptz,
  tokens int DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kb_documents_tenant ON kb_documents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_documents_tags ON kb_documents USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_kb_documents_workflows ON kb_documents USING gin(workflow_ids);

-- Embeddings default to OpenAI text-embedding-3-small (1536). Model id + dims recorded per chunk.
CREATE TABLE IF NOT EXISTS kb_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  collection_id uuid REFERENCES kb_collections(id) ON DELETE SET NULL,
  ordinal int NOT NULL,
  content text NOT NULL,
  context_header text DEFAULT '',
  tokens int DEFAULT 0,
  embedding vector(1536),
  embed_model text DEFAULT 'text-embedding-3-small',
  tags text[] NOT NULL DEFAULT '{}',
  workflow_ids uuid[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL DEFAULT 'public',
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(context_header,'') || ' ' || content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_tsv ON kb_chunks USING gin(tsv);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_trgm ON kb_chunks USING gin(content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_tags ON kb_chunks USING gin(tags);
-- exact kNN at launch scale; add HNSW when chunk count justifies it.

-- ── Workflows ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  mode text NOT NULL DEFAULT 'playbook' CHECK (mode IN ('playbook','stepped')),
  priority int NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_definition jsonb,
  version int NOT NULL DEFAULT 0,
  is_fallback boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
CREATE TABLE IF NOT EXISTS workflow_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  text text NOT NULL,
  kind text NOT NULL DEFAULT 'positive' CHECK (kind IN ('positive','negative')),
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflow_examples_wf ON workflow_examples(workflow_id);

-- ── Functions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS functions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'builtin' CHECK (kind IN ('builtin','http')),
  description text NOT NULL DEFAULT '',
  schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  requires_confirmation boolean NOT NULL DEFAULT false,
  allowed_channels text[] NOT NULL DEFAULT '{chat,voice,whatsapp,calls}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- ── Conversations & runtime ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone text, email text, wa_id text, name text,
  verified_at timestamptz,
  user_email text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone),
  UNIQUE (tenant_id, wa_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES channels(id) ON DELETE SET NULL,
  channel_type text NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  external_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','escalated')),
  language text DEFAULT 'en',
  workflow_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  intent text,
  resolution text,
  sentiment text,
  rating int,
  needs_follow_up boolean NOT NULL DEFAULT false,
  escalated boolean NOT NULL DEFAULT false,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (tenant_id, channel_type, external_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_started ON conversations(tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS conversation_state (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  active_workflow_id uuid,
  active_workflow_version int,
  active_step text,
  slots jsonb NOT NULL DEFAULT '{}'::jsonb,
  cart jsonb NOT NULL DEFAULT '[]'::jsonb,
  checkout jsonb NOT NULL DEFAULT '{}'::jsonb,
  pending jsonb,
  suspended jsonb NOT NULL DEFAULT '[]'::jsonb,
  language text DEFAULT 'en',
  summary text DEFAULT '',
  pinned_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision int NOT NULL DEFAULT 0,
  lease_owner text,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq bigserial,
  role text NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content text NOT NULL DEFAULT '',
  content_type text NOT NULL DEFAULT 'text',
  tool_calls jsonb,
  tool_result jsonb,
  audio_asset_id uuid,
  delivery_status text DEFAULT 'delivered',
  latency_ms int,
  tokens int,
  cost numeric(12,6),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, seq);

CREATE TABLE IF NOT EXISTS turn_traces (
  id bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  routed_workflow text,
  router_confidence numeric,
  router_reason text,
  retrieval jsonb,
  tool_calls jsonb,
  prompt_hash text,
  model text,
  timings jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_turn_traces_conv ON turn_traces(conversation_id, created_at);

-- ── Reliability ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_type text NOT NULL,
  provider_message_id text NOT NULL,
  external_conversation text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','reply_ready','processed','failed')),
  reply jsonb,
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_type, provider_message_id)
);
CREATE INDEX IF NOT EXISTS idx_inbound_events_queue ON inbound_events(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'callback',
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  assignee text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_escalations_open ON escalations(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS eval_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES workflows(id) ON DELETE CASCADE,
  question text NOT NULL,
  language text DEFAULT 'en',
  expect_workflow text,
  expect_contains text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
