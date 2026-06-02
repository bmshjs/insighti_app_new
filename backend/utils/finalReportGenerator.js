/**
 * 최종보고서: 템플릿 1~7, 9, 11, 14~15p 유지.
 * 8·10·12·13p는 제거 후 같은 위치에 빈 A4 4장 삽입하고 점검결과(육안/열화상/공기질/레벨기)만 별도 페이지로 그림.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const LAYOUT = require('./finalReportLayout');

const TEMPLATE_FILENAME = '종합점검보고서_최종1.pdf';
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const FONTS_DIR = path.join(__dirname, '..', 'fonts');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const config = require('../config');
const UPLOADS_DIR = path.isAbsolute(config.upload.dir)
  ? config.upload.dir
  : path.join(__dirname, '..', config.upload.dir.replace(/^\.\//, ''));
const AIR_DIAGRAM_PATH = path.join(ASSETS_DIR, 'air_quality_diagram.png');
const LEVEL_DIAGRAM_PATH = path.join(ASSETS_DIR, 'level_diagram.png');

const PUBLIC_BASE_URL = (process.env.BACKEND_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

/** file_url(/uploads/xxx, uploads/xxx, http(s)://host/uploads/xxx) → 서버 내 절대 경로. 없으면 null */
function getPhotoPath(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  let rel = String(fileUrl).trim();
  // http(s)://host/uploads/xxx → /uploads/xxx
  const urlMatch = rel.match(/^https?:\/\/[^/]+(\/uploads\/.+)$/i);
  if (urlMatch) rel = urlMatch[1];
  rel = rel.replace(/^\//, '');
  if (!rel || !rel.startsWith('uploads')) return null;
  // uploads/2024/photo.jpg 또는 uploads/photo.jpg
  const sub = rel.replace(/^uploads\/?/, '') || rel;
  let full = path.join(UPLOADS_DIR, sub);
  if (fs.existsSync(full)) return full;
  // fallback: 파일명만 사용 (uploads/ 직하위)
  const baseName = path.basename(sub);
  if (baseName && baseName !== sub) {
    const alt = path.join(UPLOADS_DIR, baseName);
    if (fs.existsSync(alt)) return alt;
  }
  return null;
}

/** 상대/절대 URL → HTTP(S) 전체 URL */
function resolvePhotoHttpUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  const u = String(fileUrl).trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (!PUBLIC_BASE_URL) return null;
  return u.startsWith('/') ? `${PUBLIC_BASE_URL}${u}` : `${PUBLIC_BASE_URL}/${u}`;
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

/** 로컬 uploads → 없으면 BACKEND_URL HTTP로 이미지 로드 */
async function loadImageBytes(fileUrl) {
  const localPath = getPhotoPath(fileUrl);
  if (localPath && fs.existsSync(localPath)) {
    try {
      return fs.readFileSync(localPath);
    } catch (_) {
      /* try http */
    }
  }
  const httpUrl = resolvePhotoHttpUrl(fileUrl);
  if (httpUrl) {
    const remote = await fetchUrlBuffer(httpUrl);
    if (remote && remote.length > 100) return remote;
  }
  return null;
}

/** 사진 파일을 PDF에 임베드하고 페이지에 그리기. 실패 시 무시 */
async function embedAndDrawPhoto(pdfDoc, page, fileUrl, x, y, w, h) {
  try {
    const buf = await loadImageBytes(fileUrl);
    if (!buf || buf.length < 10) return;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e;
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
    const scale = Math.min(w / dims.width, h / dims.height, 1);
    const drawW = dims.width * scale;
    const drawH = dims.height * scale;
    const dx = x + (w - drawW) / 2;
    const dy = y + (h - drawH) / 2;
    page.drawImage(image, { x: dx, y: dy, width: drawW, height: drawH });
  } catch (e) {
    // ignore
  }
}

const FONT_SIZE = 9;
const HEADER_FONT_SIZE = 10;
const TITLE_FONT_SIZE = 14;

function safeText(v) {
  if (v == null || v === '') return '-';
  return String(v);
}

/** 최종보고서: 텍스트 자르지 않고 전부 표시 (표를 벗어나도 무방) */
function truncateToFit(text) {
  const s = safeText(text);
  return s === '-' || !s ? s : String(s);
}

/** 세대주 등록 하자 사진 → 육안 블록 [근거리, 원거리] 순 (photo 테이블 + defect.photo_near/far) */
function defectPhotosToVisualPhotos(defect) {
  const list = Array.isArray(defect.photos) ? [...defect.photos] : [];
  if (defect.photo_far && !list.some((p) => p.kind === 'far')) {
    list.push({ kind: 'far', url: defect.photo_far });
  }
  if (defect.photo_near && !list.some((p) => p.kind === 'near')) {
    list.push({ kind: 'near', url: defect.photo_near });
  }
  const photos = [];
  const far = list.find((p) => p.kind === 'far');
  const near = list.find((p) => p.kind === 'near');
  const pushPhoto = (p) => {
    const url = p.url || p.thumb_url || p.file_url;
    if (url) photos.push({ file_url: url, url });
  };
  if (far) pushPhoto(far);
  if (near) pushPhoto(near);
  list.forEach((p) => {
    if (p !== far && p !== near) pushPhoto(p);
  });
  return photos;
}

/** 세대주 등록 하자 1건 → 8p 육안 블록 항목 */
function defectToVisualItem(defect) {
  return {
    location: defect.location || '',
    trade: defect.trade || '',
    note: defect.content || '',
    result_text: defect.memo || '',
    photos: defectPhotosToVisualPhotos(defect)
  };
}

/** 점검 사진 배열 정규화 (inspection_photo / photo 테이블 공통) */
function normalizePhotoList(photos) {
  if (!photos) return [];
  const list = Array.isArray(photos) ? photos : [photos];
  return list
    .map((p) => {
      const url = p && (p.file_url || p.url || p.thumb_url);
      return url ? { ...p, file_url: url, url } : null;
    })
    .filter(Boolean);
}

/**
 * 8p 육안: 세대주 등록 하자 → 점검원 육안점검 순서
 */
function getVisualPageItems(reportData) {
  const items = [];
  const defects = reportData.defects || [];
  const inspections = reportData.visual_inspections || [];

  if (defects.length > 0) {
    items.push({ _sectionHeader: true, title: '세대주 등록 하자' });
    defects.forEach((d) => items.push({ ...defectToVisualItem(d), _source: '세대주' }));
  }
  if (inspections.length > 0) {
    items.push({ _sectionHeader: true, title: '점검원 육안점검' });
    inspections.forEach((i) => {
      items.push({
        ...i,
        location: i.location || '',
        trade: i.trade || '',
        note: i.note || '',
        result_text: i.result_text ?? i.result ?? '',
        photos: normalizePhotoList(i.photos),
        _source: '점검원'
      });
    });
  }
  return items;
}

/** 항목 1개(또는 구역 제목)가 차지하는 세로 높이 */
function visualItemHeight(item, block) {
  if (item && item._sectionHeader) return 26;
  const rowH = block.rowHeight;
  const photoH = block.photoHeight;
  return rowH * 3 + photoH + block.blockGap;
}

function resolveKoreanFontPath() {
  const candidates = [
    path.join(FONTS_DIR, 'NotoSansKR-Regular.ttf'),
    path.join(FONTS_DIR, 'NotoSansCJKkr-Regular.otf'),
    path.join(__dirname, '..', 'node_modules', '@fontsource', 'noto-sans-kr', 'files', 'noto-sans-kr-korean-400-normal.woff2')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 10000) return p;
  }
  if (fs.existsSync(FONTS_DIR)) {
    const found = fs.readdirSync(FONTS_DIR).find((f) => /\.(ttf|otf|woff2)$/i.test(f));
    if (found) return path.join(FONTS_DIR, found);
  }
  const fontsourceDir = path.join(__dirname, '..', 'node_modules', '@fontsource', 'noto-sans-kr', 'files');
  if (fs.existsSync(fontsourceDir)) {
    const kr = fs.readdirSync(fontsourceDir).find((f) => /korean.*400.*\.woff2$/i.test(f));
    if (kr) return path.join(fontsourceDir, kr);
  }
  return null;
}

