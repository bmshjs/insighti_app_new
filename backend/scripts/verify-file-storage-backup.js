/**
 * 배포 서버 file_storage DB 백업 검증
 * 사용: BACKEND_URL=https://insighti-app-new.onrender.com node scripts/verify-file-storage-backup.js
 */
const BASE = process.env.BACKEND_URL || 'https://insighti-app-new.onrender.com';
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function main() {
  console.log('=== file_storage DB 백업 검증 ===');
  console.log('서버:', BASE, '\n');

  const health = await fetch(`${BASE}/health?db=1`).then((r) => r.json());
  console.log('앱 버전:', health.version);
  console.log('DB:', health.database);
  console.log('file_storage:', JSON.stringify(health.file_storage || { note: 'health 응답에 없음 — v4.4.12+ 배포 필요' }, null, 2));

  const login = await fetch(`${BASE}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ complex: 'admin', dong: '000', ho: '000', name: '점검원', phone: '010-0000-0000' }),
  }).then((r) => r.json());
  const token = login.token;
  if (!token) throw new Error('로그인 실패');

  const form = new FormData();
  form.append('photo', new Blob([TINY_PNG], { type: 'image/png' }), `storage-verify-${Date.now()}.png`);
  const upRes = await fetch(`${BASE}/api/upload/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const up = await upRes.json();
  console.log('\n업로드:', upRes.status, up.key);
  console.log('storage_backup:', up.storage_backup ?? '(필드 없음 — v4.4.12+ 배포 필요)');

  if (!up.key) return;

  const serve = await fetch(`${BASE}/api/upload/serve/${encodeURIComponent(up.key)}`);
  console.log('serve:', serve.status, serve.headers.get('content-type'));

  const health2 = await fetch(`${BASE}/health?db=1`).then((r) => r.json());
  console.log('\n업로드 후 file_storage:', JSON.stringify(health2.file_storage || {}, null, 2));
  console.log('\n※ storage_backup=true 이고 file_storage.files가 증가하면 DB 백업 정상');
  console.log('※ 재배포 후에도 serve=200 이면 백업·복구 정상');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
