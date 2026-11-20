CREATE TABLE IF NOT EXISTS registration_wallet_challenges (
  nonce TEXT PRIMARY KEY CHECK (nonce ~ '^0x[0-9a-f]{64}$'),
  wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
