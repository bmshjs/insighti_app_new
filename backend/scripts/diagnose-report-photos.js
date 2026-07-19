/**
 * 종합점검보고서 사진 진단 — 배포 서버 점검 데이터·serve·PDF 이미지 수 확인
 * 사용: BACKEND_URL=https://insighti-app-new.onrender.com node scripts/diagnose-report-photos.js [householdId]
 */
const { PDFDocument, PDFName } = require('pdf-lib');

const BASE = process.env.BACKEND_URL || 'https://insighti-app-new.onrender.com';
const householdIdArg = process.argv[2] ? parseInt(process.argv[2], 10) : null;

async function request(method, path, body = null, token = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(json.error || json.message || `HTTP ${res.status}`);
  return json;
}

function filenameFromUrl(url) {
  if (!url) return null;
  const s = String(url).trim();
  const m = s.match(/\/uploads\/(.+)$/i) || s.match(/^uploads\/(.+)$/i);
  if (m) return m[1];
  const serve = s.match(/\/api\/upload\/serve\/(.+)$/i);
  if (serve) {
    try { return decodeURIComponent(serve[1]); } catch (_) { return serve[1]; }
  }
  return null;
}

async function checkServe(url) {
  const fn = filenameFromUrl(url);
  if (!fn) return { status: 'bad-url', fn: null };
  const res = await fetch(`${BASE}/api/upload/serve/${encodeURIComponent(fn)}`);
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, fn, ok: res.ok, contentType: ct };
}

async function countPdfImages(buf) {
  const doc = await PDFDocument.load(buf);
  let images = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj?.constructor?.name === 'PDFRawStream') {
      const st = obj.dict?.get?.(PDFName.of('Subtype'));
      if (st?.toString() === '/Image') images += 1;
    }
  }
  return { pages: doc.getPageCount(), images };
}

async function main() {
  console.log('=== 종합점검보고서 사진 진단 ===');
  console.log('서버:', BASE, '\n');

  const login = await request('POST', '/api/auth/session', {
    complex: 'admin', dong: '000', ho: '000', name: '점검원', phone: '010-0000-0000',
  });
  const token = login.token;

  let householdId = householdIdArg;
  if (!householdId) {
    const users = await request('GET', '/api/defects/users', null, token);
    const list = users.users || users || [];
    householdId = list[0]?.household_id ?? list[0]?.id;
    console.log('기본 세대:', list[0]?.dong, list[0]?.ho, 'householdId=', householdId);
  }

  const insp = await request('GET', `/api/inspections/by-household/${householdId}`, null, token);
  const grouped = insp.inspections || {};

  const tplRes = await fetch(`${BASE}/`);
  const ver = await tplRes.json().catch(() => ({}));

  console.log('앱 버전:', ver.version || '-');
  console.log('육안 BLOCKS_PER_PAGE=4, 열화상 BLOCKS_PER_PAGE=4, 항목당 사진 최대 2장\n');

  for (const type of ['visual', 'thermal']) {
    const items = grouped[type] || [];
    console.log(`--- ${type} 점검 ${items.length}건 (보고서 페이지 최대 4건) ---`);
    items.forEach((it, i) => {
      const photos = it.photos || [];
      const inReport = i < 4 ? 'O' : 'X(5번째부터 미표시)';
      console.log(` [${i + 1}] ${it.location || '-'} | 사진 ${photos.length}장 | 보고서블록: ${inReport}`);
      photos.forEach((p, pi) => {
        const url = p.file_url || p.url || '';
        const slot = pi < 2 ? (pi === 0 ? '좌슬롯' : '우슬롯') : 'X(3번째부터 미표시)';
        const inBlock = i < 4 && pi < 2 ? '포함' : '제외';
        checkServe(url).then((r) => {
          // sync below via await in loop
        });
      });
    });

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const photos = it.photos || [];
      for (let pi = 0; pi < photos.length; pi++) {
        const url = photos[pi].file_url || photos[pi].url || '';
        const r = await checkServe(url);
        const slot = pi < 2 ? (pi === 0 ? '좌' : '우') : '초과';
        const block = i < 4 ? `${i + 1}번블록` : '블록없음';
        console.log(
          `   사진[${i + 1}-${pi + 1}] ${block}/${slot} serve=${r.status} ${r.ok ? 'OK' : 'FAIL'} ${r.fn || url}`
        );
      }
    }
    console.log('');
  }

  console.log('--- 보고서 생성 및 PDF 이미지 수 ---');
  const gen = await request('POST', '/api/reports/generate', {
    household_id: householdId,
    template: 'final-report',
  }, token);
  console.log('생성:', gen.filename, 'size=', gen.size);

  const pdfBuf = Buffer.from(await (await fetch(`${BASE}${gen.url}`)).arrayBuffer());
  const pdfInfo = await countPdfImages(pdfBuf);
  console.log('PDF 페이지:', pdfInfo.pages, '내장이미지:', pdfInfo.images);

  const tplPath = require('path').join(__dirname, '..', 'templates', '종합점검보고서_0719.pdf');
  const fs = require('fs');
  if (fs.existsSync(tplPath)) {
    const tplInfo = await countPdfImages(fs.readFileSync(tplPath));
    console.log('템플릿 이미지:', tplInfo.images, '→ 추가된 점검사진 약', pdfInfo.images - tplInfo.images, '장');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