async function embedCustomFont(pdfDoc) {
  try {
    const fontkit = require('@pdf-lib/fontkit');
    pdfDoc.registerFontkit(fontkit);
    const fontPath = resolveKoreanFontPath();
    if (fontPath) {
      const fontBytes = fs.readFileSync(fontPath);
      return await pdfDoc.embedFont(fontBytes);
    }
    console.warn('[finalReport] Korean font not found — install fonts/ or run scripts/ensure-korean-font.js');
  } catch (e) {
    console.warn('[finalReport] Korean font embed failed:', e.message);
  }
  return await pdfDoc.embedFont(StandardFonts.Helvetica);
}

/** 첫 페이지: 맨 아래 "인싸이트아이 고객센터" 줄 위에 성명/아파트명/동호수/전화번호 + 담당소장·팀장 서명란만 추가 (흰색 덮기 없음) */
function drawFirstPageHouseholdInfo(page, reportData, font) {
  if (!page || !font) return;
  const fp = LAYOUT.FIRST_PAGE;
  const block = fp && fp.footerBlock;
  if (!block) return;

  const name = safeText(reportData.name);
  const complex = safeText(reportData.complex);
  const dong = reportData.dong != null && reportData.dong !== '' ? String(reportData.dong) : '-';
  const ho = reportData.ho != null && reportData.ho !== '' ? String(reportData.ho) : '-';
  const dongho = `${dong}동 ${ho}호`;
  const phone = safeText(reportData.phone);

  const x = block.x || 95;
  const size = block.fontSize || 11;
  const lh = block.lineHeight || 22;
  let cy = block.firstLineY || 185;

  // 고객센터 줄 위에 그대로 출력 (흰색 덮기 없음)
  page.drawText(`성명: ${name}`, { x, y: cy, size, font });
  cy -= lh;
  page.drawText(`아파트명: ${complex}`, { x, y: cy, size, font });
  cy -= lh;
  page.drawText(`동호수: ${dongho}`, { x, y: cy, size, font });
  cy -= lh;
  page.drawText(`전화번호: ${phone}`, { x, y: cy, size, font });

  // 담당소장 / 팀장 서명란
  const sig = fp.signature;
  if (sig) {
    const sigSize = sig.fontSize || 10;
    const lineLen = sig.lineLength || 120;
    const drawSig = (label, pos) => {
      if (!pos) return;
      page.drawText(label, { x: pos.x, y: pos.y, size: sigSize, font });
      const lineY = pos.y - sig.lineYOffset;
      page.drawLine({
        start: { x: pos.x, y: lineY },
        end: { x: pos.x + lineLen, y: lineY },
        thickness: 0.5,
        color: rgb(0, 0, 0)
      });
    };
    drawSig('담당소장', sig.담당소장);
    drawSig('팀장', sig.팀장);
  }
}

/** 표 한 페이지 그리기: 제목, 동/호, 헤더 행, 데이터 행(빨간 박스 단위). getCellValue(item, field) => string */
function drawTablePage(page, font, tableDef, reportData, items, getCellValue) {
  const { x: ox, y: oy } = tableDef.origin;
  const { headerLabels, columns, headerHeight, rowHeight } = tableDef;
  const dong = reportData.dong || '';
  const ho = reportData.ho || '';

  // 제목
  page.drawText(tableDef.title, {
    x: ox,
    y: LAYOUT.PAGE_HEIGHT - 50,
    size: TITLE_FONT_SIZE,
    font
  });
  page.drawText(`${dong}동 ${ho}호  최종점검결과`, {
    x: ox,
    y: LAYOUT.PAGE_HEIGHT - 70,
    size: 11,
    font
  });

  const tableTop = oy;
  const totalWidth = columns.reduce((s, c) => s + c.w, 0);

  // 헤더 행 배경 + 텍스트
  page.drawRectangle({
    x: ox,
    y: tableTop - headerHeight,
    width: totalWidth,
    height: headerHeight,
    color: rgb(0.85, 0.9, 1)
  });
  let cx = ox;
  headerLabels.forEach((label, j) => {
    page.drawText(truncateToFit(label, 30), {
      x: cx + 4,
      y: tableTop - headerHeight + 6,
      size: HEADER_FONT_SIZE,
      font
    });
    cx += columns[j].w;
  });
  // 헤더 아래선
  page.drawLine({
    start: { x: ox, y: tableTop - headerHeight },
    end: { x: ox + totalWidth, y: tableTop - headerHeight },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3)
  });

  const dataRows = (items || []).slice(0, tableDef.maxRowsPerPage);

  dataRows.forEach((item, rowIndex) => {
    const rowY = tableTop - headerHeight - (rowIndex + 1) * rowHeight;
    const cellBottom = rowY;
    const textY = cellBottom + 5;

    // 빨간 박스 테두리 (1 set = 1행)
    page.drawRectangle({
      x: ox,
      y: rowY,
      width: totalWidth,
      height: rowHeight,
      borderColor: rgb(0.9, 0.2, 0.2),
      borderWidth: 0.8
    });

    let cellX = ox;
    columns.forEach((col, j) => {
      const val = getCellValue(item, col.field);
      const text = truncateToFit(val, col.maxChars);
      page.drawText(text || '-', {
        x: cellX + 4,
        y: textY,
        size: FONT_SIZE,
        font
      });
      // 세로선 (마지막 제외)
      if (j < columns.length - 1) {
        page.drawLine({
          start: { x: cellX + col.w, y: rowY },
          end: { x: cellX + col.w, y: rowY + rowHeight },
          thickness: 0.3,
          color: rgb(0.7, 0.7, 0.7)
        });
      }
      cellX += col.w;
    });
  });

  // 표 외곽선
  const tableHeight = headerHeight + dataRows.length * rowHeight;
  page.drawRectangle({
    x: ox,
    y: tableTop - tableHeight,
    width: totalWidth,
    height: tableHeight,
    borderColor: rgb(0.2, 0.2, 0.2),
    borderWidth: 0.5
  });
}

