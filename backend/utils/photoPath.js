/**
 * file_url → 서버 내 절대 경로 / HTTP / DB 백업으로 이미지 바이트 로드
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const config = require('../config');
const { loadFileFromStorageByUrl } = require('./fileStorage');

const UPLOADS_DIR = path.isAbsolute(config.upload.dir)
  ? config.upload.dir
  : path.join(__dirname, '..', config.upload.dir.replace(/^\.\//, ''));

const PUBLIC_BASE_URL = (process.env.BACKEND_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

function getPublicBaseUrls() {
  const urls = [];
  if (PUBLIC_BASE_URL) urls.push(PUBLIC_BASE_URL);
  urls.push('https://insighti-app-new.onrender.com');
  const port = process.env.PORT || 3000;
  urls.push(`http://127.0.0.1:${port}`);
  return [...new Set(urls.filter(Boolean))];
}

function extractUploadSubpath(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  let rel = String(fileUrl).trim();
  const serveMatch = rel.match(/^\/?api\/upload\/serve\/(.+)$/i);
  if (serveMatch) {
    try {
      return decodeURIComponent(serveMatch[1]);
    } catch (_) {
      return serveMatch[1];
    }
  }
  const urlMatch = rel.match(/^https?:\/\/[^/]+(\/(?:uploads|api\/upload\/serve)\/.+)$/i);
  if (urlMatch) rel = urlMatch[1];
  rel = rel.replace(/^\//, '');
  if (rel.startsWith('api/upload/serve/')) {
    try {
      return decodeURIComponent(rel.replace(/^api\/upload\/serve\//, ''));
    } catch (_) {
      return rel.replace(/^api\/upload\/serve\//, '');
    }
  }
  if (!rel || !rel.startsWith('uploads')) return null;
  return rel.replace(/^uploads\/?/, '') || null;
}

function getPhotoPath(fileUrl) {
  const sub = extractUploadSubpath(fileUrl);
  if (!sub) return null;
  let full = path.join(UPLOADS_DIR, sub);
  if (fs.existsSync(full)) return full;
  const baseName = path.basename(sub);
  if (baseName && baseName !== sub) {
    const alt = path.join(UPLOADS_DIR, baseName);
    if (fs.existsSync(alt)) return alt;
  }
  return null;
}

function resolvePhotoHttpUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  const u = String(fileUrl).trim();
  if (/^https?:\/\//i.test(u)) return u;
  const sub = extractUploadSubpath(u);
  const bases = getPublicBaseUrls();
  for (const base of bases) {
    if (sub && !u.includes('/api/upload/serve/')) {
      return `${base}/api/upload/serve/${encodeURIComponent(path.basename(sub))}`;
    }
    if (u.startsWith('/')) return `${base}${u}`;
    if (u) return `${base}/${u}`;
  }
  return null;
}

function resolvePhotoHttpUrls(fileUrl) {
  const primary = resolvePhotoHttpUrl(fileUrl);
  const urls = [];
  if (primary) urls.push(primary);
  const sub = extractUploadSubpath(fileUrl);
  if (sub) {
    for (const base of getPublicBaseUrls()) {
      urls.push(`${base}/api/upload/serve/${encodeURIComponent(path.basename(sub))}`);
    }
  }
  if (/^https?:\/\//i.test(String(fileUrl || '').trim())) {
    urls.push(String(fileUrl).trim());
  }
  return [...new Set(urls)];
}

function fetchUrlBuffer(url, redirects = 0) {
  return new Promise((resolve) => {
    if (!url || redirects > 5) return resolve(null);
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(fetchUrlBuffer(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', () => resolve(null));
  });
}

/** 로컬 uploads → DB 백업 → BACKEND_URL HTTP 순으로 이미지 로드 */
async function loadImageBytes(fileUrl) {
  const localPath = getPhotoPath(fileUrl);
  if (localPath && fs.existsSync(localPath)) {
    try {
      const buf = fs.readFileSync(localPath);
      if (buf && buf.length > 10) return buf;
    } catch (_) {
      /* continue */
    }
  }

  const fromDb = await loadFileFromStorageByUrl(fileUrl);
  if (fromDb && fromDb.buffer && fromDb.buffer.length > 10) {
    return fromDb.buffer;
  }

  const httpUrls = resolvePhotoHttpUrls(fileUrl);
  for (const httpUrl of httpUrls) {
    const remote = await fetchUrlBuffer(httpUrl);
    if (remote && remote.length > 100) return remote;
  }
  return null;
}

module.exports = {
  getPhotoPath,
  loadImageBytes,
  resolvePhotoHttpUrl,
  resolvePhotoHttpUrls,
  extractUploadSubpath,
  UPLOADS_DIR,
  PUBLIC_BASE_URL,
};
