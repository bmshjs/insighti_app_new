/**
 * 업로드 이미지 DB 백업 — Render 재배포(ephemeral disk) 후에도 보고서·화면에서 사진 제공
 */
const pool = require('../database');

function extractFilename(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  let s = String(fileUrl).trim();
  const serveMatch = s.match(/\/api\/upload\/serve\/(.+)$/i);
  if (serveMatch) {
    try {
      return decodeURIComponent(serveMatch[1]);
    } catch (_) {
      return serveMatch[1];
    }
  }
  const uploadsMatch = s.match(/\/uploads\/(.+)$/i) || s.match(/^uploads\/(.+)$/i);
  if (uploadsMatch) return uploadsMatch[1];
  if (!s.includes('/') && /\.(jpe?g|png|webp)$/i.test(s)) return s;
  return null;
}

async function ensureFileStorageTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS file_storage (
        filename TEXT PRIMARY KEY,
        content_type TEXT NOT NULL DEFAULT 'image/jpeg',
        data BYTEA NOT NULL,
        size INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_file_storage_created_at ON file_storage(created_at)
    `);
    return true;
  } catch (err) {
    console.error('[fileStorage] ensure table failed:', err.message);
    return false;
  }
}

async function getFileStorageStats() {
  try {
    const result = await pool.query(`
      SELECT COUNT(*)::int AS files, COALESCE(SUM(size), 0)::bigint AS total_bytes
      FROM file_storage
    `);
    return { ok: true, table_exists: true, ...result.rows[0] };
  } catch (err) {
    const missing = (err.message || '').includes('file_storage') && (err.message || '').includes('does not exist');
    return { ok: false, table_exists: !missing, error: err.message };
  }
}

async function fileExistsInStorage(filename) {
  if (!filename) return false;
  try {
    const result = await pool.query(
      'SELECT 1 FROM file_storage WHERE filename = $1 LIMIT 1',
      [filename]
    );
    return result.rows.length > 0;
  } catch (_) {
    return false;
  }
}

async function saveFileToStorage(filename, buffer, contentType = 'image/jpeg') {
  if (!filename || !buffer || !buffer.length) return false;
  try {
    await ensureFileStorageTable();
    await pool.query(
      `INSERT INTO file_storage (filename, content_type, data, size)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (filename) DO UPDATE SET
         content_type = EXCLUDED.content_type,
         data = EXCLUDED.data,
         size = EXCLUDED.size,
         created_at = NOW()`,
      [filename, contentType, buffer, buffer.length]
    );
    return true;
  } catch (err) {
    console.error('[fileStorage] save failed:', filename, err.message);
    return false;
  }
}

async function loadFileFromStorage(filename) {
  if (!filename) return null;
  try {
    const result = await pool.query(
      'SELECT data, content_type FROM file_storage WHERE filename = $1 LIMIT 1',
      [filename]
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      buffer: row.data,
      contentType: row.content_type || 'image/jpeg',
    };
  } catch (err) {
    if ((err.message || '').includes('file_storage') && (err.message || '').includes('does not exist')) {
      return null;
    }
    console.warn('[fileStorage] load failed:', err.message);
    return null;
  }
}

async function loadFileFromStorageByUrl(fileUrl) {
  const filename = extractFilename(fileUrl);
  if (!filename) return null;
  return loadFileFromStorage(filename);
}

/** 서버 디스크에 남아 있는 업로드 파일을 DB로 백업 (재배포 전·무중단 재시작 시) */
async function backfillUploadsFromDisk(uploadDir) {
  const fs = require('fs');
  const path = require('path');
  if (!uploadDir || !fs.existsSync(uploadDir)) return 0;
  let count = 0;

  async function walk(dir, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full, rel);
      } else if (ent.isFile()) {
        try {
          const buf = fs.readFileSync(full);
          if (buf.length > 0) {
            const ext = path.extname(ent.name).toLowerCase();
            const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
            const saved = await saveFileToStorage(rel.replace(/\\/g, '/'), buf, mime);
            if (saved) count += 1;
          }
        } catch (_) {
          /* skip */
        }
      }
    }
  }

  await walk(uploadDir);
  if (count > 0) console.log(`[fileStorage] backfilled ${count} file(s) from disk to DB`);
  return count;
}

module.exports = {
  extractFilename,
  ensureFileStorageTable,
  getFileStorageStats,
  fileExistsInStorage,
  saveFileToStorage,
  loadFileFromStorage,
  loadFileFromStorageByUrl,
  backfillUploadsFromDisk,
};
