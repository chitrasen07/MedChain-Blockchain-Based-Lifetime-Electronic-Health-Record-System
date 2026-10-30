CREATE TABLE IF NOT EXISTS hospitals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('receptionist', 'hospital_staff', 'doctor', 'reviewer', 'administrator'));

ALTER TABLE users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'disabled'));

ALTER TABLE users
  ADD CONSTRAINT users_hospital_fk
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) NOT VALID;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS hospital_id TEXT;

ALTER TABLE patients
  ADD CONSTRAINT patients_hospital_fk
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) NOT VALID;

ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS hospital_id TEXT;

ALTER TABLE visits
  ADD CONSTRAINT visits_hospital_fk
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) NOT VALID;

ALTER TABLE review_cases
  ADD COLUMN IF NOT EXISTS hospital_id TEXT;

ALTER TABLE review_cases
  ADD CONSTRAINT review_cases_hospital_fk
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) NOT VALID;

CREATE INDEX IF NOT EXISTS users_hospital_status_idx ON users (hospital_id, status);
CREATE INDEX IF NOT EXISTS patients_hospital_patient_id_idx ON patients (hospital_id, patient_id);
CREATE INDEX IF NOT EXISTS review_cases_hospital_decision_idx ON review_cases (hospital_id, decision);
