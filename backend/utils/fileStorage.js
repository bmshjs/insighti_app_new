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

async function saveFileToStorage(filename, buffer, contentType = 'image/jpeg') {
  if (!filename || !buffer || !buffer.length) return false;
  try {
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
    if ((err.message || '').includes('file_storage') && (err.message || '').includes('does not exist')) {
      return false;
    }
    console.warn('[fileStorage] save failed:', err.message);
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
  saveFileToStorage,
  loadFileFromStorage,
  loadFileFromStorageByUrl,
  backfillUploadsFromDisk,
};
