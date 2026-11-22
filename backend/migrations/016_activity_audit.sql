ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS hospital_id TEXT REFERENCES hospitals(id),
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id),
  ADD COLUMN IF NOT EXISTS actor_role TEXT,
  ADD COLUMN IF NOT EXISTS actor_label TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'hospital',
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_events_outcome_check'
  ) THEN
    ALTER TABLE audit_events
      ADD CONSTRAINT audit_events_outcome_check CHECK (outcome IN ('success', 'failure', 'denied'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_events_hospital_idx
  ON audit_events (hospital_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_patient_idx
  ON audit_events (patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_actor_idx
  ON audit_events (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS clinical_audit_events_actor_action_idx
  ON clinical_audit_events (patient_id, action, created_at DESC);
