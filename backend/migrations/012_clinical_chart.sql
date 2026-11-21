ALTER TABLE medical_records DROP CONSTRAINT IF EXISTS medical_records_category_check;
ALTER TABLE medical_records ADD CONSTRAINT medical_records_category_check
  CHECK (category IN ('diagnosis', 'prescription', 'laboratory', 'allergy', 'treatment', 'visit', 'vital'));

ALTER TABLE medical_records DROP CONSTRAINT IF EXISTS medical_records_chain_status_check;
ALTER TABLE medical_records ADD CONSTRAINT medical_records_chain_status_check
  CHECK (chain_status IN ('consent_required', 'anchored', 'mismatch', 'failed'));

CREATE TABLE IF NOT EXISTS patient_profile_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  content_ciphertext TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_profile_notes_patient_idx
  ON patient_profile_notes (patient_id, created_at);

CREATE TABLE IF NOT EXISTS clinical_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  actor_id UUID REFERENCES users(id),
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'record_created',
    'record_viewed',
    'record_corrected',
    'record_anchored',
    'summary_exported'
  )),
  category TEXT,
  version_index INTEGER,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinical_audit_events_patient_idx
  ON clinical_audit_events (patient_id, created_at);
