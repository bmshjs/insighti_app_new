/**
 * 최종보고서 PDF 생성 — 종합점검보고서_0620.pdf 템플릿 기반
 * 템플릿 페이지 위에 샘플 텍스트를 덮고 실제 데이터·사진을 오버레이
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LAYOUT = require('./finalReport0620Layout');
const {
  getVisualPageItems,
  normalizePhotoList,
} = require('./finalReportGenerator');
const { loadImageBytes } = require('./photoPath');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const FONTS_DIR = path.join(__dirname, '..', 'fonts');
const TEMPLATE_FILENAME = '종합점검보고서_0620.pdf';

function safe(v) {
  if (v == null || v === '') return '-';
  return String(v);
}

function splitLocation(loc) {
  const s = safe(loc);
  const m = s.match(/^(.+?)(\d+)$/);
  if (m) return { main: m[1], sub: m[2] };
  return { main: s, sub: '' };
}

function splitTrade(trade) {
  const s = safe(trade);
  const idx = s.indexOf(' ');
  if (idx > 0) return { main: s.slice(0, idx), sub: s.slice(idx) };
  return { main: s, sub: '' };
}

function getVisualItems(reportData) {
  return getVisualPageItems(reportData).filter((x) => !x._sectionHeader);
}

function getAirRows(reportData) {
  const airList = reportData.air_measurements || [];
  const radonList = reportData.radon_measurements || [];
  const rows = [];
  airList.forEach((a, i) => rows.push({ air: a, radon: radonList[i] || null }));
  if (!rows.length && radonList.length) {
    radonList.forEach((r) => rows.push({ air: null, radon: r }));
  }
  return rows;
}

function resolveKoreanFontPath() {
  const candidates = [
    path.join(FONTS_DIR, 'malgun.ttf'),
    path.join(FONTS_DIR, 'Malgun.ttf'),
    path.join(FONTS_DIR, 'malgunbd.ttf'),
    path.join(FONTS_DIR, 'NotoSansKR-Regular.ttf'),
    path.join(FONTS_DIR, 'NotoSansCJKkr-Regular.otf'),
    path.join(__dirname, '..', 'node_modules', '@fontsource', 'noto-sans-kr', 'files', 'noto-sans-kr-korean-400-normal.woff2'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 10000) return p;
  }
  if (fs.existsSync(FONTS_DIR)) {
    const found = fs.readdirSync(FONTS_DIR).find((f) => /malgun|noto.*kr/i.test(f) && /\.(ttf|otf|woff2)$/i.test(f));
    if (found) return path.join(FONTS_DIR, found);
  }
  return null;
}

async function embedCustomFont(pdfDoc) {
  try {
    const fontkit = require('@pdf-lib/fontkit');
    pdfDoc.registerFontkit(fontkit);
    const fontPath = resolveKoreanFontPath();
    if (fontPath) {
      return await pdfDoc.embedFont(fs.readFileSync(fontPath));
    }
    console.warn('[final-report-0620] Korean font not found');
  } catch (e) {
    console.warn('[final-report-0620] font embed failed:', e.message);
  }
  return pdfDoc.embedFont(StandardFonts.Helvetica);
}

const TEXT_COLOR = () => {
  const c = LAYOUT.FIELD.textColor;
  return rgb(c.r, c.g, c.b);
};

function getPhotoUrl(photo) {
  if (!photo) return null;
  return photo.file_url || photo.url || photo.thumb_url || null;
}

function collectPhotoUrls(item) {
  const photos = normalizePhotoList(item?.photos || []);
  return photos.map(getPhotoUrl).filter(Boolean);
}

function wipeAndText(page, font, pos, text, size = LAYOUT.FIELD.fontSize) {
  if (!pos) return;
  const pad = LAYOUT.FIELD.wipePad;
  const c = LAYOUT.FIELD.wipeColor;
  const w = pos.w || 100;
  const h = pos.h || 18;
  page.drawRectangle({
    x: pos.x - pad,
    y: pos.y - 6,
    width: w + pad * 2,
    height: h + pad * 2,
    color: rgb(c.r, c.g, c.b),
  });
  page.drawText(safe(text), { x: pos.x, y: pos.y, size, font, color: TEXT_COLOR() });
}

async function embedAndDrawPhoto(pdfDoc, page, fileUrl, rect) {
  if (!rect || !fileUrl) return false;
  try {
    const buf = await loadImageBytes(fileUrl);
    if (!buf || buf.length < 10) {
      console.warn('[final-report-0620] photo load empty:', fileUrl);
      return false;
    }
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    let image;
    if (isPng) image = await pdfDoc.embedPng(buf);
    else if (isJpg) image = await pdfDoc.embedJpg(buf);
    else {
      try {
        image = await pdfDoc.embedJpg(buf);
      } catch (_) {
        image = await pdfDoc.embedPng(buf);
      }
    }
    const dims = image.scale(1);
    const scale = Math.min(rect.w / dims.width, rect.h / dims.height);
    const drawW = dims.width * scale;
    const drawH = dims.height * scale;
    const dx = rect.x + (rect.w - drawW) / 2;
    const dy = rect.y + (rect.h - drawH) / 2;
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      color: rgb(1, 1, 1),
    });
    page.drawImage(image, { x: dx, y: dy, width: drawW, height: drawH });
    return true;
  } catch (e) {
    console.warn('[final-report-0620] photo embed failed:', fileUrl, e.message);
    return false;
  }
}

async function drawBlockPhotos(pdfDoc, page, photoUrls, rect, maxPhotos = 2) {
  const urls = (photoUrls || []).filter(Boolean).slice(0, maxPhotos);
  if (!urls.length || !rect) return;
  if (urls.length === 1) {
    await embedAndDrawPhoto(pdfDoc, page, urls[0], rect);
    return;
  }
  const gap = 4;
  const slotW = (rect.w - gap) / urls.length;
  for (let i = 0; i < urls.length; i++) {
    await embedAndDrawPhoto(pdfDoc, page, urls[i], {
      x: rect.x + i * (slotW + gap),
      y: rect.y,
      w: slotW,
      h: rect.h,
    });
  }
}

function wipeCoverLine(page, font, lineDef, text) {
  if (!lineDef) return;
  const pad = LAYOUT.FIELD.wipePad;
  const c = LAYOUT.FIELD.wipeColor;
  const size = LAYOUT.FIELD.fontSize;
  const wipeH = lineDef.wipeH || 22;
  page.drawRectangle({
    x: lineDef.x - pad,
    y: lineDef.y - 6,
    width: lineDef.wipeW + pad * 2,
    height: wipeH + pad * 2,
    color: rgb(c.r, c.g, c.b),
  });
  page.drawText(safe(text), { x: lineDef.x, y: lineDef.y, size, font, color: TEXT_COLOR() });
}

function fillCover(page, font, data) {
  const c = LAYOUT.COVER;
  const complex = safe(data.complex);
  const dong = safe(data.dong);
  const ho = safe(data.ho);
  const name = safe(data.name);

  wipeCoverLine(page, font, c.complexLine, `아파트명 : ${complex}`);
  wipeCoverLine(page, font, c.donghoLine, `동,  호  수 :  ${dong} 동 ${ho}호`);
  wipeCoverLine(page, font, c.nameLine, `입주자 성함  :  ${name}`);
}

async function fillVisualPage(pdfDoc, page, font, items) {
  const blocks = LAYOUT.VISUAL_BLOCKS;
  const list = items.slice(0, blocks.length);
  while (list.length < blocks.length) list.push(null);

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const b = blocks[i];
    if (!b) continue;
    wipeAndText(page, font, { ...b.location, w: 80, h: 18 }, item?.location);
    wipeAndText(page, font, { ...b.trade, w: 80, h: 18 }, item?.trade);
    wipeAndText(page, font, { ...b.content, w: 100, h: 18 }, item?.note ?? item?.content);
    wipeAndText(page, font, { ...b.note, w: 100, h: 18 }, item?.result_text ?? item?.result ?? item?.memo);
    await drawBlockPhotos(pdfDoc, page, collectPhotoUrls(item), b.photo, 2);
  }
}

async function fillThermalPage(pdfDoc, page, font, items) {
  const blocks = LAYOUT.THERMAL_BLOCKS;
  const list = items.slice(0, blocks.length);
  while (list.length < blocks.length) list.push(null);

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const b = blocks[i];
    if (!b) continue;
    const loc = splitLocation(item?.location);
    const trade = splitTrade(item?.trade);
    wipeAndText(page, font, { ...b.location, w: 60, h: 18 }, loc.main);
    if (b.locationNo && loc.sub) wipeAndText(page, font, { ...b.locationNo, w: 24, h: 18 }, loc.sub);
    wipeAndText(page, font, { ...b.trade, w: 100, h: 18 }, `${trade.main}${trade.sub}`);
    wipeAndText(page, font, { ...b.result, w: 100, h: 18 }, item?.result_text ?? item?.result ?? item?.note);
    await drawBlockPhotos(pdfDoc, page, collectPhotoUrls(item), b.photo, 2);
  }
}

async function fillAirPage(pdfDoc, page, font, rows) {
  const blocks = LAYOUT.AIR_BLOCKS;
  const list = rows.slice(0, blocks.length);
  while (list.length < blocks.length) list.push({ air: null, radon: null });

  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const b = blocks[i];
    if (!b) continue;
    const loc = splitLocation(row.air?.location || row.radon?.location);
    wipeAndText(page, font, { ...b.location, w: 60, h: 18 }, loc.main);
    if (b.locationNo && loc.sub) wipeAndText(page, font, { ...b.locationNo, w: 24, h: 18 }, loc.sub);
    wipeAndText(
      page,
      font,
      { ...b.result, w: 60, h: 18 },
      row.air?.result_text ?? row.air?.result ?? row.radon?.result_text ?? row.radon?.result
    );
    wipeAndText(page, font, { ...b.tvoc, w: 60, h: 18 }, row.air?.tvoc != null ? String(row.air.tvoc) : '-');
    wipeAndText(page, font, { ...b.hcho, w: 60, h: 18 }, row.air?.hcho != null ? String(row.air.hcho) : '-');
    wipeAndText(page, font, { ...b.radon, w: 50, h: 18 }, row.radon?.radon != null ? String(row.radon.radon) : '-');
    const airPhotos = [
      ...collectPhotoUrls(row.air),
      ...collectPhotoUrls(row.radon),
    ];
    await drawBlockPhotos(pdfDoc, page, airPhotos, b.photo, 1);
  }
}

async function fillLevelPage(pdfDoc, page, font, items) {
  const blocks = LAYOUT.LEVEL_BLOCKS;
  const list = items.slice(0, blocks.length);
  while (list.length < blocks.length) list.push(null);

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const b = blocks[i];
    if (!b) continue;
    const loc = splitLocation(item?.location);
    wipeAndText(page, font, { ...b.location, w: 60, h: 18 }, loc.main);
    wipeAndText(page, font, { ...b.result, w: 60, h: 18 }, item?.result_text ?? item?.result);
    wipeAndText(page, font, { ...b.p1, w: 36, h: 18 }, item?.point1_left_mm ?? item?.left_mm);
    wipeAndText(page, font, { ...b.p2, w: 36, h: 18 }, item?.point2_left_mm);
    wipeAndText(page, font, { ...b.p3, w: 36, h: 18 }, item?.point3_left_mm);
    wipeAndText(page, font, { ...b.p4, w: 36, h: 18 }, item?.point4_left_mm);
    await drawBlockPhotos(pdfDoc, page, collectPhotoUrls(item), b.photo, 1);
  }
}

async function generateFinalReport0620(reportData, options = {}) {
  const templatePath = path.join(TEMPLATE_DIR, TEMPLATE_FILENAME);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`PDF 템플릿을 찾을 수 없습니다: ${TEMPLATE_FILENAME}`);
  }

  const dong = reportData.dong || '';
  const ho = reportData.ho || '';
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const filename = options.filename || `보고서_최종_${dong}-${ho}_${timestamp}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const templateBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await embedCustomFont(pdfDoc);

  const visualItems = getVisualItems(reportData);
  const thermalItems = reportData.thermal_inspections || [];
  const airRows = getAirRows(reportData);
  const levelItems = reportData.level_measurements || [];

  if (visualItems.length > LAYOUT.BLOCKS_PER_PAGE) {
    console.warn(`[final-report-0620] 육안 ${visualItems.length}건 — 페이지당 최대 ${LAYOUT.BLOCKS_PER_PAGE}건만 표시`);
  }

  const pages = pdfDoc.getPages();
  const idx = LAYOUT.PAGE_INDEX;

  if (pages[idx.cover]) fillCover(pages[idx.cover], font, reportData);
  if (pages[idx.visual]) await fillVisualPage(pdfDoc, pages[idx.visual], font, visualItems);
  if (pages[idx.thermal]) await fillThermalPage(pdfDoc, pages[idx.thermal], font, thermalItems);
  if (pages[idx.air]) await fillAirPage(pdfDoc, pages[idx.air], font, airRows);
  if (pages[idx.level]) await fillLevelPage(pdfDoc, pages[idx.level], font, levelItems);

  const bytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, bytes);
  const size = fs.statSync(outputPath).size;

  console.log(
    `[final-report-0620] household=${dong}-${ho} visual=${visualItems.length} thermal=${thermalItems.length} air=${airRows.length} level=${levelItems.length}`
  );

  return { filename, path: outputPath, url: `/reports/${filename}`, size };
}

module.exports = {
  generateFinalReport0620,
  TEMPLATE_FILENAME,
};
