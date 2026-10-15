CREATE SCHEMA IF NOT EXISTS ai_factory;

CREATE TABLE IF NOT EXISTS ai_factory.knowledge_graph_events (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  record_id text NOT NULL,
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS knowledge_graph_record_history ON ai_factory.knowledge_graph_events(record_id);

CREATE TABLE IF NOT EXISTS ai_factory.tasks (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'inbox' CHECK (status IN (
    'inbox', 'analyzing', 'needs_answers', 'ready', 'developing', 'testing',
    'repairing', 'ready_release', 'releasing', 'done', 'needs_attention', 'paused', 'cancelled'
  )),
  priority text NOT NULL DEFAULT 'P2' CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  parent_id uuid REFERENCES ai_factory.tasks(id),
  spec jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(spec) = 'object'),
  artifact jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(artifact) = 'object'),
  requirements_version integer NOT NULL DEFAULT 1 CHECK (requirements_version > 0),
  repair_count integer NOT NULL DEFAULT 0 CHECK (repair_count >= 0),
  resume_status text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE ai_factory.tasks ADD COLUMN IF NOT EXISTS board_column text
  CHECK (board_column IS NULL OR board_column IN ('attention', 'inbox', 'analysis', 'ready', 'working', 'testing', 'release', 'done'));
ALTER TABLE ai_factory.tasks ADD COLUMN IF NOT EXISTS board_position integer
  CHECK (board_position IS NULL OR board_position >= 0);

CREATE TABLE IF NOT EXISTS ai_factory.questions (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES ai_factory.tasks(id),
  requirements_version integer NOT NULL,
  text text NOT NULL,
  answer text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  answered_at timestamptz
);

CREATE TABLE IF NOT EXISTS ai_factory.jobs (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES ai_factory.tasks(id),
  role text NOT NULL CHECK (role IN ('analyst', 'developer', 'tester', 'release')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'revoked')),
  requirements_version integer NOT NULL,
  worker_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'running') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_per_task
  ON ai_factory.jobs (task_id) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS jobs_claim_order
  ON ai_factory.jobs (available_at, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS jobs_expiring
  ON ai_factory.jobs (lease_expires_at) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS ai_factory.runs (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES ai_factory.jobs(id),
  task_id uuid NOT NULL REFERENCES ai_factory.tasks(id),
  role text NOT NULL,
  attempt integer NOT NULL,
  requirements_version integer NOT NULL,
  lease_token uuid NOT NULL UNIQUE,
  worker_id text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'revoked', 'expired')),
  result jsonb,
  execution jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(execution) = 'object'),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(progress) = 'object'),
  usage jsonb CHECK (usage IS NULL OR jsonb_typeof(usage) = 'object'),
  error text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  UNIQUE (job_id, attempt)
);

ALTER TABLE ai_factory.runs ADD COLUMN IF NOT EXISTS execution jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(execution) = 'object');

ALTER TABLE ai_factory.runs ADD COLUMN IF NOT EXISTS progress jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(progress) = 'object');

ALTER TABLE ai_factory.runs ADD COLUMN IF NOT EXISTS usage jsonb
  CHECK (usage IS NULL OR jsonb_typeof(usage) = 'object');

CREATE TABLE IF NOT EXISTS ai_factory.events (
  id bigserial PRIMARY KEY,
  task_id uuid REFERENCES ai_factory.tasks(id),
  type text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS events_task_order ON ai_factory.events (task_id, id);
CREATE INDEX IF NOT EXISTS events_legacy_usage ON ai_factory.events (task_id, created_at)
  WHERE type = 'agent_usage';

CREATE TABLE IF NOT EXISTS ai_factory.bugs (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES ai_factory.tasks(id),
  run_id uuid NOT NULL REFERENCES ai_factory.runs(id),
  title text NOT NULL,
  expected text NOT NULL DEFAULT '',
  actual text NOT NULL DEFAULT '',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS bugs_task_order ON ai_factory.bugs (task_id, created_at);

CREATE TABLE IF NOT EXISTS ai_factory.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
