CREATE TABLE IF NOT EXISTS patient_auth_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT patient_auth_challenges_wallet_check CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT patient_auth_challenges_nonce_check CHECK (nonce ~ '^0x[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS patient_auth_challenges_patient_idx
  ON patient_auth_challenges (patient_id, created_at DESC);
