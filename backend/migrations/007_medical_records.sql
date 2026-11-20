CREATE TABLE IF NOT EXISTS medical_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  category TEXT NOT NULL CHECK (category IN ('diagnosis', 'prescription', 'laboratory', 'allergy', 'treatment', 'visit')),
  version_index INTEGER NOT NULL CHECK (version_index >= 0),
  prior_record_id UUID REFERENCES medical_records(id),
  record_ref TEXT NOT NULL,
  content_ciphertext TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  recorded_on DATE NOT NULL,
  chain_status TEXT NOT NULL DEFAULT 'consent_required' CHECK (chain_status IN ('consent_required', 'anchored', 'mismatch')),
  tx_hash TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (record_ref, version_index)
);

CREATE INDEX IF NOT EXISTS medical_records_patient_idx
  ON medical_records (patient_id, recorded_on, created_at);
