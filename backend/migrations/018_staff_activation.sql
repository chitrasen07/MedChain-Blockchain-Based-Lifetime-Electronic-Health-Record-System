ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'disabled', 'pending'));

CREATE TABLE IF NOT EXISTS staff_activation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  code_hash TEXT NOT NULL,
  chain_role TEXT CHECK (chain_role IS NULL OR chain_role IN ('DOCTOR', 'NURSE', 'LAB_TECHNICIAN', 'PHARMACIST', 'SPECIALIST')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_activation_codes_one_open
  ON staff_activation_codes (user_id)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS staff_activation_codes_user_idx
  ON staff_activation_codes (user_id, created_at DESC);
