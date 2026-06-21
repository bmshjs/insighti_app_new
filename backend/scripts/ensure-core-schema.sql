-- 신규/만료 DB 복구용: init-db.sql 이후 누락된 핵심 스키마 보강

ALTER TABLE household
  ADD COLUMN IF NOT EXISTS user_type TEXT DEFAULT 'resident';

ALTER TABLE household
  ADD COLUMN IF NOT EXISTS resident_name_encrypted TEXT;

ALTER TABLE household
  ADD COLUMN IF NOT EXISTS phone_encrypted TEXT;

CREATE TABLE IF NOT EXISTS admin_user (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  last_login TIMESTAMP
);

CREATE TABLE IF NOT EXISTS defect_resolution (
  id SERIAL PRIMARY KEY,
  defect_id TEXT REFERENCES defect(id),
  admin_user_id INTEGER REFERENCES admin_user(id),
  memo TEXT,
  contractor TEXT,
  worker TEXT,
  cost INTEGER,
  resolution_photos TEXT[],
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_email ON admin_user(email);
CREATE INDEX IF NOT EXISTS idx_resolution_defect ON defect_resolution(defect_id);
