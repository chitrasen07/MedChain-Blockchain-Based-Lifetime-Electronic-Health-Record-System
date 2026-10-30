ALTER TABLE patients
  DROP CONSTRAINT IF EXISTS patients_status_check;

ALTER TABLE patients
  ADD CONSTRAINT patients_status_check
  CHECK (status IN ('pending', 'confirmed', 'review', 'linked'));

ALTER TABLE review_cases
  ADD COLUMN IF NOT EXISTS case_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS new_patient_id UUID REFERENCES patients(id),
  ADD COLUMN IF NOT EXISTS candidate_patient_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS linked_patient_id UUID REFERENCES patients(id),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS decision TEXT,
  ADD COLUMN IF NOT EXISTS decision_notes TEXT;
ALTER TABLE review_cases
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

ALTER TABLE review_cases
  DROP CONSTRAINT IF EXISTS review_cases_decision_check;

ALTER TABLE review_cases
  ADD CONSTRAINT review_cases_status_check
  CHECK (case_status IN ('pending', 'resolved_same', 'resolved_different', 'rejected', 'closed'));

ALTER TABLE review_cases
  ADD CONSTRAINT review_cases_decision_check
  CHECK (decision IS NULL OR decision IN ('same_patient', 'different_person', 'reject'));

CREATE UNIQUE INDEX IF NOT EXISTS one_pending_review_per_request
  ON review_cases (hospital_id, request_fingerprint)
  WHERE case_status = 'pending';

CREATE INDEX IF NOT EXISTS review_cases_pending_hospital_idx
  ON review_cases (hospital_id, case_status, created_at);