/** 육안점검 블록형 1페이지분만: chunk(항목 배열)만 그리기. 제목·동호 포함. 점검 사진 있으면 채움. */
async function drawVisualBlocksOnPage(pdfDoc, page, font, reportData, chunk) {
  const dong = reportData.dong || '';
  const ho = reportData.ho || '';
  const block = LAYOUT.VISUAL_BLOCK;
  const ox = block.origin.x;
  const cw = block.contentWidth;
  const rowH = block.rowHeight;
  const photoH = block.photoHeight;
  const lw = block.labelWidth;
  const cdw = block.cellDetailWidth;
  const gap = block.blockGap;
  const bw = block.borderWidth;
  const rgbLabel = () => rgb(block.colors.labelBorder.r, block.colors.labelBorder.g, block.colors.labelBorder.b);
  const rgbValue = () => rgb(block.colors.valueBorder.r, block.colors.valueBorder.g, block.colors.valueBorder.b);
  const rgbPhoto = () => rgb(block.colors.photoBorder.r, block.colors.photoBorder.g, block.colors.photoBorder.b);

  page.drawText(block.title, { x: ox, y: LAYOUT.PAGE_HEIGHT - 50, size: TITLE_FONT_SIZE, font });
  page.drawText(`${dong}동 ${ho}호  최종점검결과`, { x: ox, y: LAYOUT.PAGE_HEIGHT - 70, size: 11, font });

  const blockHeight = rowH * 3 + photoH;
  const totalBlockH = blockHeight + gap;
  let cursorY = block.origin.y;

  for (let idx = 0; idx < chunk.length; idx++) {
    const item = chunk[idx];
    if (item._sectionHeader) {
      cursorY -= 20;
      page.drawText(item.title, {
        x: ox,
        y: cursorY,
        size: 10,
        font,
        color: rgb(0.15, 0.15, 0.15)
      });
      cursorY -= 6;
      continue;
    }
    const by = cursorY;
    cursorY -= totalBlockH;
    const locVal = safeText(item.location);
    const tradeVal = safeText(item.trade);
    const defectVal = safeText(item.content ?? item.note);
    const noteVal = safeText(item.result_text ?? item.result ?? item.memo ?? '');

    // 1) 위치 행: [위치](파란) [값](초록)
    const valueW1 = cw - lw;
    page.drawRectangle({
      x: ox,
      y: by - rowH,
      width: lw,
      height: rowH,
      borderColor: rgbLabel(),
      borderWidth: bw
    });
    page.drawText(truncateToFit('위치', 8), {
      x: ox + 4,
      y: by - rowH + 5,
      size: FONT_SIZE,
      font
    });
    page.drawRectangle({
      x: ox + lw,
      y: by - rowH,
      width: valueW1,
      height: rowH,
      borderColor: rgbValue(),
      borderWidth: bw
    });
    page.drawText(truncateToFit(locVal, 28), {
      x: ox + lw + 4,
      y: by - rowH + 5,
      size: FONT_SIZE,
      font
    });

    // 2) 사진 영역: 근거리/원거리. 점검 등록 사진 있으면 채움
    const halfW = cw / 2;
    const photoY = by - rowH - photoH;
    page.drawRectangle({
      x: ox,
      y: photoY,
      width: halfW,
      height: photoH,
      borderColor: rgbPhoto(),
      borderWidth: bw
    });
    page.drawRectangle({
      x: ox + halfW,
      y: photoY,
      width: halfW,
      height: photoH,
      borderColor: rgbPhoto(),
      borderWidth: bw
    });
    const photos = item.photos && Array.isArray(item.photos) ? item.photos : [];
    const url0 = photos[0] && (photos[0].file_url || photos[0].url);
    const url1 = photos[1] && (photos[1].file_url || photos[1].url);
    if (url0) await embedAndDrawPhoto(pdfDoc, page, url0, ox + 2, photoY + 2, halfW - 4, photoH - 4);
    if (url1) await embedAndDrawPhoto(pdfDoc, page, url1, ox + halfW + 2, photoY + 2, halfW - 4, photoH - 4);
    if (!url0) page.drawText('근거리', { x: ox + halfW / 2 - 15, y: photoY + photoH / 2 - 4, size: 9, font });
    if (!url1) page.drawText('원거리', { x: ox + halfW + halfW / 2 - 15, y: photoY + photoH / 2 - 4, size: 9, font });
    // 사진 출처(세대주/점검원) 표기 — 사진 영역 좌상단
    if (item._source) {
      page.drawText(`[${item._source} 등록 사진]`, {
        x: ox + 3,
        y: photoY + photoH - 11,
        size: 7,
        font,
        color: rgb(0.2, 0.2, 0.2)
      });
    }

    // 3) 공종/하자내용 행: [공 종][값][하자내용][값] — 하자내용 한글 10자, 글자축소
    const row2Y = photoY - rowH;
    [['공 종', tradeVal, 14], ['하자내용', defectVal, 15]].forEach(([label, val, maxC], i) => {
      const cx = ox + i * (cdw * 2);
      page.drawRectangle({
        x: cx,
        y: row2Y,
        width: lw,
        height: rowH,
        borderColor: rgbLabel(),
        borderWidth: bw
      });
      page.drawText(truncateToFit(label, 6), {
        x: cx + 4,
        y: row2Y + 5,
        size: FONT_SIZE,
        font
      });
      page.drawRectangle({
        x: cx + lw,
        y: row2Y,
        width: cdw * 2 - lw,
        height: rowH,
        borderColor: rgbValue(),
        borderWidth: bw
      });
      page.drawText(truncateToFit(val, maxC), {
        x: cx + lw + 4,
        y: row2Y + 5,
        size: 7,
        font
      });
    });

    // 4) 특이사항 행: [특이사항][값] — 한글 10자, 글자축소
    const row3Y = row2Y - rowH;
    page.drawRectangle({
      x: ox,
      y: row3Y,
      width: lw,
      height: rowH,
      borderColor: rgbLabel(),
      borderWidth: bw
    });
    page.drawText('특이사항', {
      x: ox + 4,
      y: row3Y + 5,
      size: FONT_SIZE,
      font
    });
    page.drawRectangle({
      x: ox + lw,
      y: row3Y,
      width: cw - lw,
      height: rowH,
      borderColor: rgbValue(),
      borderWidth: bw
    });
    page.drawText(truncateToFit(noteVal, 15), {
      x: ox + lw + 4,
      y: row3Y + 5,
      size: 7,
      font
    });
  }
}

