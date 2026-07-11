-- 업로드 파일 DB 백업 (Render ephemeral disk 대비 — 재배포 후에도 사진 유지)
CREATE TABLE IF NOT EXISTS file_storage (
  filename TEXT PRIMARY KEY,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  data BYTEA NOT NULL,
  size INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_storage_created_at ON file_storage(created_at);
