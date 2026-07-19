/**
 * 최종보고서 PDF 생성 — 종합점검보고서_0719.pdf 템플릿 기반
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
const TEMPLATE_FILENAME = '종합점검보고서_0719.pdf';

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

function chunkItems(items, perPage = LAYOUT.BLOCKS_PER_PAGE) {
  const list = items || [];
  if (!list.length) return [[]];
  const chunks = [];
  for (let i = 0; i < list.length; i += perPage) {
    chunks.push(list.slice(i, i + perPage));
  }
  return chunks;
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

function getAirType(row) {
  const air = row?.air;
  if (!air) return '-';
  return air.process_type_label ?? air.process_type ?? '-';
}

function getAirMemo(row) {
  return row?.air?.note ?? row?.radon?.note ?? '-';
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

function resolveKoreanBoldFontPath() {
  const candidates = [
    path.join(FONTS_DIR, 'malgunbd.ttf'),
    path.join(FONTS_DIR, 'Malgunbd.ttf'),
    path.join(FONTS_DIR, 'NotoSansKR-Bold.ttf'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 10000) return p;
  }
  return null;
}

async function embedCustomFonts(pdfDoc) {
  try {
    const fontkit = require('@pdf-lib/fontkit');
    pdfDoc.registerFontkit(fontkit);
    const regularPath = resolveKoreanFontPath();
    const boldPath = resolveKoreanBoldFontPath();
    const regular = regularPath
      ? await pdfDoc.embedFont(fs.readFileSync(regularPath))
      : await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = boldPath
      ? await pdfDoc.embedFont(fs.readFileSync(boldPath))
      : regular;
    return { regular, bold };
  } catch (e) {
    console.warn('[final-report-0620] font embed failed:', e.message);
    const fallback = await pdfDoc.embedFont(StandardFonts.Helvetica);
    return { regular: fallback, bold: fallback };
  }
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

/** 데이터 필드: align(left|center|right), pos.w 로 정렬 영역 지정 */
function drawDataText(page, font, pos, text, size = LAYOUT.FIELD.fontSize) {
  if (!pos) return;
  const s = safe(text);
  let x = pos.x;
  const textW = font.widthOfTextAtSize(s, size);
  if (pos.align === 'center' && pos.w) {
    x = pos.x + (pos.w - textW) / 2;
  } else if (pos.align === 'right' && pos.w) {
    x = pos.x + pos.w - textW;
  }
  page.drawText(s, { x, y: pos.y, size, font, color: TEXT_COLOR() });
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
    // 지정 슬롯(8.57×3.85cm)에 맞게 꽉 채움
    page.drawImage(image, {
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
    });
    return true;
  } catch (e) {
    console.warn('[final-report-0620] photo embed failed:', fileUrl, e.message);
    return false;
  }
}

function buildPhotoSlots(block, urlCount) {
  if (!block || urlCount <= 0) return [];
  const slots = [];
  if (block.photoNear) slots.push(block.photoNear);
  if (block.photoFar && urlCount > 1) slots.push(block.photoFar);
  return slots.slice(0, urlCount);
}

async function drawBlockPhotos(pdfDoc, page, photoUrls, block) {
  const urls = (photoUrls || []).filter(Boolean).slice(0, 2);
  if (!urls.length || !block) return;
  const slots = buildPhotoSlots(block, urls.length);
  for (let i = 0; i < Math.min(urls.length, slots.length); i++) {
    await embedAndDrawPhoto(pdfDoc, page, urls[i], slots[i]);
  }
}

function fillCover(page, boldFont, data) {
  const c = LAYOUT.COVER;
  const complex = safe(data.complex);
  const dong = safe(data.dong);
  const ho = safe(data.ho);
  const name = safe(data.name);
  const size = LAYOUT.FIELD.fontSize;

  drawDataText(page, boldFont, c.complexLine, `아파트명 : ${complex}`, size);
  drawDataText(page, boldFont, c.donghoLine, `동,  호  수 :  ${dong} 동 ${ho}호`, size);
  drawDataText(page, boldFont, c.nameLine, `입주자 성함  :  ${name}`, size);
}

