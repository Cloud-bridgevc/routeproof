-- RouteProof schema (SQLite, via Node's built-in node:sqlite).
-- Rules carried into the schema:
--   * System timestamps are written by the server at the moment of the action.
--   * Device-reported photo capture time is a separate, nullable, labelled column.
--   * "Verified" exists only as a record_reviews row with a named reviewer.
--   * Evidence, reviews, sign-offs, notes, dispute events and reports are
--     append-only (enforced by triggers). The current value is the latest row.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  kind  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  contact TEXT,
  email   TEXT,
  segment TEXT
);

CREATE TABLE IF NOT EXISTS locations (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  name        TEXT NOT NULL,
  address     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS technicians (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',   -- JSON array
  region TEXT,
  phone  TEXT
);

CREATE TABLE IF NOT EXISTS service_templates (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  service_type     TEXT NOT NULL CHECK (service_type IN ('cleaning','pest-control','maintenance','repair','other')),
  requires_signoff INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS template_steps (
  id              TEXT NOT NULL,
  template_id     TEXT NOT NULL REFERENCES service_templates(id),
  position        INTEGER NOT NULL,
  label           TEXT NOT NULL,
  stage           TEXT NOT NULL CHECK (stage IN ('before','during','after')),
  requires_photo  INTEGER NOT NULL DEFAULT 0,
  requires_note   INTEGER NOT NULL DEFAULT 0,
  note_must_match TEXT,
  note_hint       TEXT,
  PRIMARY KEY (template_id, id)
);

CREATE TABLE IF NOT EXISTS work_orders (
  id            TEXT PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  customer_id   TEXT NOT NULL REFERENCES customers(id),
  location_id   TEXT NOT NULL REFERENCES locations(id),
  template_id   TEXT NOT NULL REFERENCES service_templates(id),
  technician_id TEXT REFERENCES technicians(id),
  scheduled_for TEXT NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'normal',
  status        TEXT NOT NULL CHECK (status IN ('scheduled','in_progress','submitted','in_review','needs_info','verified','disputed','cancelled')),
  check_in_at   TEXT,
  check_out_at  TEXT,
  submitted_at  TEXT,
  created_at    TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at)
);
CREATE INDEX IF NOT EXISTS wo_status   ON work_orders (status);
CREATE INDEX IF NOT EXISTS wo_tech     ON work_orders (technician_id, scheduled_for);
CREATE INDEX IF NOT EXISTS wo_location ON work_orders (location_id, scheduled_for);

CREATE TABLE IF NOT EXISTS checklist_entries (
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  step_id       TEXT NOT NULL,
  position      INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('not_done','done','na')),
  completed_at  TEXT,
  note          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (work_order_id, step_id)
);

CREATE TABLE IF NOT EXISTS work_order_notes (
  id            TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  body          TEXT NOT NULL,
  recorded_at   TEXT
);

