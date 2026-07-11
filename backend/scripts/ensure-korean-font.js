/**
 * 최종보고서 PDF 한글 표시용 폰트 다운로드 (Render 빌드 시 실행)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const FONTS_DIR = path.join(__dirname, '..', 'fonts');
const OUT_MALGUN = path.join(FONTS_DIR, 'malgun.ttf');
const OUT_OTF = path.join(FONTS_DIR, 'NotoSansCJKkr-Regular.otf');
const OUT_TTF = path.join(FONTS_DIR, 'NotoSansKR-Regular.ttf');

const FONT_URLS = [
  {
    url: 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf',
    dest: OUT_OTF
  },
  {
    url: 'https://github.com/jsversteggard/NotoSansKR/raw/master/NotoSansKR-Regular/NotoSansKR-Regular.ttf',
    dest: OUT_TTF
  }
];

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) { /* ignore */ }
        return download(res.headers.location, dest, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) { /* ignore */ }
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch (_) { /* ignore */ }
      reject(err);
    });
  });
}

async function main() {
  if (!fs.existsSync(FONTS_DIR)) fs.mkdirSync(FONTS_DIR, { recursive: true });

  const existing = [OUT_MALGUN, OUT_OTF, OUT_TTF].find((p) => fs.existsSync(p) && fs.statSync(p).size > 50000);
  if (existing) {
    console.log(`Korean font OK: ${existing} (${fs.statSync(existing).size} bytes)`);
    return;
  }

  for (const { url, dest } of FONT_URLS) {
    try {
      console.log(`Downloading ${url} ...`);
      await download(url, dest);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 50000) {
        console.log(`Saved ${dest} (${fs.statSync(dest).size} bytes)`);
        return;
      }
    } catch (e) {
      console.warn(`Font download failed (${dest}):`, e.message);
      try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch (_) { /* ignore */ }
    }
  }

  console.warn('Could not download Korean font — final report Korean text may not render.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
