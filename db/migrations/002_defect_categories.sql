-- 하자 표준 DB: defect_categories / defect_videos
-- 테이블이 없거나 데이터가 비어 있을 때 실행 (기존 DB 복구용)
-- 적용: psql "$DATABASE_URL" -f db/migrations/002_defect_categories.sql
-- 또는: cd backend && npm run migrate:defect-categories

CREATE TABLE IF NOT EXISTS defect_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  solution TEXT,
  severity VARCHAR(20) CHECK (severity IN ('경미','보통','심각')),
  category VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS defect_videos (
  id SERIAL PRIMARY KEY,
  defect_category_id INTEGER REFERENCES defect_categories(id) ON DELETE CASCADE,
  youtube_video_id VARCHAR(50),
  youtube_url VARCHAR(200),
  title TEXT,
  description TEXT,
  timestamp_start INTEGER DEFAULT 0,
  timestamp_end INTEGER,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defect_categories_name ON defect_categories(name);
CREATE INDEX IF NOT EXISTS idx_defect_categories_category ON defect_categories(category);
CREATE INDEX IF NOT EXISTS idx_defect_videos_category ON defect_videos(defect_category_id);

INSERT INTO defect_categories (name, description, solution, severity, category) VALUES
('벽지찢김', '벽체부위 벽지파손은 위치별 크기별로 다르나 보수로 처리가능한', '벽지 교체 또는 부분 보수', '보통', '벽체'),
('벽균열', '벽체에 발생한 균열로 건물의 구조적 문제를 나타낼 수 있음', '균열 폭과 깊이에 따라 구조보수 또는 표면처리', '심각', '벽체'),
('마루판들뜸', '바닥 마루판이 들뜨거나 움직이는 현상', '마루판 재시공 또는 접착제 보강', '보통', '바닥'),
('타일균열', '타일 표면 또는 접합부에 발생한 균열', '타일 교체 또는 시공재 시공', '보통', '타일'),
('페인트벗겨짐', '도장 표면이 벗겨지거나 박리되는 현상', '표면 정리 후 재도장', '경미', '도장'),
('천장누수', '천장에서 물이 스며나오거나 누수 흔적이 보임', '누수 원인 파악 후 방수처리', '심각', '천장'),
('욕실곰팡이', '욕실 벽면이나 천장에 발생한 곰팡이', '곰팡이 제거 후 방습처리', '보통', '욕실'),
('문틀변형', '문틀이 변형되어 문이 제대로 닫히지 않음', '문틀 교체 또는 보정', '보통', '기타'),
('콘센트불량', '콘센트가 제대로 작동하지 않거나 느슨함', '전기공사 필요', '심각', '기타'),
('창문잠금불량', '창문 잠금장치가 제대로 작동하지 않음', '잠금장치 교체', '보통', '기타')
ON CONFLICT (name) DO NOTHING;

INSERT INTO defect_videos (defect_category_id, youtube_video_id, youtube_url, title, description, timestamp_start, timestamp_end, is_primary)
SELECT dc.id, 'USQGTW34lO8', 'https://youtu.be/USQGTW34lO8', '벽지 보수 방법', '벽지 찢김 현상 확인 및 보수 방법', 0, 300, TRUE
FROM defect_categories dc
WHERE dc.name = '벽지찢김'
  AND NOT EXISTS (SELECT 1 FROM defect_videos dv WHERE dv.defect_category_id = dc.id);

INSERT INTO defect_videos (defect_category_id, youtube_video_id, youtube_url, title, description, timestamp_start, timestamp_end, is_primary)
SELECT dc.id, 'USQGTW34lO8', 'https://youtu.be/USQGTW34lO8', '벽균열 진단', '벽균열의 원인과 진단 방법', 300, 600, TRUE
FROM defect_categories dc
WHERE dc.name = '벽균열'
  AND NOT EXISTS (SELECT 1 FROM defect_videos dv WHERE dv.defect_category_id = dc.id);

INSERT INTO defect_videos (defect_category_id, youtube_video_id, youtube_url, title, description, timestamp_start, timestamp_end, is_primary)
SELECT dc.id, 'USQGTW34lO8', 'https://youtu.be/USQGTW34lO8', '마루판 보수', '마루판 들뜸 현상 및 보수 방법', 600, 900, TRUE
FROM defect_categories dc
WHERE dc.name = '마루판들뜸'
  AND NOT EXISTS (SELECT 1 FROM defect_videos dv WHERE dv.defect_category_id = dc.id);

