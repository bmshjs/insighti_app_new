/**
 * 최종보고서 PPTX 생성 — 종합점검보고서_0620.pptx 템플릿 기반
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { getVisualPageItems, normalizePhotoList } = require('./finalReportGenerator');
const { loadImageBytes } = require('./photoPath');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const TEMPLATE_FILENAME = '종합점검보고서_0620.pptx';

const SAMPLE = {
  complex: '힐스테이트 마포 더  퍼스트',
  dong: '103 ',
  ho: '1002',
  nameParts: ['정 ', '정', ' 훈'],
  visual: { location: '현관', trade: '벽체', content: '벽지파손', note: '흡짐오염', blocks: 4 },
  thermal: { location: '침실', locationNo: '1', trade: '좌측벽', tradeSub: ' 하부', result: '이상없음', blocks: 4 },
  air: { location: '침실', locationNo: '1', result: '정상', tvoc: '1.176', hcho: '0.121', radon: '134', blocks: 4 },
  level: { location: '침실', locationNo: '1', result: '정상', p1: '141', p2: '140', p3: '142', p4: '143', blocks: 4 },
};

function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceNthText(xml, oldText, newText, nth = 0) {
  if (!oldText) return xml;
  const esc = escapeRegex(oldText);
  const re = new RegExp(`(<a:t[^>]*>)${esc}(</a:t>)`, 'g');
  let i = 0;
  return xml.replace(re, (m, open, close) => {
    if (i++ !== nth) return m;
    return `${open}${escapeXml(newText ?? '-')}${close}`;
  });
}

function fillSequential(xml, field, values, max = 4) {
  let out = xml;
  for (let i = 0; i < max; i++) {
    out = replaceNthText(out, field, values[i] ?? '-', i);
  }
  return out;
}

function safe(v) {
  if (v == null || v === '') return '-';
  return String(v);
}

function splitLocation(loc) {
  const s = safe(loc);
  const m = s.match(/^(.+?)(\d+)$/);
  if (m) return { main: m[1], sub: m[2] };
  return { main: s, sub: '-' };
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

function fillSlide1(xml, data) {
  let out = xml;
  out = out.replace(
    new RegExp(escapeRegex(SAMPLE.complex), 'g'),
    escapeXml(safe(data.complex))
  );
  out = replaceNthText(out, SAMPLE.dong, `${safe(data.dong)} `, 0);
  out = replaceNthText(out, SAMPLE.ho, safe(data.ho), 0);
  const name = safe(data.name);
  out = replaceNthText(out, SAMPLE.nameParts[0], name ? `${name} ` : '- ', 0);
  out = replaceNthText(out, SAMPLE.nameParts[1], '', 0);
  out = replaceNthText(out, SAMPLE.nameParts[2], '', 0);
  return out;
}

function fillSlide2(xml, items) {
  const max = SAMPLE.visual.blocks;
  const list = items.slice(0, max);
  while (list.length < max) list.push(null);
  let out = xml;
  out = fillSequential(out, SAMPLE.visual.location, list.map((x) => safe(x?.location)), max);
  out = fillSequential(out, SAMPLE.visual.trade, list.map((x) => safe(x?.trade)), max);
  out = fillSequential(
    out,
    SAMPLE.visual.content,
    list.map((x) => safe(x?.note ?? x?.content)),
    max
  );
  out = fillSequential(
    out,
    SAMPLE.visual.note,
    list.map((x) => safe(x?.result_text ?? x?.result ?? x?.memo)),
    max
  );
  return out;
}

function fillSlide3(xml, items) {
  const max = SAMPLE.thermal.blocks;
  const list = items.slice(0, max);
  while (list.length < max) list.push(null);
  let out = xml;
  const locs = list.map((x) => splitLocation(x?.location));
  const trades = list.map((x) => splitTrade(x?.trade));
  out = fillSequential(out, SAMPLE.thermal.location, locs.map((l) => l.main), max);
  out = fillSequential(out, SAMPLE.thermal.locationNo, locs.map((l) => l.sub), max);
  out = fillSequential(out, SAMPLE.thermal.trade, trades.map((t) => t.main), max);
  out = fillSequential(out, SAMPLE.thermal.tradeSub, trades.map((t) => t.sub || ' '), max);
  out = fillSequential(
    out,
    SAMPLE.thermal.result,
    list.map((x) => safe(x?.result_text ?? x?.result ?? x?.note)),
    max
  );
  return out;
}

function fillSlide4(xml, rows) {
  const max = SAMPLE.air.blocks;
  const list = rows.slice(0, max);
  while (list.length < max) list.push({ air: null, radon: null });
  let out = xml;
  const locs = list.map((r) => splitLocation(r.air?.location || r.radon?.location));
  out = fillSequential(out, SAMPLE.air.location, locs.map((l) => l.main), max);
  out = fillSequential(out, SAMPLE.air.locationNo, locs.map((l) => l.sub), max);
  out = fillSequential(
    out,
    SAMPLE.air.result,
    list.map((r) => safe(r.air?.result_text ?? r.air?.result ?? r.radon?.result_text ?? r.radon?.result)),
    max
  );
  out = fillSequential(
    out,
    SAMPLE.air.tvoc,
    list.map((r) => (r.air?.tvoc != null ? String(r.air.tvoc) : '-')),
    max
  );
  out = fillSequential(
    out,
    SAMPLE.air.hcho,
    list.map((r) => (r.air?.hcho != null ? String(r.air.hcho) : '-')),
    max
  );
  out = fillSequential(
    out,
    SAMPLE.air.radon,
    list.map((r) => (r.radon?.radon != null ? String(r.radon.radon) : '-')),
    max
  );
  return out;
}

function fillSlide5(xml, items) {
  const max = SAMPLE.level.blocks;
  const list = items.slice(0, max);
  while (list.length < max) list.push(null);
  let out = xml;
  const locs = list.map((x) => splitLocation(x?.location));
  out = fillSequential(out, SAMPLE.level.location, locs.map((l) => l.main), max);
  out = fillSequential(out, SAMPLE.level.locationNo, locs.map((l) => l.sub), max);
  out = fillSequential(
    out,
    SAMPLE.level.result,
    list.map((x) => safe(x?.result_text ?? x?.result)),
    max
  );
  const p1 = list.map((x) => safe(x?.point1_left_mm ?? x?.left_mm));
  const p2 = list.map((x) => safe(x?.point2_left_mm));
  const p3 = list.map((x) => safe(x?.point3_left_mm));
  const p4 = list.map((x) => safe(x?.point4_left_mm));
  out = fillSequential(out, SAMPLE.level.p1, p1, max);
  out = fillSequential(out, SAMPLE.level.p2, p2, max);
  out = fillSequential(out, SAMPLE.level.p3, p3, max);
  out = fillSequential(out, SAMPLE.level.p4, p4, max);
  return out;
}

function collectPhotoUrls(items, perItem = 2) {
  const urls = [];
  for (const item of items) {
    const photos = normalizePhotoList(item?.photos || []);
    for (let i = 0; i < perItem; i++) {
      const p = photos[i];
      const url = p && (p.file_url || p.url || p.thumb_url);
      if (url) urls.push(url);
    }
  }
  return urls;
}

function parseImageEmbeds(slideXml) {
  const embeds = [];
  const picRe = /<p:pic[\s\S]*?<\/p:pic>/g;
  let m;
  while ((m = picRe.exec(slideXml)) !== null) {
    const block = m[0];
    const embed = block.match(/r:embed="(rId\d+)"/);
    const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    if (!embed) continue;
    const cx = ext ? parseInt(ext[1], 10) : 0;
    const cy = ext ? parseInt(ext[2], 10) : 0;
    const area = cx * cy;
    embeds.push({ rId: embed[1], area, block });
  }
  return embeds.sort((a, b) => b.area - a.area);
}

function parseRels(relsXml) {
  const map = {};
  const re = /Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
  let m;
  while ((m = re.exec(relsXml)) !== null) {
    map[m[1]] = m[2].replace(/^\.\.\//, '');
  }
  return map;
}

async function replaceSlidePhotos(zip, slideNum, photoUrls, minArea = 800000000) {
  if (!photoUrls.length) return;
  const slidePath = `ppt/slides/slide${slideNum}.xml`;
  const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
  const slideEntry = zip.getEntry(slidePath);
  const relsEntry = zip.getEntry(relsPath);
  if (!slideEntry || !relsEntry) return;

  const slideXml = slideEntry.getData().toString('utf8');
  let relsXml = relsEntry.getData().toString('utf8');
  const relsMap = parseRels(relsXml);
  const embeds = parseImageEmbeds(slideXml).filter((e) => e.area >= minArea);
  const slots = embeds.slice(0, photoUrls.length);
  let mediaCounter = Date.now();

  for (let i = 0; i < slots.length && i < photoUrls.length; i++) {
    const bytes = await loadImageBytes(photoUrls[i]);
    if (!bytes || bytes.length < 20) continue;
    const relTarget = relsMap[slots[i].rId];
    if (!relTarget || !relTarget.startsWith('media/')) continue;
    const isPng = bytes[0] === 0x89;
    const ext = isPng ? '.png' : '.jpg';
    const mediaPath = relTarget.includes('.') ? relTarget : `media/report_${mediaCounter++}${ext}`;
    zip.addFile(`ppt/${mediaPath}`, bytes);
    if (relTarget !== mediaPath) {
      relsXml = relsXml.replace(
        new RegExp(`(Id="${slots[i].rId}"[^>]*Target=")[^"]+(")`),
        `$1../${mediaPath}$2`
      );
      relsMap[slots[i].rId] = mediaPath;
    }
  }
  zip.updateFile(relsPath, Buffer.from(relsXml, 'utf8'));
}

async function updateSlide(zip, slideNum, xml) {
  zip.updateFile(`ppt/slides/slide${slideNum}.xml`, Buffer.from(xml, 'utf8'));
}

async function generateFinalReportPptx(reportData, options = {}) {
  const templatePath = path.join(TEMPLATE_DIR, TEMPLATE_FILENAME);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`PPTX 템플릿을 찾을 수 없습니다: ${TEMPLATE_FILENAME}`);
  }

  const dong = reportData.dong || '';
  const ho = reportData.ho || '';
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const filename = options.filename || `보고서_최종_${dong}-${ho}_${timestamp}.pptx`;
  const outputPath = path.join(REPORTS_DIR, filename);

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.copyFileSync(templatePath, outputPath);
  const zip = new AdmZip(outputPath);

  const visualItems = getVisualItems(reportData);
  const thermalItems = (reportData.thermal_inspections || []).filter((x) => !x._sectionHeader);
  const airRows = getAirRows(reportData);
  const levelItems = reportData.level_measurements || [];

  if (visualItems.length > SAMPLE.visual.blocks) {
    console.warn(`[final-report-pptx] 육안 항목 ${visualItems.length}건 — 슬라이드당 최대 ${SAMPLE.visual.blocks}건만 표시`);
  }

  const slide1 = zip.readAsText('ppt/slides/slide1.xml');
  await updateSlide(zip, 1, fillSlide1(slide1, reportData));

  const slide2 = zip.readAsText('ppt/slides/slide2.xml');
  await updateSlide(zip, 2, fillSlide2(slide2, visualItems));
  await replaceSlidePhotos(zip, 2, collectPhotoUrls(visualItems, 2), 500000000);

  const slide3 = zip.readAsText('ppt/slides/slide3.xml');
  await updateSlide(zip, 3, fillSlide3(slide3, thermalItems));
  await replaceSlidePhotos(zip, 3, collectPhotoUrls(thermalItems, 2), 500000000);

  const slide4 = zip.readAsText('ppt/slides/slide4.xml');
  const airItemsForPhotos = airRows.map((r) => ({
    photos: [
      ...normalizePhotoList(r.air?.photos || []),
      ...normalizePhotoList(r.radon?.photos || []),
    ],
  }));
  await updateSlide(zip, 4, fillSlide4(slide4, airRows));
  await replaceSlidePhotos(zip, 4, collectPhotoUrls(airItemsForPhotos, 1), 300000000);

  const slide5 = zip.readAsText('ppt/slides/slide5.xml');
  await updateSlide(zip, 5, fillSlide5(slide5, levelItems));
  await replaceSlidePhotos(zip, 5, collectPhotoUrls(levelItems, 1), 300000000);

  zip.writeZip(outputPath);
  const size = fs.statSync(outputPath).size;

  console.log(
    `[final-report-pptx] household=${reportData.dong}-${reportData.ho} visual=${visualItems.length} thermal=${thermalItems.length} air=${airRows.length} level=${levelItems.length}`
  );

  return {
    filename,
    path: outputPath,
    url: `/reports/${filename}`,
    size,
  };
}

module.exports = {
  generateFinalReportPptx,
  TEMPLATE_FILENAME,
};
