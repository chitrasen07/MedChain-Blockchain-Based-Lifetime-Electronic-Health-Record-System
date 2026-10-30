CREATE TABLE IF NOT EXISTS registration_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  controller TEXT NOT NULL,
  identity_commitment TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitting', 'submitted', 'confirmed', 'failed', 'unknown')),
  tx_hash TEXT UNIQUE,
  patient_id_on_chain TEXT,
  did_on_chain TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registration_transactions_status_idx
  ON registration_transactions (hospital_id, status, updated_at);
