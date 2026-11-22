CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID NOT NULL REFERENCES users(id),
  requested_start TIMESTAMPTZ NOT NULL,
  confirmed_start TIMESTAMPTZ,
  confirmed_end TIMESTAMPTZ,
  duration_minutes INTEGER,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  reason_ciphertext TEXT,
  notes_ciphertext TEXT,
  rejection_ciphertext TEXT,
  department TEXT,
  room TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rescheduled', 'rejected', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT appointments_confirmed_range CHECK (
    (confirmed_start IS NULL AND confirmed_end IS NULL)
    OR (confirmed_end > confirmed_start)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_pending_request
  ON appointments (patient_id, doctor_id, requested_start)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS appointments_patient_idx
  ON appointments (patient_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS appointments_doctor_idx
  ON appointments (doctor_id, status, confirmed_start);