/** 육안점검: 세대주 하자 → 점검원 육안 순. 항목 많으면 추가 페이지 삽입. 사용한 페이지 수 반환. */
async function drawVisualTablePages(pdfDoc, slotIndex, font, reportData) {
  const items = getVisualPageItems(reportData);
  const block = LAYOUT.VISUAL_BLOCK;
  const pageTop = block.origin.y;
  const pageBottom = 80;
  const initialSlot = slotIndex;
  let offset = 0;
  let page = pdfDoc.getPages()[slotIndex];
  while (offset < items.length) {
    let used = 0;
    const chunk = [];
    for (let i = offset; i < items.length; i++) {
      const h = visualItemHeight(items[i], block);
      if (chunk.length > 0 && used + h > pageTop - pageBottom) break;
      if (chunk.length === 0 && h > pageTop - pageBottom) {
        chunk.push(items[i]);
        used += h;
        break;
      }
      chunk.push(items[i]);
      used += h;
    }
    await drawVisualBlocksOnPage(pdfDoc, page, font, reportData, chunk);
    offset += chunk.length;
    if (offset >= items.length) break;
    pdfDoc.insertPage(slotIndex + 1, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
    slotIndex++;
    page = pdfDoc.getPages()[slotIndex];
  }
  return slotIndex - initialSlot + 1;
}

/** 열화상점검 1페이지분: chunk만 그리기. 점검 사진 있으면 채움. */
async function drawThermalBlocksOnPage(pdfDoc, page, font, reportData, chunk) {
  const dong = reportData.dong || '';
  const ho = reportData.ho || '';
  const block = LAYOUT.THERMAL_BLOCK;
  const ox = block.origin.x;
  const cw = block.contentWidth;
  const rowH = block.rowHeight;
  const photoH = block.photoHeight;
  const lw = block.labelWidth;
  const cdw = block.cellDetailWidth;
  const gap = block.blockGap;
  const bw = block.borderWidth;
  const rgbLabel = () => rgb(block.colors.labelBorder.r, block.colors.labelBorder.g, block.colors.labelBorder.b);
  const rgbValue = () => rgb(block.colors.valueBorder.r, block.colors.valueBorder.g, block.colors.valueBorder.b);
  const rgbPhoto = () => rgb(block.colors.photoBorder.r, block.colors.photoBorder.g, block.colors.photoBorder.b);

  page.drawText(block.title, { x: ox, y: LAYOUT.PAGE_HEIGHT - 50, size: TITLE_FONT_SIZE, font });
  page.drawText(`${dong}동 ${ho}호  최종점검결과`, { x: ox, y: LAYOUT.PAGE_HEIGHT - 70, size: 11, font });

  const blockHeight = rowH * 3 + photoH;
  const totalBlockH = blockHeight + gap;
  const startY = block.origin.y;

  for (let idx = 0; idx < chunk.length; idx++) {
    const item = chunk[idx];
    const by = startY - idx * totalBlockH;
    const locVal = safeText(item.location);
    const tradeVal = safeText(item.trade);
    const noteVal = safeText(item.result_text ?? item.result ?? item.note ?? '');

    const valueW1 = cw - lw;
    page.drawRectangle({ x: ox, y: by - rowH, width: lw, height: rowH, borderColor: rgbLabel(), borderWidth: bw });
    page.drawText('위치', { x: ox + 4, y: by - rowH + 5, size: FONT_SIZE, font });
    page.drawRectangle({ x: ox + lw, y: by - rowH, width: valueW1, height: rowH, borderColor: rgbValue(), borderWidth: bw });
    page.drawText(truncateToFit(locVal, 28), { x: ox + lw + 4, y: by - rowH + 5, size: FONT_SIZE, font });

    const halfW = cw / 2;
    const photoY = by - rowH - photoH;
    page.drawRectangle({ x: ox, y: photoY, width: halfW, height: photoH, borderColor: rgbPhoto(), borderWidth: bw });
    page.drawRectangle({ x: ox + halfW, y: photoY, width: halfW, height: photoH, borderColor: rgbPhoto(), borderWidth: bw });
    const photos = item.photos && Array.isArray(item.photos) ? item.photos : [];
    const url0 = photos[0] && (photos[0].file_url || photos[0].url);
    const url1 = photos[1] && (photos[1].file_url || photos[1].url);
    if (url0) await embedAndDrawPhoto(pdfDoc, page, url0, ox + 2, photoY + 2, halfW - 4, photoH - 4);
    if (url1) await embedAndDrawPhoto(pdfDoc, page, url1, ox + halfW + 2, photoY + 2, halfW - 4, photoH - 4);
    if (!url0) page.drawText('일반', { x: ox + halfW / 2 - 12, y: photoY + photoH / 2 - 4, size: 9, font });
    if (!url1) page.drawText('열화상', { x: ox + halfW + halfW / 2 - 12, y: photoY + photoH / 2 - 4, size: 9, font });

    const row2Y = photoY - rowH;
    [['공종', tradeVal, 14], ['점검내용', noteVal, 15]].forEach(([label, val, maxC], i) => {
      const cx = ox + i * (cdw * 2);
      page.drawRectangle({ x: cx, y: row2Y, width: lw, height: rowH, borderColor: rgbLabel(), borderWidth: bw });
      page.drawText(truncateToFit(label, 6), { x: cx + 4, y: row2Y + 5, size: FONT_SIZE, font });
      page.drawRectangle({ x: cx + lw, y: row2Y, width: cdw * 2 - lw, height: rowH, borderColor: rgbValue(), borderWidth: bw });
      page.drawText(truncateToFit(val, maxC), { x: cx + lw + 4, y: row2Y + 5, size: 7, font });
    });
  }
}

/** 열화상점검: 갯수/페이지 제한 없이 모든 항목 그리기. 사용한 페이지 수 반환. */
async function drawThermalTablePages(pdfDoc, slotIndex, font, reportData) {
  const items = reportData.thermal_inspections || [];
  const block = LAYOUT.THERMAL_BLOCK;
  const rowH = block.rowHeight;
  const photoH = block.photoHeight;
  const gap = block.blockGap;
  const blockHeight = rowH * 3 + photoH;
  const totalBlockH = blockHeight + gap;
  const maxBlocks = Math.max(1, Math.floor((block.origin.y - 80) / totalBlockH));
  const initialSlot = slotIndex;
  let offset = 0;
  let page = pdfDoc.getPages()[slotIndex];
  while (true) {
    const chunk = items.slice(offset, offset + maxBlocks);
    await drawThermalBlocksOnPage(pdfDoc, page, font, reportData, chunk);
    offset += chunk.length;
    if (offset >= items.length) break;
    pdfDoc.insertPage(slotIndex + 1, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
    slotIndex++;
    page = pdfDoc.getPages()[slotIndex];
  }
  return slotIndex - initialSlot + 1;
}

/** 공기질점검 1페이지분: 블록형 [점검내용][고정그림][수치|단위][사진1개] — 세로 높이 통일 */
async function drawAirBlocksOnPage(pdfDoc, page, font, reportData, chunk, airDiagramImage) {
  const dong = reportData.dong || '';
  const ho = reportData.ho || '';
  const block = LAYOUT.AIR_BLOCK;
  const ox = block.origin.x;
  const mH = block.metaRowHeight;
  const mLw = block.metaLabelWidth;
  const mVw = block.metaValueWidth;
  const phW = block.photoWidth;
  const phH = block.photoHeight;
  const rowH = block.contentRowHeight || 100;
  const dgW = block.diagramWidth || 90;
  const dgH = block.diagramHeight || 90;
  const valColW = block.valuesValColWidth || 48;
  const unitColW = block.valuesUnitColWidth || 72;
  const tableRowH = block.valuesRowHeight || 22;
  const gap = block.blockGap;
  const rgbPhoto = () => rgb(block.colors.photoBorder.r, block.colors.photoBorder.g, block.colors.photoBorder.b);
  const rgbBeige = () => rgb(0.96, 0.94, 0.88);
  const rgbLabelBg = () => rgb(0.92, 0.91, 0.88);
  const rgbBlack = () => rgb(0.2, 0.2, 0.2);
  const rgbOuterBorder = () => rgb(0.85, 0.45, 0.35);
  const rgbInnerBorder = () => rgb(0.55, 0.4, 0.32);

  page.drawText(block.title, { x: ox, y: LAYOUT.PAGE_HEIGHT - 50, size: TITLE_FONT_SIZE, font });
  page.drawText(`${dong}동 ${ho}호  최종점검결과`, { x: ox, y: LAYOUT.PAGE_HEIGHT - 70, size: 11, font });

  const totalBlockH = rowH + gap;
  const metaEndX = ox + mLw + mVw;
  const diagramX = metaEndX + 6;
  const tableW = valColW + unitColW;
  const tableX = diagramX + dgW + 6;
  const photoX = tableX + tableW + 6;
  const blockContentW = photoX + phW - ox;

  for (let idx = 0; idx < chunk.length; idx++) {
    const row = chunk[idx];
    const a = row.air;
    const r = row.radon;
    const rowTop = block.origin.y - idx * totalBlockH;
    const rowBottom = rowTop - rowH;
    const metaX = ox;

    const locVal = a ? safeText(a.location) : (r ? safeText(r.location) : '-');
    const resVal = a ? (a.result_text ?? a.result ?? '-') : (r ? (r.result_text ?? r.result ?? '-') : '-');
    const typeVal = a ? (a.process_type_label ?? a.process_type ?? '-') : '-';
    const memoVal = a ? safeText(a.note) : (r ? safeText(r.note) : '-');
    const tvocVal = a ? String(a.tvoc ?? '-') : '-';
    const hchoVal = a ? String(a.hcho ?? '-') : '-';
    const radonVal = r ? `${r.radon ?? '-'}`.trim() : '-';

    // 하나의 점검결과 박스: 점검내용·고정그림·수치·사진 세로 높이 동일(rowH)
    page.drawRectangle({
      x: ox - 2,
      y: rowBottom - 2,
      width: blockContentW + 4,
      height: rowH + 4,
      borderColor: rgbOuterBorder(),
      borderWidth: 1.2
    });
    page.drawRectangle({
      x: ox,
      y: rowBottom,
      width: blockContentW,
      height: rowH,
      color: rgbBeige(),
      borderColor: rgbInnerBorder(),
      borderWidth: 0.5
    });

    // 1) 점검내용: 위치/결과/유형/메모 — 메모 한글 10자, 글자축소
    const contentTop = rowTop - 8;
    [['위치', locVal, 12], ['결과', resVal, 12], ['유형', typeVal, 12], ['메모', memoVal, 15]].forEach(([label, val, maxC], i) => {
      const rowY = contentTop - (i + 1) * mH;
      page.drawRectangle({ x: metaX, y: rowY, width: mLw, height: mH, color: rgbLabelBg(), borderColor: rgbBlack(), borderWidth: 0.4 });
      page.drawText(truncateToFit(label, 4), { x: metaX + 2, y: rowY + 4, size: 8, font });
      page.drawRectangle({ x: metaX + mLw, y: rowY, width: mVw, height: mH, color: rgb(1, 1, 1), borderColor: rgbBlack(), borderWidth: 0.4 });
      page.drawText(truncateToFit(val, maxC), { x: metaX + mLw + 2, y: rowY + 4, size: label === '메모' ? 7 : 8, font });
    });

    // 2) 점검내용과 수치 사이 고정그림 (동일 세로 범위 rowBottom ~ rowTop)
    const diagramY = rowBottom + (rowH - dgH) / 2;
    if (airDiagramImage) {
      page.drawImage(airDiagramImage, { x: diagramX, y: diagramY, width: dgW, height: dgH });
    } else {
      page.drawRectangle({ x: diagramX, y: diagramY, width: dgW, height: dgH, color: rgb(0.85, 0.45, 0.35), borderColor: rgbBlack(), borderWidth: 0.4 });
      page.drawText('공기질', { x: diagramX + dgW / 2 - 18, y: diagramY + dgH / 2 - 6, size: 9, font });
    }

    // 3) 수치 | 4) 수치 옆 단위 (rowH 안에 3행, 세로 중앙)
    const tableH = tableRowH * 3;
    const tableY = rowBottom + (rowH - tableH) / 2 + tableH;
    page.drawRectangle({
      x: tableX,
      y: tableY - tableH,
      width: tableW,
      height: tableH,
      color: rgbBeige(),
      borderColor: rgbBlack(),
      borderWidth: 0.4
    });
    const paramUnits = ['TVOC (mg/m\u00B3)', 'HCHO (mg/m\u00B3)', 'Radon (Bq/m\u00B3)'];
    [tvocVal, hchoVal, radonVal].forEach((v, i) => {
      const rY = tableY - (i + 1) * tableRowH;
      page.drawLine({ start: { x: tableX, y: rY }, end: { x: tableX + tableW, y: rY }, thickness: 0.4, color: rgbBlack() });
      page.drawText(truncateToFit(v, 8), { x: tableX + 4, y: rY + 5, size: 8, font });
      page.drawText(truncateToFit(paramUnits[i], 14), { x: tableX + valColW + 4, y: rY + 5, size: 7, font });
    });
    page.drawLine({ start: { x: tableX + valColW, y: tableY - tableH }, end: { x: tableX + valColW, y: tableY }, thickness: 0.4, color: rgbBlack() });

    // 5) 사진 1개 (동일 세로 범위 rowBottom ~ rowTop)
    const photoY = rowBottom + (rowH - phH) / 2;
    page.drawRectangle({ x: photoX, y: photoY, width: phW, height: phH, borderColor: rgbPhoto(), borderWidth: 0.8 });
    page.drawText('라돈 사진', { x: photoX + 2, y: photoY + phH - 10, size: 7, font });
    const photos = (r && r.photos) ? r.photos : (a && a.photos) ? a.photos : [];
    const photoUrl = photos[0] && (photos[0].file_url || photos[0].url);
    if (photoUrl) {
      await embedAndDrawPhoto(pdfDoc, page, photoUrl, photoX + 2, photoY + 2, phW - 4, phH - 14);
    } else {
      page.drawText('-', { x: photoX + phW / 2 - 4, y: photoY + phH / 2 - 6, size: 9, font });
    }
  }
}

/** 공기질점검: 갯수/페이지 제한 없이 모든 행 그리기. 사용한 페이지 수 반환. */
async function drawAirTablePages(pdfDoc, slotIndex, font, reportData, airDiagramImage) {
  const airList = reportData.air_measurements || [];
  const radonList = reportData.radon_measurements || [];
  const combined = [];
  airList.forEach((a, i) => {
    combined.push({ air: a, radon: radonList[i] || null });
  });
  if (combined.length === 0 && radonList.length > 0) {
    radonList.forEach((r) => combined.push({ air: null, radon: r }));
  }
  const block = LAYOUT.AIR_BLOCK;
  const rowH = block.contentRowHeight ?? block.blockHeight;
  const totalBlockH = rowH + block.blockGap;
  const maxBlocks = Math.max(1, Math.floor((block.origin.y - 80) / totalBlockH));
  const initialSlot = slotIndex;
  let offset = 0;
  let page = pdfDoc.getPages()[slotIndex];
  while (true) {
    const chunk = combined.slice(offset, offset + maxBlocks);
    await drawAirBlocksOnPage(pdfDoc, page, font, reportData, chunk, airDiagramImage);
    offset += chunk.length;
    if (offset >= combined.length) break;
    pdfDoc.insertPage(slotIndex + 1, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
    slotIndex++;
    page = pdfDoc.getPages()[slotIndex];
  }
  return slotIndex - initialSlot + 1;
}

/** 공기질 수치중심: 리스트(표) + 하단 사진 영역. 표는 AIR_TABLE, 사진은 마지막 페이지 하단에만. */
function getAirRowForTable(row) {
  const a = row.air;
  const r = row.radon;
  return {
    location: a ? safeText(a.location) : (r ? safeText(r.location) : '-'),
    result: a ? (a.result_text ?? a.result ?? '-') : (r ? (r.result_text ?? r.result ?? '-') : '-'),
    process_type: a ? (a.process_type_label ?? a.process_type ?? '-') : '-',
    note: a ? safeText(a.note) : (r ? safeText(r.note) : '-'),
    tvoc: a != null && a.tvoc != null ? String(a.tvoc) : '-',
    hcho: a != null && a.hcho != null ? String(a.hcho) : '-',
    radon: r != null && r.radon != null ? `${r.radon} ${(r.unit || '').trim()}`.trim() : (a ? '-' : '-')
  };
}

async function drawAirTablePagesValues(pdfDoc, slotIndex, font, reportData) {
  const airList = reportData.air_measurements || [];
  const radonList = reportData.radon_measurements || [];
  const combined = [];
  airList.forEach((a, i) => {
    combined.push({ air: a, radon: radonList[i] || null });
  });
  if (combined.length === 0 && radonList.length > 0) {
    radonList.forEach((r) => combined.push({ air: null, radon: r }));
  }
  const airRows = combined.map(getAirRowForTable);
  const tableDef = LAYOUT.AIR_TABLE;
  const initialSlot = slotIndex;
  let offset = 0;
  let page = pdfDoc.getPages()[slotIndex];
  const photoAreaHeight = 110;
  const maxRowsLastPage = Math.max(1, Math.floor((tableDef.origin.y - photoAreaHeight - tableDef.headerHeight - 40) / tableDef.rowHeight));

  while (offset < airRows.length) {
    const isLastChunk = offset + tableDef.maxRowsPerPage >= airRows.length;
    const maxRows = isLastChunk ? Math.min(airRows.length - offset, maxRowsLastPage) : tableDef.maxRowsPerPage;
    const chunk = airRows.slice(offset, offset + maxRows);
    const getCellValue = (item, field) => item[field] ?? '-';
    drawTablePage(page, font, tableDef, reportData, chunk, getCellValue);

    if (isLastChunk) {
      const photoY = 120;
      const photoH = 90;
      const photoW = 495;
      const photoX = tableDef.origin.x;
      page.drawRectangle({
        x: photoX,
        y: photoY,
        width: photoW,
        height: photoH,
        borderColor: rgb(0.95, 0.6, 0.2),
        borderWidth: 0.8
      });
      let url0, url1;
      for (const a of airList) {
        if (a.photos && a.photos.length > 0) {
          url0 = a.photos[0].file_url || a.photos[0].url;
          url1 = a.photos[1] && (a.photos[1].file_url || a.photos[1].url);
          break;
        }
      }
      if (!url0 && !url1) {
        for (const r of radonList) {
          if (r.photos && r.photos.length > 0) {
            url0 = r.photos[0].file_url || r.photos[0].url;
            url1 = r.photos[1] && (r.photos[1].file_url || r.photos[1].url);
            break;
          }
        }
      }
      if (url0) await embedAndDrawPhoto(pdfDoc, page, url0, photoX + 2, photoY + 2, (photoW / 2) - 4, photoH - 4);
      if (url1) await embedAndDrawPhoto(pdfDoc, page, url1, photoX + photoW / 2 + 2, photoY + 2, (photoW / 2) - 4, photoH - 4);
      if (!url0 && !url1) page.drawText('공기질/라돈 점검 사진', { x: photoX + 8, y: photoY + photoH - 14, size: 9, font });
    }

    offset += chunk.length;
    if (offset >= airRows.length) break;
    pdfDoc.insertPage(slotIndex + 1, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
    slotIndex++;
    page = pdfDoc.getPages()[slotIndex];
  }
  return slotIndex - initialSlot + 1;
}

/** 레벨기 중앙 다이어그램: 고정 이미지 사용 시 이미지 그리기, 없으면 코드로 창문+점선+점검방향 그리기 */
function drawLevelDiagram(page, font, diagramX, diagramY, diagramWidth, diagramHeight, levelDiagramImage) {
  if (levelDiagramImage) {
    page.drawImage(levelDiagramImage, {
      x: diagramX,
      y: diagramY,
      width: diagramWidth,
      height: diagramHeight
    });
    return;
  }
  const black = rgb(0.2, 0.2, 0.2);
  const centerX = diagramX + diagramWidth / 2;
  const top = diagramY + diagramHeight - 10;
  const bottom = diagramY + 10;

  page.drawRectangle({
    x: diagramX,
    y: diagramY,
    width: diagramWidth,
    height: diagramHeight,
    borderColor: black,
    borderWidth: 0.5
  });

  const winW = 70;
  const winH = 24;
  const winX = centerX - winW / 2;
  const winY = top - winH - 15;
  page.drawRectangle({
    x: winX,
    y: winY,
    width: winW,
    height: winH,
    borderColor: black,
    borderWidth: 0.4
  });
  page.drawText('(창문)', {
    x: centerX - 18,
    y: winY - 12,
    size: 7,
    font
  });

  for (let i = 0; i < 8; i++) {
    const fromX = i % 2 === 0 ? winX : winX + winW;
    const fromY = winY + (i < 4 ? winH : 0);
    const toX = fromX + (i < 2 ? -25 : i < 4 ? 25 : i < 6 ? -25 : 25);
    const toY = fromY + (i < 2 || i >= 6 ? 20 : -20);
    page.drawLine({
      start: { x: fromX, y: fromY },
      end: { x: toX, y: toY },
      thickness: 0.3,
      color: black
    });
  }

  const arrowTop = bottom + 45;
  page.drawLine({
    start: { x: centerX - 12, y: arrowTop - 25 },
    end: { x: centerX, y: arrowTop },
    thickness: 0.8,
    color: black
  });
  page.drawLine({
    start: { x: centerX + 12, y: arrowTop - 25 },
    end: { x: centerX, y: arrowTop },
    thickness: 0.8,
    color: black
  });
  page.drawText('(점검방향)', {
    x: centerX - 22,
    y: bottom + 8,
    size: 7,
    font
  });
}

/** 레벨기점검 블록형: [좌: 1번2번/고정그림/3번4번][중: 점검내용][우: 사진] — 세로 높이 통일 */
async function drawLevelBlocksOnPage(pdfDoc, page, font, reportData, chunk, levelDiagramImage) {
  const dong = reportData.dong || '';
  const ho = reportData.ho || '';
  const block = LAYOUT.LEVEL_BLOCK;
  const ox = block.origin.x;
  const rowH = block.contentRowHeight || 120;
  const mRowH = block.rowHeight || 20;
  const lw = block.labelWidth || 70;
  const mVw = block.metaValueWidth || 110;
  const pRowH = block.pointRowHeight || 22;
  const pLw = block.pointLabelWidth || 50;
  const pVw = block.pointValueWidth || 45;
  const leftW = block.leftSectionWidth || 140;
  const dW = block.diagramWidth || 120;
  const dH = block.diagramHeight || 80;
  const phW = block.photoWidth || 100;
  const phH = block.photoHeight || 100;
  const gap = block.blockGap;
  const bw = block.borderWidth;
  const rgbLabel = () => rgb(block.colors.labelBorder.r, block.colors.labelBorder.g, block.colors.labelBorder.b);
  const rgbValue = () => rgb(block.colors.valueBorder.r, block.colors.valueBorder.g, block.colors.valueBorder.b);
  const rgbPhoto = () => rgb(block.colors.photoBorder.r, block.colors.photoBorder.g, block.colors.photoBorder.b);
  const rgbBeige = () => rgb(0.96, 0.94, 0.88);
  const rgbOuter = () => rgb(0.85, 0.45, 0.35);
  const rgbInner = () => rgb(0.55, 0.4, 0.32);

  page.drawText(block.title, { x: ox, y: LAYOUT.PAGE_HEIGHT - 50, size: TITLE_FONT_SIZE, font });
  page.drawText(`${dong}동 ${ho}호  최종점검결과`, { x: ox, y: LAYOUT.PAGE_HEIGHT - 70, size: 11, font });

  const totalBlockH = rowH + gap;
  const startY = block.origin.y;
  const metaX = ox + leftW + 6;
  const metaW = 180;
  const photoX = metaX + lw + mVw + 6;

  const fmt = (v) => (v != null && v !== '') ? String(v) : '-';
  const p1L = (i) => fmt(i.point1_left_mm);
  const p1R = (i) => fmt(i.point1_right_mm);
  const p2L = (i) => fmt(i.point2_left_mm);
  const p2R = (i) => fmt(i.point2_right_mm);
  const p3L = (i) => fmt(i.point3_left_mm);
  const p3R = (i) => fmt(i.point3_right_mm);
  const p4L = (i) => fmt(i.point4_left_mm);
  const p4R = (i) => fmt(i.point4_right_mm);

  for (let idx = 0; idx < chunk.length; idx++) {
    const item = chunk[idx];
    const rowTop = startY - idx * totalBlockH;
    const rowBottom = rowTop - rowH;
    const refMm = String(item.level_reference_mm ?? item.reference_mm ?? 150);
    const blockW = photoX + phW - ox;

    page.drawRectangle({ x: ox - 2, y: rowBottom - 2, width: blockW + 4, height: rowH + 4, borderColor: rgbOuter(), borderWidth: 1.2 });
    page.drawRectangle({ x: ox, y: rowBottom, width: blockW, height: rowH, color: rgbBeige(), borderColor: rgbInner(), borderWidth: 0.5 });

    const leftX = ox + 4;
    const halfLeft = (leftW - 8) / 2;
    const topRowY = rowTop - 8 - pRowH;
    const diagramY = rowBottom + pRowH + 10;
    const botRowY = rowBottom + 4;

    // 1번수치 2번수치 (상단, 나란히) — 세로 높이 절반
    const valW = Math.max(halfLeft - 2 - pLw, 48);
    [['1번', `${p1L(item)}/${p1R(item)}`], ['2번', `${p2L(item)}/${p2R(item)}`]].forEach(([label, val], i) => {
      const cx = leftX + i * halfLeft;
      page.drawRectangle({ x: cx, y: topRowY, width: pLw, height: pRowH, borderColor: rgbLabel(), borderWidth: bw });
      page.drawText(truncateToFit(label, 4), { x: cx + 2, y: topRowY + 2, size: 6, font });
      page.drawRectangle({ x: cx + pLw, y: topRowY, width: valW, height: pRowH, borderColor: rgbValue(), borderWidth: bw });
      page.drawText(truncateToFit(val, 10), { x: cx + pLw + 2, y: topRowY + 2, size: 6, font });
    });

    // 고정그림 (중앙, 확대)
    const diagramX = leftX + (leftW - 8 - dW) / 2;
    if (levelDiagramImage) {
      page.drawImage(levelDiagramImage, { x: diagramX, y: diagramY, width: dW, height: dH });
    } else {
      drawLevelDiagram(page, font, diagramX, diagramY, dW, dH, null);
    }

    // 3번수치 4번수치 (하단, 나란히) — 세로 높이 절반
    [['3번', `${p3L(item)}/${p3R(item)}`], ['4번', `${p4L(item)}/${p4R(item)}`]].forEach(([label, val], i) => {
      const cx = leftX + i * halfLeft;
      page.drawRectangle({ x: cx, y: botRowY, width: pLw, height: pRowH, borderColor: rgbLabel(), borderWidth: bw });
      page.drawText(truncateToFit(label, 4), { x: cx + 2, y: botRowY + 2, size: 6, font });
      page.drawRectangle({ x: cx + pLw, y: botRowY, width: valW, height: pRowH, borderColor: rgbValue(), borderWidth: bw });
      page.drawText(truncateToFit(val, 10), { x: cx + pLw + 2, y: botRowY + 2, size: 6, font });
    });

    // 점검내용: 위치/결과/기준/메모 — 메모 한글 10자, 글자축소
    let metaY = rowTop - 6;
    [['위치', safeText(item.location), 14], ['결과', item.result_text ?? item.result ?? '-', 14], ['기준', refMm, 14], ['메모', safeText(item.note), 15]].forEach(([label, val, maxC]) => {
      metaY -= mRowH;
      page.drawRectangle({ x: metaX, y: metaY, width: lw, height: mRowH, color: rgbBeige(), borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.4 });
      page.drawText(truncateToFit(label, 4), { x: metaX + 2, y: metaY + 4, size: 8, font });
      page.drawRectangle({ x: metaX + lw, y: metaY, width: mVw, height: mRowH, color: rgb(1, 1, 1), borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.4 });
      page.drawText(truncateToFit(val, maxC), { x: metaX + lw + 2, y: metaY + 4, size: label === '메모' ? 7 : 8, font });
    });

    // 사진 1개 (우측)
    const photoY = rowBottom + (rowH - phH) / 2;
    page.drawRectangle({ x: photoX, y: photoY, width: phW, height: phH, borderColor: rgbPhoto(), borderWidth: bw });
    page.drawText('점검사진', { x: photoX + 2, y: photoY + phH - 10, size: 7, font });
    const photos = item.photos && Array.isArray(item.photos) ? item.photos : [];
    const photoUrl = photos[0] && (photos[0].file_url || photos[0].url);
    if (photoUrl) {
      await embedAndDrawPhoto(pdfDoc, page, photoUrl, photoX + 2, photoY + 2, phW - 4, phH - 14);
    } else {
      page.drawText('-', { x: photoX + phW / 2 - 4, y: photoY + phH / 2 - 6, size: 9, font });
    }
  }
}

/** 레벨기점검: 갯수/페이지 제한 없이 모든 항목 그리기. 사용한 페이지 수 반환. */
async function drawLevelTablePages(pdfDoc, slotIndex, font, reportData, levelDiagramImage) {
  const items = reportData.level_measurements || [];
  const block = LAYOUT.LEVEL_BLOCK;
  const rowH = block.contentRowHeight ?? 120;
  const gap = block.blockGap;
  const totalBlockH = rowH + gap;
  const maxBlocks = Math.max(1, Math.floor((block.origin.y - 80) / totalBlockH));
  const initialSlot = slotIndex;
  let offset = 0;
  let page = pdfDoc.getPages()[slotIndex];
  while (true) {
    const chunk = items.slice(offset, offset + maxBlocks);
    await drawLevelBlocksOnPage(pdfDoc, page, font, reportData, chunk, levelDiagramImage);
    offset += chunk.length;
    if (offset >= items.length) break;
    pdfDoc.insertPage(slotIndex + 1, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
    slotIndex++;
    page = pdfDoc.getPages()[slotIndex];
  }
  return slotIndex - initialSlot + 1;
}

/** 레벨기 수치중심: 리스트(표) + 하단 사진 영역. 사진 있으면 마지막 페이지 하단에 채움. */
async function drawLevelTablePagesValues(pdfDoc, slotIndex, font, reportData) {
  const items = reportData.level_measurements || [];
  const tableDef = LAYOUT.LEVEL_TABLE;
  const getCellValue = (item, field) => {
    if (field === 'result') return item.result_text ?? item.result ?? '-';
    if (field === 'reference_mm') return String(item.level_reference_mm ?? item.reference_mm ?? '-');
    if (field === 'points') return item.level_summary_text ?? item.points ?? '-';
    return safeText(item[field]);
  };
  const initialSlot = slotIndex;
  let offset = 0;
  let page = pdfDoc.getPages()[slotIndex];
  const photoAreaHeight = 110;
  const maxRowsLastPage = Math.max(1, Math.floor((tableDef.origin.y - photoAreaHeight - tableDef.headerHeight - 40) / tableDef.rowHeight));

  while (offset < items.length) {
    const isLastChunk = offset + tableDef.maxRowsPerPage >= items.length;
    const maxRows = isLastChunk ? Math.min(items.length - offset, maxRowsLastPage) : tableDef.maxRowsPerPage;
    const chunk = items.slice(offset, offset + maxRows);
    drawTablePage(page, font, tableDef, reportData, chunk, getCellValue);

    if (isLastChunk) {
      const photoY = 120;
      const photoH = 90;
      const photoW = 495;
      const photoX = tableDef.origin.x;
      page.drawRectangle({
        x: photoX,
        y: photoY,
        width: photoW,
        height: photoH,
        borderColor: rgb(0.95, 0.6, 0.2),
        borderWidth: 0.8
      });
      let url0, url1;
      for (const item of items) {
        if (item.photos && item.photos.length > 0) {
          url0 = item.photos[0].file_url || item.photos[0].url;
          url1 = item.photos[1] && (item.photos[1].file_url || item.photos[1].url);
          break;
        }
      }
      if (url0) await embedAndDrawPhoto(pdfDoc, page, url0, photoX + 2, photoY + 2, (photoW / 2) - 4, photoH - 4);
      if (url1) await embedAndDrawPhoto(pdfDoc, page, url1, photoX + photoW / 2 + 2, photoY + 2, (photoW / 2) - 4, photoH - 4);
      if (!url0 && !url1) page.drawText('레벨기 점검 사진', { x: photoX + 8, y: photoY + photoH - 14, size: 9, font });
    }

    offset += chunk.length;
    if (offset >= items.length) break;
    pdfDoc.insertPage(slotIndex + 1, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
    slotIndex++;
    page = pdfDoc.getPages()[slotIndex];
  }
  return slotIndex - initialSlot + 1;
}

/** 템플릿 8·10·12·13p를 제거하고, 같은 위치에 빈 A4 4장 삽입 후 점검결과만 별도 페이지로 그림. 항목 많으면 추가 페이지 삽입. */
async function assembleFinalWithTemplatePages(pdfDoc, reportData, font, airDiagramImage, levelDiagramImage) {
  // 첫 페이지: 빨간 박스에 점검일자, 파란 박스에 세대주 정보
  const page0 = pdfDoc.getPage(0);
  drawFirstPageHouseholdInfo(page0, reportData, font);

  if (pdfDoc.getPageCount() > 12) pdfDoc.removePage(12);
  if (pdfDoc.getPageCount() > 11) pdfDoc.removePage(11);
  if (pdfDoc.getPageCount() > 9) pdfDoc.removePage(9);
  if (pdfDoc.getPageCount() > 7) pdfDoc.removePage(7);

  pdfDoc.insertPage(7, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
  pdfDoc.insertPage(9, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
  pdfDoc.insertPage(11, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
  pdfDoc.insertPage(12, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);

  const v = await drawVisualTablePages(pdfDoc, 7, font, reportData);
  const t = await drawThermalTablePages(pdfDoc, 9 + (v - 1), font, reportData);
  const a = await drawAirTablePages(pdfDoc, 11 + (v - 1) + (t - 1), font, reportData, airDiagramImage);
  await drawLevelTablePages(pdfDoc, 12 + (v - 1) + (t - 1) + (a - 1), font, reportData, levelDiagramImage);
}

/** 수치중심: 육안/열화상은 동일, 공기질/레벨기는 리스트(표) + 하단 사진만. */
async function assembleFinalWithTemplatePagesValues(pdfDoc, reportData, font) {
  // 첫 페이지: 빨간 박스에 점검일자, 파란 박스에 세대주 정보
  const page0 = pdfDoc.getPage(0);
  drawFirstPageHouseholdInfo(page0, reportData, font);

  if (pdfDoc.getPageCount() > 12) pdfDoc.removePage(12);
  if (pdfDoc.getPageCount() > 11) pdfDoc.removePage(11);
  if (pdfDoc.getPageCount() > 9) pdfDoc.removePage(9);
  if (pdfDoc.getPageCount() > 7) pdfDoc.removePage(7);

  pdfDoc.insertPage(7, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
  pdfDoc.insertPage(9, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
  pdfDoc.insertPage(11, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
  pdfDoc.insertPage(12, [LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);

  const v = await drawVisualTablePages(pdfDoc, 7, font, reportData);
  const t = await drawThermalTablePages(pdfDoc, 9 + (v - 1), font, reportData);
  const a = await drawAirTablePagesValues(pdfDoc, 11 + (v - 1) + (t - 1), font, reportData);
  await drawLevelTablePagesValues(pdfDoc, 12 + (v - 1) + (t - 1) + (a - 1), font, reportData);
}

/** 템플릿 없이 점검 표 페이지만 생성 (항목 많으면 추가 페이지) */
async function generateDataOnlyReport(reportData, font, pdfDoc, airDiagramImage, levelDiagramImage) {
  pdfDoc.addPage([LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
  await drawVisualTablePages(pdfDoc, pdfDoc.getPageCount() - 1, font, reportData);
  pdfDoc.addPage([LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
  await drawThermalTablePages(pdfDoc, pdfDoc.getPageCount() - 1, font, reportData);
  pdfDoc.addPage([LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
  await drawAirTablePages(pdfDoc, pdfDoc.getPageCount() - 1, font, reportData, airDiagramImage);
  pdfDoc.addPage([LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
  await drawLevelTablePages(pdfDoc, pdfDoc.getPageCount() - 1, font, reportData, levelDiagramImage);
}

async function generateFinalReport(reportData, options = {}) {
  const dong = reportData.dong || '';
  const ho = reportData.ho || '';
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const finalFilename = options.filename || `보고서_최종_${dong}-${ho}_${timestamp}.pdf`;
  const finalPath = path.join(REPORTS_DIR, finalFilename);

  const templatePath = path.join(TEMPLATE_DIR, TEMPLATE_FILENAME);
  let pdfDoc;
  let usedTemplate = false;

  if (fs.existsSync(templatePath)) {
    try {
      const templateBytes = fs.readFileSync(templatePath);
      pdfDoc = await PDFDocument.load(templateBytes);
      usedTemplate = pdfDoc.getPageCount() >= 13;
    } catch (e) {
      if (!/encrypted|password/i.test(String(e.message))) throw e;
      pdfDoc = await PDFDocument.create();
    }
  }
  if (!pdfDoc) {
    pdfDoc = await PDFDocument.create();
  }

  const font = await embedCustomFont(pdfDoc);

  let airDiagramImage = null;
  let levelDiagramImage = null;
  if (fs.existsSync(AIR_DIAGRAM_PATH)) {
    try {
      airDiagramImage = await pdfDoc.embedPng(fs.readFileSync(AIR_DIAGRAM_PATH));
    } catch (e) {
      // ignore
    }
  }
  if (fs.existsSync(LEVEL_DIAGRAM_PATH)) {
    try {
      levelDiagramImage = await pdfDoc.embedPng(fs.readFileSync(LEVEL_DIAGRAM_PATH));
    } catch (e) {
      // ignore
    }
  }

  if (usedTemplate && pdfDoc.getPageCount() >= 13) {
    await assembleFinalWithTemplatePages(pdfDoc, reportData, font, airDiagramImage, levelDiagramImage);
  } else {
    await generateDataOnlyReport(reportData, font, pdfDoc, airDiagramImage, levelDiagramImage);
  }

  const bytes = await pdfDoc.save();
  fs.writeFileSync(finalPath, bytes);

  const size = fs.statSync(finalPath).size;
  return {
    filename: finalFilename,
    path: finalPath,
    url: `/reports/${finalFilename}`,
    size
  };
}

/** 최종보고서-수치중심: 동일 템플릿·육안·열화상, 공기질/레벨기는 리스트형 + 사진만 하단. */
async function generateFinalReportValues(reportData, options = {}) {
  const dong = reportData.dong || '';
  const ho = reportData.ho || '';
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const finalFilename = options.filename || `보고서_최종_수치중심_${dong}-${ho}_${timestamp}.pdf`;
  const finalPath = path.join(REPORTS_DIR, finalFilename);

  const templatePath = path.join(TEMPLATE_DIR, TEMPLATE_FILENAME);
  let pdfDoc;
  let usedTemplate = false;

  if (fs.existsSync(templatePath)) {
    try {
      const templateBytes = fs.readFileSync(templatePath);
      pdfDoc = await PDFDocument.load(templateBytes);
      usedTemplate = pdfDoc.getPageCount() >= 13;
    } catch (e) {
      if (!/encrypted|password/i.test(String(e.message))) throw e;
      pdfDoc = await PDFDocument.create();
    }
  }
  if (!pdfDoc) {
    pdfDoc = await PDFDocument.create();
  }

  const font = await embedCustomFont(pdfDoc);

  if (usedTemplate && pdfDoc.getPageCount() >= 13) {
    await assembleFinalWithTemplatePagesValues(pdfDoc, reportData, font);
  } else {
    pdfDoc.addPage([LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
    await drawVisualTablePages(pdfDoc, 0, font, reportData);
    pdfDoc.addPage([LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
    await drawThermalTablePages(pdfDoc, 1, font, reportData);
    pdfDoc.addPage([LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
    await drawAirTablePagesValues(pdfDoc, 2, font, reportData);
    pdfDoc.addPage([LAYOUT.PAGE_WIDTH, LAYOUT.PAGE_HEIGHT]);
    await drawLevelTablePagesValues(pdfDoc, 3, font, reportData);
  }

  const bytes = await pdfDoc.save();
  fs.writeFileSync(finalPath, bytes);

  const size = fs.statSync(finalPath).size;
  return {
    filename: finalFilename,
    path: finalPath,
    url: `/reports/${finalFilename}`,
    size
  };
}

module.exports = {
  generateFinalReport,
  generateFinalReportValues,
  getVisualPageItems,
  defectToVisualItem,
  normalizePhotoList,
  loadImageBytes,
  TEMPLATE_FILENAME,
  FILL_PAGE_INDICES: [7, 9, 11, 12]
};
