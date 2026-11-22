CREATE TABLE IF NOT EXISTS medical_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  uploader_user_id UUID REFERENCES users(id),
  uploader_role TEXT NOT NULL CHECK (uploader_role IN ('patient', 'doctor')),
  uploader_label TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('xray', 'blood_test', 'mri_ct', 'ecg', 'prescription', 'other')),
  filename_ciphertext TEXT NOT NULL,
  description_ciphertext TEXT,
  storage_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS medical_files_patient_idx
  ON medical_files (patient_id, created_at DESC);
