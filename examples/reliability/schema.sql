CREATE TABLE mail_webhook_inbox (
  provider text NOT NULL,
  delivery_id text NOT NULL,
  events jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, delivery_id)
);

CREATE TABLE mail_outbox (
  id text PRIMARY KEY,
  input jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'sending', 'accepted', 'partial', 'failed', 'unknown')),
  receipt jsonb,
  failure jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mail_outbox_queued ON mail_outbox (created_at, id) WHERE state = 'queued';
