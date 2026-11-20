ALTER TABLE patients
  DROP CONSTRAINT IF EXISTS patients_status_check;

ALTER TABLE patients
  ADD CONSTRAINT patients_status_check
  CHECK (status IN ('pending', 'confirmed', 'review', 'linked', 'registration_failed'));

UPDATE patients AS patient
SET status = 'registration_failed', updated_at = now()
WHERE patient.status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM registration_transactions AS registration
    WHERE registration.patient_id = patient.id
      AND registration.status = 'failed'
      AND registration.tx_hash IS NULL
      AND registration.last_error = 'duplicate identity commitment'
  );
