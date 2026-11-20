ALTER TABLE users
  ADD COLUMN IF NOT EXISTS full_name TEXT;

CREATE TABLE IF NOT EXISTS staff_wallet_challenges (
  nonce TEXT PRIMARY KEY CHECK (nonce ~ '^0x[0-9a-f]{64}$'),
  wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_chain_authorizations (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_role TEXT NOT NULL CHECK (chain_role IN ('DOCTOR', 'NURSE', 'LAB_TECHNICIAN', 'PHARMACIST', 'SPECIALIST')),
  previous_chain_role TEXT CHECK (previous_chain_role IS NULL OR previous_chain_role IN ('DOCTOR', 'NURSE', 'LAB_TECHNICIAN', 'PHARMACIST', 'SPECIALIST')),
  previous_wallet_address TEXT CHECK (previous_wallet_address IS NULL OR previous_wallet_address ~ '^0x[0-9a-f]{40}$'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'failed')),
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  tx_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_chain_authorizations_wallet_key UNIQUE (wallet_address)
);
