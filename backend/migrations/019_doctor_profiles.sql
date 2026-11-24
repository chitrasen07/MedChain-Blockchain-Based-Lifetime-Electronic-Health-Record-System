CREATE TABLE IF NOT EXISTS doctor_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  biography TEXT,
  specialization TEXT,
  registration_number TEXT,
  registration_council TEXT,
  experience_years INTEGER,
  department TEXT,
  designation TEXT,
  languages TEXT,
  consultation_hours TEXT,
  photo_key TEXT,
  photo_content_type TEXT,
  status TEXT NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete', 'pending', 'verified', 'changes_requested')),
  review_note TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS doctor_profiles_hospital_idx
  ON doctor_profiles (hospital_id, status);

CREATE TABLE IF NOT EXISTS doctor_qualifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  degree TEXT NOT NULL,
  institution TEXT NOT NULL,
  graduation_year INTEGER,
  extra TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS doctor_qualifications_user_idx
  ON doctor_qualifications (user_id, position);
