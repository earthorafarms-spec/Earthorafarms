-- Independent durable receipts for Studio acknowledgement, notice, and callback emails.
-- Keep receipts beyond job retention: a retry must never reset a send identity.
CREATE TABLE IF NOT EXISTS studio_email_receipts (
  email_key text PRIMARY KEY CHECK (length(email_key) BETWEEN 1 AND 256),
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','uncertain')),
  provider_id text,
  first_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  lease_token text,
  lease_until timestamptz,
  CHECK (status <> 'sent' OR provider_id IS NOT NULL)
);
