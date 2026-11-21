CREATE TABLE IF NOT EXISTS patient_demographic_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  content_ciphertext TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_demographic_corrections_patient_idx
  ON patient_demographic_corrections (patient_id, created_at);

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
    'intake_rejected',
    'demographic_corrected'
  ));
