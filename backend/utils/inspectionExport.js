/**
 * 점검결과 내보내기: 엑셀(시트별 점검유형) + 사진(점검구분별 폴더) ZIP 생성
 */
const path = require('path');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const { loadImageBytes } = require('./photoPath');

const TYPE_LABELS = { visual: '육안', thermal: '열화상', air: '공기질', radon: '라돈', level: '레벨기' };

function safeVal(v) {
  if (v == null || v === '') return '';
  return String(v);
}

/**
 * @param {object} data - { visual, thermal, air, radon, level } from loadHouseholdInspectionsForReport
 * @param {string} dong - 동
 * @param {string} ho - 호
 * @param {object} [options]
 * @param {string} [options.xlsxFilename] - ZIP 내 엑셀 파일명 (기본: 점검내용.xlsx)
 * @returns {Promise<Buffer>} ZIP buffer
 */
async function buildInspectionExportZip(data, dong = '', ho = '', options = {}) {
  const zip = new AdmZip();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'InsightI';
  const xlsxFilename = options.xlsxFilename || '점검내용.xlsx';

  const photoEntries = []; // { zipPath, buffer }

  // 시트별 데이터 정의: [시트명, 배열, 컬럼 정의]
  // 육안: 최종보고서와 동일하게 세대주 하자 + 점검원 육안점검 (구분 컬럼으로 구분)
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
    육안: ['구분', '위치', '공종', '내용', '결과/특이사항', '사진꼬리표'],
    열화상: ['위치', '공종', '메모', '결과', '사진꼬리표'],
    공기질: ['위치', '공종', '유형', 'TVOC', 'HCHO', 'CO2', '메모', '결과', '사진꼬리표'],
    라돈: ['위치', '공종', '라돈값', '단위', '메모', '결과', '사진꼬리표'],
    레벨기: ['위치', '공종', '기준(mm)', '4점 좌우값', '메모', '결과', '사진꼬리표']
  };

  for (const [sheetName, items, rowFn] of sheets) {
    const worksheet = workbook.addWorksheet(sheetName, { headerFooter: { firstHeader: sheetName } });
    const headers = headerBySheet[sheetName] || [];
    worksheet.addRow(headers);
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };

    const typeKey = Object.keys(TYPE_LABELS).find((k) => TYPE_LABELS[k] === sheetName) || sheetName;

    items.forEach((item, idx) => {
      const rowIndex = idx + 1;
      const photos = item.photos || [];
      const tags = [];
      photos.forEach((p, pIdx) => {
        const ext = path.extname(p.file_url || p.url || '') || '.jpg';
        const tag = `${sheetName}_${rowIndex}_${pIdx + 1}${ext}`;
        tags.push(tag);
        const fileUrl = p.file_url || p.url;
        if (fileUrl) {
          photoEntries.push({ zipPath: `${sheetName}/${tag}`, fileUrl });
        }
      });
      const rowValues = rowFn(item, tags);
      worksheet.addRow(rowValues);
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
