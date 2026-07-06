-- 점검원 하자목록·점검결과 API용 스키마 (idempotent)
-- migrate-phase1.sql 이 중간에 실패한 DB에서도 inspection_item 등을 보강합니다.

CREATE TABLE IF NOT EXISTS inspection_item (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES case_header(id),
  type TEXT,
  location TEXT NOT NULL DEFAULT '',
  trade TEXT,
  note TEXT,
  result TEXT,
  created_at TIMESTAMP DEFAULT now()
);

ALTER TABLE inspection_item ADD COLUMN IF NOT EXISTS defect_id TEXT;

ALTER TABLE inspection_item DROP CONSTRAINT IF EXISTS inspection_item_type_check;

CREATE INDEX IF NOT EXISTS idx_inspection_case ON inspection_item(case_id);
CREATE INDEX IF NOT EXISTS idx_inspection_type ON inspection_item(type);
CREATE INDEX IF NOT EXISTS idx_inspection_defect ON inspection_item(defect_id);

CREATE TABLE IF NOT EXISTS air_measure (
  id SERIAL PRIMARY KEY,
  item_id TEXT REFERENCES inspection_item(id),
  tvoc DECIMAL(5,2),
  hcho DECIMAL(5,2),
  co2 DECIMAL(5,2),
  unit_tvoc TEXT DEFAULT 'mg/m³',
  unit_hcho TEXT DEFAULT 'mg/m³',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radon_measure (
  id SERIAL PRIMARY KEY,
  item_id TEXT REFERENCES inspection_item(id),
  radon DECIMAL(8,2),
  unit_radon TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS level_measure (
  id SERIAL PRIMARY KEY,
  item_id TEXT REFERENCES inspection_item(id),
  left_mm DECIMAL(5,1),
  right_mm DECIMAL(5,1),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thermal_photo (
  id TEXT PRIMARY KEY,
  item_id TEXT REFERENCES inspection_item(id),
  file_url TEXT NOT NULL,
  caption TEXT,
  shot_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_air_measure_item ON air_measure(item_id);
CREATE INDEX IF NOT EXISTS idx_radon_measure_item ON radon_measure(item_id);
CREATE INDEX IF NOT EXISTS idx_level_measure_item ON level_measure(item_id);
CREATE INDEX IF NOT EXISTS idx_thermal_photo_item ON thermal_photo(item_id);
