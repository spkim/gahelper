-- Setup Copilot — 초기 스키마
-- 원칙: append-only. page_snapshots, procedures 는 물리 삭제 금지.

CREATE TABLE IF NOT EXISTS sites (
  site_id      TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  matches      JSONB NOT NULL,
  entry_url    TEXT NOT NULL,
  entry_ready  JSONB,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pages (
  page_id             TEXT PRIMARY KEY,
  site_id             TEXT NOT NULL REFERENCES sites(site_id),
  route               TEXT NOT NULL,
  label               TEXT NOT NULL,
  canonical_probes    JSONB NOT NULL DEFAULT '{}'::jsonb,
  latest_snapshot_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pages_site ON pages(site_id);

CREATE TABLE IF NOT EXISTS page_snapshots (
  snapshot_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id            TEXT NOT NULL REFERENCES pages(page_id),
  structural_hash    TEXT NOT NULL,
  dom_signature      JSONB NOT NULL DEFAULT '[]'::jsonb,
  observed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  observed_count     INTEGER NOT NULL DEFAULT 0,
  contributor_count  INTEGER NOT NULL DEFAULT 0,
  superseded_by      UUID REFERENCES page_snapshots(snapshot_id),
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','deprecated','rejected')),
  diff_summary       JSONB,
  source             TEXT NOT NULL DEFAULT 'contributed'
                     CHECK (source IN ('seed','contributed','scraped'))
);
CREATE INDEX IF NOT EXISTS idx_snapshots_page ON page_snapshots(page_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_hash ON page_snapshots(structural_hash);

ALTER TABLE pages
  ADD CONSTRAINT fk_pages_latest_snapshot
  FOREIGN KEY (latest_snapshot_id) REFERENCES page_snapshots(snapshot_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS goals (
  goal_id        TEXT PRIMARY KEY,
  site_id        TEXT NOT NULL REFERENCES sites(site_id),
  label          TEXT NOT NULL,
  synonyms       JSONB NOT NULL DEFAULT '[]'::jsonb,
  procedure_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goals_site ON goals(site_id);

CREATE TABLE IF NOT EXISTS procedures (
  procedure_id           TEXT PRIMARY KEY,
  goal_id                TEXT NOT NULL REFERENCES goals(goal_id),
  page_id                TEXT NOT NULL REFERENCES pages(page_id),
  compatible_snapshots   JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps                  JSONB NOT NULL,
  authored_by            TEXT NOT NULL DEFAULT 'human'
                         CHECK (authored_by IN ('human','llm_proposed','community_edit')),
  verified               BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by            TEXT,
  verified_at            TIMESTAMPTZ,
  supersedes             TEXT REFERENCES procedures(procedure_id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 스펙 5번째 원칙: verify 없는 step 저장 금지
  CONSTRAINT steps_all_have_verify CHECK (
    jsonb_typeof(steps) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(steps) s
      WHERE s->'verify' IS NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_procedures_goal ON procedures(goal_id);
CREATE INDEX IF NOT EXISTS idx_procedures_page ON procedures(page_id);

CREATE TABLE IF NOT EXISTS contributions (
  contribution_id      BIGSERIAL PRIMARY KEY,
  page_id              TEXT NOT NULL REFERENCES pages(page_id),
  snapshot_id          UUID NOT NULL REFERENCES page_snapshots(snapshot_id),
  raw_signature_hash   TEXT NOT NULL,
  scrubbed_signature   JSONB NOT NULL,
  contributor_hash     TEXT NOT NULL,
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_type          TEXT NOT NULL
                       CHECK (change_type IN ('match','new_snapshot','drift_detected')),
  UNIQUE (contributor_hash, raw_signature_hash)
);
CREATE INDEX IF NOT EXISTS idx_contributions_snapshot ON contributions(snapshot_id);

CREATE TABLE IF NOT EXISTS guidance_proposals (
  proposal_id       BIGSERIAL PRIMARY KEY,
  snapshot_id       UUID NOT NULL REFERENCES page_snapshots(snapshot_id),
  draft_procedure   JSONB NOT NULL,
  llm_model         TEXT NOT NULL,
  web_search_refs   JSONB NOT NULL DEFAULT '[]'::jsonb,
  observed_only     BOOLEAN NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  reviews           JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- observed_only=false 인 초안은 저장 금지
  CONSTRAINT proposals_must_be_grounded CHECK (observed_only = TRUE)
);
CREATE INDEX IF NOT EXISTS idx_proposals_snapshot ON guidance_proposals(snapshot_id);
