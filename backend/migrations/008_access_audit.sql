CREATE TABLE IF NOT EXISTS clinical_wallet_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clinical_wallet_challenges_wallet_check CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT clinical_wallet_challenges_nonce_check CHECK (nonce ~ '^0x[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS clinical_wallet_challenges_user_idx
  ON clinical_wallet_challenges (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS clinical_wallet_sessions (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  wallet_address TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT clinical_wallet_sessions_wallet_check CHECK (wallet_address ~ '^0x[0-9a-f]{40}$')
);

CREATE TABLE IF NOT EXISTS access_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  patient_ref TEXT NOT NULL,
  actor_wallet TEXT NOT NULL,
  action_code TEXT NOT NULL,
  reason_ciphertext TEXT,
  reason_hash TEXT,
  tx_hash TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_audit_events_patient_idx
  ON access_audit_events (patient_id, created_at);
