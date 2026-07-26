/**
 * 점검결과 내보내기: 엑셀(시트별 점검유형) + 사진(점검구분별 폴더) ZIP 생성
 */
const path = require('path');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const { loadImageBytes } = require('./photoPath');

const TYPE_LABELS = { visual: '육안', thermal: '열화상', air: '공기질', radon: '라돈', level: '레벨기' };
const OWNER_VISUAL_SHEET = '세대주 육안점검결과';
const OWNER_VISUAL_HEADERS = ['위치', '공종', '내용', '특이사항', '사진파일'];

function safeVal(v) {
  if (v == null || v === '') return '';
  return String(v);
}

function collectPhotoTags(sheetName, item, rowIndex, photoEntries) {
  const photos = item.photos || [];
  const tags = [];
  photos.forEach((p, pIdx) => {
    const ext = path.extname(p.file_url || p.url || '') || '.jpg';
    const tag = `${sheetName.replace(/\s+/g, '')}_${rowIndex}_${pIdx + 1}${ext}`;
    tags.push(tag);
    const fileUrl = p.file_url || p.url;
    if (fileUrl) {
      photoEntries.push({ zipPath: `${sheetName}/${tag}`, fileUrl });
    }
  });
  return tags;
}

/**
 * @param {object} data - { visual, thermal, air, radon, level, ownerVisual? }
 * @param {string} dong - 동
 * @param {string} ho - 호
 * @param {object} [options]
 * @param {string} [options.xlsxFilename] - ZIP 내 엑셀 파일명 (기본: 점검내용.xlsx)
 * @param {object} [options.household] - { complexName, dongHo, residentName }
 * @returns {Promise<Buffer>} ZIP buffer
 */
async function buildInspectionExportZip(data, dong = '', ho = '', options = {}) {
  const zip = new AdmZip();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'InsightI';
  const xlsxFilename = options.xlsxFilename || '점검내용.xlsx';
  const household = options.household || {};
  const ownerVisual = data.ownerVisual || [];

  const photoEntries = []; // { zipPath, buffer }

  // 1번째 시트: 세대정보 + 세대주 육안점검결과
  const infoSheet = workbook.addWorksheet(OWNER_VISUAL_SHEET, {
    headerFooter: { firstHeader: OWNER_VISUAL_SHEET }
  });
  infoSheet.addRow(['아파트명', safeVal(household.complexName)]);
  infoSheet.addRow(['동호수', safeVal(household.dongHo || [dong, ho].filter(Boolean).join('-'))]);
  infoSheet.addRow(['입주자 성함', safeVal(household.residentName)]);
  infoSheet.addRow([]);

  const ownerHeaderRow = infoSheet.addRow(OWNER_VISUAL_HEADERS);
  ownerHeaderRow.font = { bold: true };
  ownerVisual.forEach((item, idx) => {
    const rowIndex = idx + 1;
    const tags = collectPhotoTags(OWNER_VISUAL_SHEET, item, rowIndex, photoEntries);
    infoSheet.addRow([
      safeVal(item.location),
      safeVal(item.trade),
      safeVal(item.note),
      safeVal(item.result_text || item.result),
      tags.join(', ')
    ]);
  });
  OWNER_VISUAL_HEADERS.forEach((_, i) => {
    const col = infoSheet.getColumn(i + 1);
    col.width = Math.min(Math.max(OWNER_VISUAL_HEADERS[i].length + 2, i === 0 ? 14 : 12), 40);
  });
  if (infoSheet.getColumn(2).width < 36) infoSheet.getColumn(2).width = 36;

  // 시트별 데이터 정의: [시트명, 배열, 컬럼 정의]
  // 육안: 세대주 하자 + 점검원 육안점검
  const sheets = [
    ['육안', data.visual || [], (item, tags) => [
      safeVal(item.source || '점검원'),
      safeVal(item.location),
      safeVal(item.trade),
      safeVal(item.note),
      safeVal(item.result_text || item.result),
      tags.join(', ')
    ]],
    ['열화상', data.thermal || [], (item, tags) => [
      safeVal(item.location),
      safeVal(item.trade),
      safeVal(item.note),
      safeVal(item.result_text || item.result),
      tags.join(', ')
    ]],
    ['공기질', data.air || [], (item, tags) => [
      safeVal(item.location),
      safeVal(item.trade),
      safeVal(item.process_type_label || item.process_type),
      item.tvoc != null ? String(item.tvoc) : '',
      item.hcho != null ? String(item.hcho) : '',
      item.co2 != null ? String(item.co2) : '',
      safeVal(item.note),
      safeVal(item.result_text || item.result),
      tags.join(', ')
    ]],
    ['라돈', data.radon || [], (item, tags) => [
      safeVal(item.location),
      safeVal(item.trade),
      item.radon != null ? String(item.radon) : '',
      safeVal(item.unit),
      safeVal(item.note),
      safeVal(item.result_text || item.result),
      tags.join(', ')
    ]],
    ['레벨기', data.level || [], (item, tags) => [
      safeVal(item.location),
      safeVal(item.trade),
      safeVal(item.level_reference_mm ?? item.reference_mm),
      safeVal(item.level_summary_text || ''),
      safeVal(item.note),
      safeVal(item.result_text || item.result),
      tags.join(', ')
    ]]
  ];

  const headerBySheet = {
    육안: ['구분', '위치', '공종', '내용', '특이사항', '사진파일'],
    열화상: ['위치', '공종', '메모', '결과', '사진파일'],
    공기질: ['위치', '공종', '유형', 'TVOC', 'HCHO', 'CO2', '메모', '결과', '사진파일'],
    라돈: ['위치', '공종', '라돈값', '단위', '메모', '결과', '사진파일'],
    레벨기: ['위치', '공종', '기준(mm)', '4점 좌우값', '메모', '결과', '사진파일']
  };

  for (const [sheetName, items, rowFn] of sheets) {
    const worksheet = workbook.addWorksheet(sheetName, { headerFooter: { firstHeader: sheetName } });
    const headers = headerBySheet[sheetName] || [];
    worksheet.addRow(headers);
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };

    items.forEach((item, idx) => {
      const rowIndex = idx + 1;
      const tags = collectPhotoTags(sheetName, item, rowIndex, photoEntries);
      worksheet.addRow(rowFn(item, tags));
    });

    worksheet.columns.forEach((col, i) => {
      col.width = Math.min(Math.max(headers[i] ? headers[i].length + 2 : 12, 10), 40);
    });
  }

  const xlsxBuf = await workbook.xlsx.writeBuffer();
  zip.addFile(xlsxFilename, Buffer.from(xlsxBuf));

  for (const { zipPath, fileUrl } of photoEntries) {
    try {
      const buf = await loadImageBytes(fileUrl);
      if (buf && buf.length) zip.addFile(zipPath, buf);
    } catch (e) {
      // skip missing file
    }
  }

  return zip.toBuffer();
}

module.exports = { buildInspectionExportZip, TYPE_LABELS };