CREATE TABLE IF NOT EXISTS evidence (
  id                  TEXT PRIMARY KEY,
  work_order_id       TEXT NOT NULL REFERENCES work_orders(id),
  step_id             TEXT,
  kind                TEXT NOT NULL CHECK (kind IN ('photo','document')),
  filename            TEXT NOT NULL,
  caption             TEXT,
  url                 TEXT NOT NULL,
  storage_key         TEXT,
  sha256              TEXT NOT NULL,
  captured_at         TEXT,              -- device metadata (EXIF); NULL when absent, never backfilled
  captured_at_source  TEXT NOT NULL CHECK (captured_at_source IN ('device-metadata','unavailable')),
  uploaded_at         TEXT,
  classification      TEXT,              -- JSON from the classifier (simulated or Bedrock)
  is_demo             INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS evidence_sha ON evidence (sha256);
CREATE INDEX IF NOT EXISTS evidence_wo  ON evidence (work_order_id);

CREATE TABLE IF NOT EXISTS evidence_reviews (
  id          TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  status      TEXT NOT NULL CHECK (status IN ('approved','rejected','pending')),
  reviewer    TEXT,
  comment     TEXT,
  decided_at  TEXT,
  CHECK (status <> 'rejected' OR coalesce(comment, '') <> '')
);

CREATE TABLE IF NOT EXISTS signoffs (
  id             TEXT PRIMARY KEY,
  work_order_id  TEXT NOT NULL REFERENCES work_orders(id),
  status         TEXT NOT NULL CHECK (status IN ('captured','unavailable','refused')),
  signer_name    TEXT,
  signature_url  TEXT,
  method         TEXT,
  reason         TEXT,
  captured_at    TEXT,
  CHECK (status = 'captured' OR coalesce(reason, '') <> ''),
  CHECK (status <> 'captured' OR signer_name IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS record_reviews (
  id            TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  decision      TEXT NOT NULL CHECK (decision IN ('verified','needs_info')),
  reviewer      TEXT NOT NULL,
  comment       TEXT,
  acknowledged_warnings TEXT,            -- JSON array of warning titles seen at decision time
  decided_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disputes (
  id                TEXT PRIMARY KEY,
  work_order_id     TEXT NOT NULL REFERENCES work_orders(id),
  status            TEXT NOT NULL CHECK (status IN ('open','resolved')),
  raised_by         TEXT NOT NULL,
  raised_at         TEXT NOT NULL,
  channel           TEXT,
  claim             TEXT NOT NULL,
  requested_outcome TEXT,
  prior_status      TEXT,
  resolution        TEXT,                -- JSON {outcome, decidedAt, by}
  is_demo           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dispute_events (
  id         TEXT PRIMARY KEY,
  dispute_id TEXT NOT NULL REFERENCES disputes(id),
  seq        INTEGER NOT NULL,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  number        TEXT NOT NULL,
  status        TEXT NOT NULL,
  generator     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  snapshot      TEXT NOT NULL            -- JSON report content as generated
);

CREATE TABLE IF NOT EXISTS leads (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  email      TEXT NOT NULL,
  company    TEXT NOT NULL,
  industry   TEXT,
  fleet_size TEXT,
  message    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_log (
  id        TEXT PRIMARY KEY,
  at        TEXT NOT NULL,
  service   TEXT NOT NULL,
  action    TEXT NOT NULL,
  detail    TEXT,
  simulated INTEGER NOT NULL
);

-- Append-only enforcement for evidentiary tables.
CREATE TRIGGER IF NOT EXISTS evidence_no_update        BEFORE UPDATE ON evidence         BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END;
CREATE TRIGGER IF NOT EXISTS evidence_no_delete        BEFORE DELETE ON evidence         BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END;
CREATE TRIGGER IF NOT EXISTS evreview_no_update        BEFORE UPDATE ON evidence_reviews BEGIN SELECT RAISE(ABORT, 'evidence_reviews is append-only'); END;
CREATE TRIGGER IF NOT EXISTS evreview_no_delete        BEFORE DELETE ON evidence_reviews BEGIN SELECT RAISE(ABORT, 'evidence_reviews is append-only'); END;
CREATE TRIGGER IF NOT EXISTS signoffs_no_update        BEFORE UPDATE ON signoffs         BEGIN SELECT RAISE(ABORT, 'signoffs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS signoffs_no_delete        BEFORE DELETE ON signoffs         BEGIN SELECT RAISE(ABORT, 'signoffs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS recreview_no_update       BEFORE UPDATE ON record_reviews   BEGIN SELECT RAISE(ABORT, 'record_reviews is append-only'); END;
CREATE TRIGGER IF NOT EXISTS recreview_no_delete       BEFORE DELETE ON record_reviews   BEGIN SELECT RAISE(ABORT, 'record_reviews is append-only'); END;
CREATE TRIGGER IF NOT EXISTS notes_no_update           BEFORE UPDATE ON work_order_notes BEGIN SELECT RAISE(ABORT, 'work_order_notes is append-only'); END;
CREATE TRIGGER IF NOT EXISTS notes_no_delete           BEFORE DELETE ON work_order_notes BEGIN SELECT RAISE(ABORT, 'work_order_notes is append-only'); END;
CREATE TRIGGER IF NOT EXISTS dspevents_no_update       BEFORE UPDATE ON dispute_events   BEGIN SELECT RAISE(ABORT, 'dispute_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS dspevents_no_delete       BEFORE DELETE ON dispute_events   BEGIN SELECT RAISE(ABORT, 'dispute_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS reports_no_update         BEFORE UPDATE ON reports          BEGIN SELECT RAISE(ABORT, 'reports is append-only'); END;
CREATE TRIGGER IF NOT EXISTS reports_no_delete         BEFORE DELETE ON reports          BEGIN SELECT RAISE(ABORT, 'reports is append-only'); END;