async function fillVisualPage(pdfDoc, page, font, items) {
  const blocks = LAYOUT.VISUAL_BLOCKS;
  const list = items.slice(0, blocks.length);
  while (list.length < blocks.length) list.push(null);

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const b = blocks[i];
    if (!b) continue;
    drawDataText(page, font, b.location, item?.location);
    drawDataText(page, font, b.trade, item?.trade);
    drawDataText(page, font, b.content, item?.note ?? item?.content);
    drawDataText(page, font, b.note, item?.result_text ?? item?.result ?? item?.memo);
    await drawBlockPhotos(pdfDoc, page, collectPhotoUrls(item), b);
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
    drawDataText(page, font, b.location, loc.main);
    if (b.locationNo && loc.sub) drawDataText(page, font, b.locationNo, loc.sub);
    drawDataText(page, font, b.trade, `${trade.main}${trade.sub}`);
    drawDataText(page, font, b.result, item?.result_text ?? item?.result ?? item?.note);
    await drawBlockPhotos(pdfDoc, page, collectPhotoUrls(item), b);
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
    drawDataText(page, font, b.location, loc.main);
    if (b.locationNo && loc.sub) drawDataText(page, font, b.locationNo, loc.sub);
    drawDataText(
      page,
      font,
      b.result,
      row.air?.result_text ?? row.air?.result ?? row.radon?.result_text ?? row.radon?.result
    );
    drawDataText(page, font, b.type, getAirType(row));
    drawDataText(page, font, b.memo, getAirMemo(row));
    drawDataText(page, font, b.tvoc, row.air?.tvoc != null ? String(row.air.tvoc) : '-');
    drawDataText(page, font, b.hcho, row.air?.hcho != null ? String(row.air.hcho) : '-');
    drawDataText(page, font, b.radon, row.radon?.radon != null ? String(row.radon.radon) : '-');
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
    drawDataText(page, font, b.location, loc.main);
    drawDataText(page, font, b.result, item?.result_text ?? item?.result);
    drawDataText(page, font, b.type, item?.trade);
    drawDataText(page, font, b.memo, item?.note);
    drawDataText(page, font, b.p1, item?.point1_left_mm ?? item?.left_mm);
    drawDataText(page, font, b.p2, item?.point2_left_mm);
    drawDataText(page, font, b.p3, item?.point3_left_mm);
    drawDataText(page, font, b.p4, item?.point4_left_mm);
  }
}

async function generateFinalReport0620(reportData, options = {}) {
  const templatePath = options.templatePath || path.join(TEMPLATE_DIR, TEMPLATE_FILENAME);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`PDF 템플릿을 찾을 수 없습니다: ${path.basename(templatePath)}`);
  }

  const dong = reportData.dong || '';
  const ho = reportData.ho || '';
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const filename = options.filename || `보고서_최종_${dong}-${ho}_${timestamp}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const templateBytes = fs.readFileSync(templatePath);
  const templateDoc = await PDFDocument.load(templateBytes);
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedCustomFonts(pdfDoc);
  const font = fonts.regular;

  const visualItems = getVisualItems(reportData);
  const thermalItems = reportData.thermal_inspections || [];
  const airRows = getAirRows(reportData);
  const levelItems = reportData.level_measurements || [];

  const visualChunks = chunkItems(visualItems);
  const thermalChunks = chunkItems(thermalItems);
  const idx = LAYOUT.PAGE_INDEX;

  const [coverTpl, , , airTpl, levelTpl, contactTpl] = await pdfDoc.copyPages(
    templateDoc,
    [idx.cover, idx.visual, idx.thermal, idx.air, idx.level, idx.contact]
  );

  pdfDoc.addPage(coverTpl);
  fillCover(coverTpl, fonts.bold, reportData);

  for (const chunk of visualChunks) {
    const [page] = await pdfDoc.copyPages(templateDoc, [idx.visual]);
    pdfDoc.addPage(page);
    await fillVisualPage(pdfDoc, page, font, chunk);
  }

  for (const chunk of thermalChunks) {
    const [page] = await pdfDoc.copyPages(templateDoc, [idx.thermal]);
    pdfDoc.addPage(page);
    await fillThermalPage(pdfDoc, page, font, chunk);
  }

  pdfDoc.addPage(airTpl);
  await fillAirPage(pdfDoc, airTpl, font, airRows);

  pdfDoc.addPage(levelTpl);
  await fillLevelPage(pdfDoc, levelTpl, font, levelItems);

  pdfDoc.addPage(contactTpl);

  const bytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, bytes);
  const size = fs.statSync(outputPath).size;

  console.log(
    `[final-report-0620] household=${dong}-${ho} visual=${visualItems.length}(${visualChunks.length}p) thermal=${thermalItems.length}(${thermalChunks.length}p) air=${airRows.length} level=${levelItems.length} pages=${pdfDoc.getPageCount()}`
  );

  return { filename, path: outputPath, url: `/reports/${filename}`, size };
}

module.exports = {
  generateFinalReport0620,
  TEMPLATE_FILENAME,
};
