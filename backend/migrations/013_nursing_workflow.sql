ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS correction_reason_ciphertext TEXT;

ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'reviewed';

ALTER TABLE medical_records DROP CONSTRAINT IF EXISTS medical_records_workflow_status_check;
ALTER TABLE medical_records ADD CONSTRAINT medical_records_workflow_status_check
  CHECK (workflow_status IN ('draft', 'pending_review', 'reviewed'));

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'clinical_audit_events'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%record_created%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE clinical_audit_events DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE clinical_audit_events ADD CONSTRAINT clinical_audit_events_action_check
  CHECK (action IN (
    'record_created',
    'record_viewed',
    'record_corrected',
    'record_anchored',
    'summary_exported',
    'intake_created',
    'intake_viewed',
    'intake_reviewed',
    'intake_rejected'
  ));

CREATE TABLE IF NOT EXISTS nursing_intake (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  kind TEXT NOT NULL CHECK (kind IN ('vital', 'visit_note', 'laboratory')),
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'reviewed', 'rejected')),
  content_ciphertext TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  review_note_ciphertext TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  promoted_record_id UUID REFERENCES medical_records(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nursing_intake_hospital_status_idx
  ON nursing_intake (hospital_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS nursing_intake_patient_idx
  ON nursing_intake (patient_id, created_at DESC);
