/**
 * Render 등에서 DATABASE_URL 호스트명이 잘리는 경우를 보정하고,
 * DB_HOST/DB_USER 등 개별 env 로 URL 을 조합합니다.
 */

const RENDER_HOST_RE = /^dpg-[a-z0-9]+-[a-z]$/i;

function normalizeDatabaseUrl(rawUrl) {
  if (!rawUrl || !String(rawUrl).trim()) {
    return null;
  }

  let url = String(rawUrl).trim();

  try {
    const parsed = new URL(url);
    const host = parsed.hostname;

    if (RENDER_HOST_RE.test(host)) {
      const region = process.env.RENDER_REGION || 'singapore';
      parsed.hostname = `${host}.${region}-postgres.render.com`;
      url = parsed.toString();
      console.log(`📊 DATABASE_URL hostname normalized: ${parsed.hostname}`);
    }

    if (!parsed.port) {
      parsed.port = '5432';
      url = parsed.toString();
    }
  } catch (error) {
    console.warn('⚠️ DATABASE_URL parse warning:', error.message);
  }

  return url;
}

function buildDatabaseUrlFromParts() {
  const host = process.env.DB_HOST && process.env.DB_HOST.trim();
  const name = process.env.DB_NAME && process.env.DB_NAME.trim();
  const user = process.env.DB_USER && process.env.DB_USER.trim();
  const password = process.env.DB_PASSWORD != null ? String(process.env.DB_PASSWORD) : '';
  const port = process.env.DB_PORT || '5432';

  if (!host || !name || !user) {
    return null;
  }

  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  const auth = password ? `${encodedUser}:${encodedPassword}` : encodedUser;

  return normalizeDatabaseUrl(`postgresql://${auth}@${host}:${port}/${name}`);
}

function resolveDatabaseUrl() {
  const fromEnv = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (fromEnv) {
    return fromEnv;
  }
  return buildDatabaseUrlFromParts();
}

function isLocalDatabaseUrl(url) {
  if (!url) {
    return true;
  }
  return /(?:localhost|127\.0\.0\.1)/i.test(url);
}

function getPoolSslConfig(url) {
  return isLocalDatabaseUrl(url) ? false : { rejectUnauthorized: false };
}

module.exports = {
  normalizeDatabaseUrl,
  buildDatabaseUrlFromParts,
  resolveDatabaseUrl,
  isLocalDatabaseUrl,
  getPoolSslConfig,
};
