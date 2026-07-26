// Reports routes
const express = require('express');
const pool = require('../database');
const { authenticateToken } = require('../middleware/auth');
// PDF 생성기: pdfmake 사용 (한글 폰트 지원, 보고서는 PDF 전용)
const pdfGenerator = require('../utils/pdfmakeGenerator');
const finalReportGenerator = require('../utils/finalReportGenerator');
const { buildInspectionExportZip } = require('../utils/inspectionExport');
const { queryInspectionRows } = require('../utils/inspectionQuery');
const smsService = require('../utils/smsService');
const { decrypt } = require('../utils/encryption');
const fs = require('fs');
const path = require('path');

const { defectToVisualItem } = finalReportGenerator;

const router = express.Router();

// 점검원(admin complex)이면 요청의 household_id로 보고서 대상 세대 사용
async function getReportTargetHouseholdId(req) {
  const tokenHouseholdId = req.user?.householdId;
  const overrideId = req.query?.household_id || req.body?.household_id;
  if (!overrideId) return tokenHouseholdId;
  const r = await pool.query(
    `SELECT c.name FROM household h JOIN complex c ON h.complex_id = c.id WHERE h.id = $1`,
    [tokenHouseholdId]
  );
  const isInspector = r.rows[0] && (r.rows[0].name || '').toLowerCase() === 'admin';
  return isInspector ? parseInt(overrideId, 10) : tokenHouseholdId;
}

// Get report preview — 사용자(세대) 기준: 등록된 모든 하자 + 하자별 점검내용
router.get('/preview', authenticateToken, async (req, res) => {
  try {
    const householdId = await getReportTargetHouseholdId(req);
    const data = await loadHouseholdReportData(householdId);
    if (!data) {
      return res.status(404).json({ error: 'Household not found' });
    }

    const {
      complex,
      dong,
      ho,
      name,
      defects,
      total_defects: totalDefects,
      total_thermal: totalThermal,
      total_air: totalAir,
      total_radon: totalRadon,
      total_level: totalLevel,
      total_equipment: totalEquipment,
      has_equipment_data: hasEquipmentData
    } = data;

    // 전체 점검 요약용 플랫 리스트 (기존 템플릿 호환)
    const airMeasurements = [];
    const radonMeasurements = [];
    const levelMeasurements = [];
    const thermalInspections = [];
    defects.forEach((d) => {
      (d.inspections.air || []).forEach((x) => airMeasurements.push(x));
      (d.inspections.radon || []).forEach((x) => radonMeasurements.push(x));
      (d.inspections.level || []).forEach((x) => levelMeasurements.push(x));
      (d.inspections.thermal || []).forEach((x) => thermalInspections.push(x));
    });

    const latestCase = defects.length > 0 ? defects[0].case_id : null;
    const defectsWithIndex = defects.map((d, i) => ({ ...d, index: i + 1 }));
    const baseUrl = process.env.BACKEND_URL || (req.protocol + '://' + req.get('host')) || '';
    const html = generateComprehensiveReportHTML({
      complex,
      dong,
      ho,
      name,
      type: '종합점검',
      created_at: defects.length > 0 ? defects[0].case_created_at : new Date(),
      generated_at: new Date(),
      total_defects: totalDefects,
      total_thermal: totalThermal,
      total_air: totalAir,
      total_radon: totalRadon,
      total_level: totalLevel,
      total_equipment: totalEquipment,
      has_equipment_data: hasEquipmentData,
      defects: defectsWithIndex,
      air_measurements: airMeasurements,
      radon_measurements: radonMeasurements,
      level_measurements: levelMeasurements,
      thermal_inspections: thermalInspections,
      baseUrl: baseUrl.replace(/\/$/, '')
    });

    res.json({
      html,
      case_id: latestCase,
      defects_count: totalDefects,
      equipment_count: totalEquipment,
      defects: defects.map((d) => ({
        id: d.id,
        case_id: d.case_id,
        location: d.location,
        trade: d.trade,
        content: d.content,
        memo: d.memo,
        photos: d.photos,
        inspections: d.inspections
      })),
      equipment_data: {
        air: airMeasurements,
        radon: radonMeasurements,
        level: levelMeasurements,
        thermal: thermalInspections
      }
    });
  } catch (error) {
    console.error('Report preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate PDF report — 사용자(세대) 기준: 등록된 모든 하자 + 하자별 점검내용
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const { template = 'comprehensive-report' } = req.body;
    const householdId = await getReportTargetHouseholdId(req);

    const data = await loadHouseholdReportData(householdId);
    if (!data) {
      return res.status(404).json({ error: 'Household not found' });
    }

    const defectsWithIndex = data.defects.map((d, i) => ({
      ...d,
      index: i + 1,
      location: d.location || '',
      trade: d.trade || '',
      content: d.content || '',
      memo: d.memo || ''
    }));

    const airMeasurements = [];
    const radonMeasurements = [];
    const levelMeasurements = [];
    const thermalInspections = [];
    data.defects.forEach((d) => {
      (d.inspections.air || []).forEach((x) => airMeasurements.push(x));
      (d.inspections.radon || []).forEach((x) => radonMeasurements.push(x));
      (d.inspections.level || []).forEach((x) => levelMeasurements.push(x));
      (d.inspections.thermal || []).forEach((x) => thermalInspections.push(x));
    });

    let reportData = {
      complex: data.complex || '',
      dong: data.dong || '',
      ho: data.ho || '',
      name: data.name || '',
      phone: data.phone || '',
      type: '종합점검',
      created_at: data.defects.length > 0 ? data.defects[0].case_created_at : new Date(),
      generated_at: new Date().toISOString(),
      total_defects: data.total_defects,
      total_thermal: data.total_thermal,
      total_air: data.total_air,
      total_radon: data.total_radon,
      total_level: data.total_level,
      total_equipment: data.total_equipment,
      has_equipment_data: data.has_equipment_data,
      defects: defectsWithIndex,
      air_measurements: airMeasurements,
      radon_measurements: radonMeasurements,
      level_measurements: levelMeasurements,
      thermal_inspections: thermalInspections
    };

    if (template === 'final-report' || template === 'final-report-values') {
      const householdInsp = await loadHouseholdInspectionsForReport(householdId);
      reportData = {
        ...reportData,
        defects: defectsWithIndex,
        visual_inspections: householdInsp.visual,
        thermal_inspections: householdInsp.thermal,
        air_measurements: householdInsp.air,
        radon_measurements: householdInsp.radon,
        level_measurements: householdInsp.level
      };
      console.log(
        `[final-report] household=${householdId} defects=${reportData.defects.length} visual=${reportData.visual_inspections.length}`
      );
    }

    let pdfResult;
    if (template === 'final-report') {
      pdfResult = await finalReportGenerator.generateFinalReport(reportData, {});
    } else if (template === 'final-report-values') {
      pdfResult = await finalReportGenerator.generateFinalReportValues(reportData, {});
    } else if (template === 'summary-report') {
      const dong = reportData.dong || '';
      const ho = reportData.ho || '';
      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
      const filename = `수기보고서_${dong}-${ho}_${timestamp}.pdf`;
      pdfResult = await pdfGenerator.generateSummaryReportPDF(reportData, { filename });
    } else if (template === 'inspection-form') {
      const dong = reportData.dong || '';
      const ho = reportData.ho || '';
      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
      const filename = `점검결과양식_${dong}-${ho}_${timestamp}.pdf`;
      // 세대 단위(defect_id NULL)로 저장된 점검원 점검결과도 함께 출력하기 위해 로드
      const householdInsp = await loadHouseholdInspectionsForReport(householdId);
      reportData.household_inspections = householdInsp;
      pdfResult = await pdfGenerator.generateInspectionFormPDF(reportData, { filename });
    } else {
      const filename = `report-${householdId}-${Date.now()}.pdf`;
      pdfResult = await pdfGenerator.generatePDF('comprehensive-report', reportData, { filename });
    }

    const successMessage = template === 'final-report' ? '최종보고서가 생성되었습니다'
      : template === 'final-report-values' ? '최종보고서(수치중심)가 생성되었습니다'
      : template === 'summary-report' ? '수기보고서가 생성되었습니다'
      : template === 'inspection-form' ? '점검결과 양식이 생성되었습니다'
      : 'PDF generated successfully';

    // attachment=1 이면 JSON 대신 PDF 바이너리 반환 (동일 요청에서 파일 수신, 원격 다운로드 500 회피)
    if (req.query.attachment === '1') {
      const reportPath = pdfGenerator.getReportPath(pdfResult.filename);
      if (fs.existsSync(reportPath)) {
        const buf = fs.readFileSync(reportPath);
        const isPptx = pdfResult.filename.endsWith('.pptx');
        res.setHeader('Content-Type', isPptx
          ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          : 'application/pdf');
        res.setHeader('X-Report-Filename', pdfResult.filename);
        return res.send(buf);
      }
    }

    const jsonPayload = {
      success: true,
      message: successMessage,
      filename: pdfResult.filename,
      url: pdfResult.url,
      download_url: `/api/reports/download/${pdfResult.filename}`,
      size: pdfResult.size,
      case_id: data.defects.length > 0 ? data.defects[0].case_id : null
    };
    if (template === 'final-report' || template === 'final-report-values') {
      jsonPayload.household_defect_count = reportData.defects?.length ?? 0;
      jsonPayload.visual_inspection_count = reportData.visual_inspections?.length ?? 0;
    }
    res.json(jsonPayload);
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Report generation failed',
      message: error.message
    });
  }
});

// PowerPoint 보고서 생성 비활성화 — PDF만 지원 (범용적으로 열리도록)
// 보고서는 POST /reports/generate 로 PDF 생성 후 미리보기/다운로드 사용
router.post('/generate-pptx', authenticateToken, (req, res) => {
  res.status(410).json({
    success: false,
    error: 'PowerPoint report is deprecated',
    message: '보고서는 PDF만 지원합니다. POST /api/reports/generate 로 PDF를 생성해 주세요.',
    use_instead: 'POST /api/reports/generate'
  });
});

// Send report (with PDF generation) — 사용자(세대) 기준 동일
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { phone_number } = req.body;
    const householdId = await getReportTargetHouseholdId(req);

    const phoneResult = await pool.query(
      'SELECT resident_name_encrypted, phone, phone_encrypted FROM household WHERE id = $1',
      [householdId]
    );
    if (phoneResult.rows.length === 0) {
      return res.status(404).json({ error: 'Household not found' });
    }
    const userPhone = phoneResult.rows[0].phone_encrypted
      ? decrypt(phoneResult.rows[0].phone_encrypted)
      : phoneResult.rows[0].phone;
    const targetPhone = phone_number || userPhone;
    if (!targetPhone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const data = await loadHouseholdReportData(householdId);
    if (!data) {
      return res.status(404).json({ error: 'Household not found' });
    }

    const defectsWithIndex = data.defects.map((d, i) => ({
      ...d,
      index: i + 1,
      location: d.location || '',
      trade: d.trade || '',
      content: d.content || '',
      memo: d.memo || ''
    }));
    const airMeasurements = [];
    const radonMeasurements = [];
    const levelMeasurements = [];
    const thermalInspections = [];
    data.defects.forEach((d) => {
      (d.inspections.air || []).forEach((x) => airMeasurements.push(x));
      (d.inspections.radon || []).forEach((x) => radonMeasurements.push(x));
      (d.inspections.level || []).forEach((x) => levelMeasurements.push(x));
      (d.inspections.thermal || []).forEach((x) => thermalInspections.push(x));
    });
    const reportData = {
      complex: data.complex || '',
      dong: data.dong || '',
      ho: data.ho || '',
      name: data.name || '',
      type: '종합점검',
      created_at: data.defects.length > 0 ? data.defects[0].case_created_at : new Date(),
      generated_at: new Date().toISOString(),
      total_defects: data.total_defects,
      total_thermal: data.total_thermal,
      total_air: data.total_air,
      total_radon: data.total_radon,
      total_level: data.total_level,
      total_equipment: data.total_equipment,
      has_equipment_data: data.has_equipment_data,
      defects: defectsWithIndex,
      air_measurements: airMeasurements,
      radon_measurements: radonMeasurements,
      level_measurements: levelMeasurements,
      thermal_inspections: thermalInspections
    };

    const filename = `report-${householdId}-${Date.now()}.pdf`;
    const pdfResult = await pdfGenerator.generatePDF('comprehensive-report', reportData, { filename });

    const baseUrl = process.env.BACKEND_URL || 'https://insighti-app-new.onrender.com';
    const fullPdfUrl = `${baseUrl}${pdfResult.url}`;
    const caseInfo = {
      complex: data.complex,
      dong: data.dong,
      ho: data.ho,
      name: data.name,
      defectCount: data.total_defects
    };
    const smsResult = await smsService.sendReportNotification(targetPhone, fullPdfUrl, caseInfo);
    if (!smsResult.success && !smsResult.mock) {
      console.warn('SMS notification failed:', smsResult.error);
    }

    res.json({
      success: true,
      message: 'Report generated and sent successfully',
      filename: pdfResult.filename,
      pdf_url: pdfResult.url,
      download_url: `/api/reports/download/${pdfResult.filename}`,
      sent_to: targetPhone,
      size: pdfResult.size,
      sms_sent: smsResult.success,
      sms_mock: smsResult.mock || false,
      case_id: data.defects.length > 0 ? data.defects[0].case_id : null
    });
  } catch (error) {
    console.error('Send report error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send report',
      message: error.message
    });
  }
});

function isReportFilename(filename) {
  return typeof filename === 'string' && (filename.endsWith('.pdf') || filename.endsWith('.pptx'));
}

function getReportContentType(filename) {
  if (filename.endsWith('.pptx')) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  return 'application/pdf';
}

// Preview PDF report (browser view)
router.get('/preview-pdf/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params;

    // Validate filename to prevent directory traversal & PDF only
    if (!filename || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    if (!isReportFilename(filename)) {
      return res.status(400).json({ error: 'Only PDF or PPTX reports are supported. Use /reports/generate to create a report.' });
    }

    const reportPath = pdfGenerator.getReportPath(filename);
    
    // Check if file exists
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Set headers for browser preview (inline)
    res.setHeader('Content-Type', getReportContentType(filename));
    // 한글 파일명 대응: inline preview에서도 RFC5987 인코딩 사용
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    
    // Send file
    res.sendFile(path.resolve(reportPath));

  } catch (error) {
    console.error('PDF preview error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to preview PDF',
      message: error.message 
    });
  }
});

// Download PDF report
router.get('/download/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params;

    // Validate filename to prevent directory traversal & PDF only
    if (!filename || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    if (!isReportFilename(filename)) {
      return res.status(400).json({ error: 'Only PDF or PPTX reports are supported. Use /reports/generate to create a report.' });
    }

    const reportPath = pdfGenerator.getReportPath(filename);
    
    // Check if file exists
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Set headers for file download (한글 파일명: 버퍼 전송으로 sendFile 인코딩 이슈 방지)
    res.setHeader('Content-Type', getReportContentType(filename));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    const buf = fs.readFileSync(reportPath);
    res.send(buf);

  } catch (error) {
    console.error('PDF download error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to download PDF',
      message: error.message 
    });
  }
});

// 점검결과 내보내기 (엑셀 + 사진 ZIP, 점검구분별 폴더)
router.get('/inspection-export', authenticateToken, async (req, res) => {
  try {
    const householdId = await getReportTargetHouseholdId(req);
    if (!householdId) {
      return res.status(400).json({ error: '세대를 지정해 주세요.' });
    }

    const hResult = await pool.query(
      `SELECT h.dong, h.ho, h.resident_name, h.resident_name_encrypted, c.name AS complex_name
       FROM household h
       JOIN complex c ON h.complex_id = c.id
       WHERE h.id = $1`,
      [householdId]
    );
    const row = hResult.rows[0] || {};
    // 최초 로그인/등록 시 입력한 아파트명·동·호·성함 그대로 사용
    const complexName = row.complex_name != null ? String(row.complex_name).trim() : '';
    const dong = row.dong != null ? String(row.dong).trim() : '';
    const ho = row.ho != null ? String(row.ho).trim() : '';
    const dongHo = [dong, ho].filter(Boolean).join('-');
    const residentName = row.resident_name_encrypted
      ? decrypt(row.resident_name_encrypted)
      : (row.resident_name || '');

    const data = await loadHouseholdInspectionsForReport(householdId);
    // 1시트: 세대주 육안점검결과 / 육안 시트: 세대주+점검원 육안점검 (입력 시각 오름차순)
    const defectVisuals = await loadDefectsAsVisualForExport(householdId);
    data.ownerVisual = defectVisuals.slice().sort((a, b) => toTime(a.created_at) - toTime(b.created_at));
    data.visual = [
      ...defectVisuals,
      ...(data.visual || []).map((v) => ({ ...v, source: '점검원' }))
    ].sort((a, b) => toTime(a.created_at) - toTime(b.created_at));

    const baseName = sanitizeExportFilenamePart(
      ['점검결과', complexName, dongHo].filter(Boolean).join('_')
    ) || '점검결과';
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const fileBase = `${baseName}_${timestamp}`;
    const zipBuffer = await buildInspectionExportZip(data, dong, ho, {
      xlsxFilename: `${fileBase}.xlsx`,
      household: {
        complexName,
        dongHo,
        residentName: residentName != null ? String(residentName).trim() : ''
      }
    });

    const filename = `${fileBase}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('X-Filename', encodeURIComponent(filename));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="inspection-result.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(zipBuffer);
  } catch (error) {
    console.error('Inspection export error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export inspection data',
      message: error.message
    });
  }
});

// Helper function to get result text
function getResultText(result) {
  const resultMap = {
    'normal': '정상',
    'check': '확인요망',
    'na': '해당없음'
  };
  return resultMap[result] || result;
}

/** 다운로드 파일명에 쓸 수 없는 문자 제거 (아파트명·동호수는 입력값 유지) */
function sanitizeExportFilenamePart(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTime(v) {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** 세대주 등록 하자 → 엑셀 육안 시트용 항목 (입력 시각 오름차순) */
async function loadDefectsAsVisualForExport(householdId) {
  const defectsResult = await pool.query(
    `SELECT d.id, d.location, d.trade, d.content, d.memo, d.created_at
     FROM defect d
     JOIN case_header c ON d.case_id = c.id
     WHERE c.household_id = $1
     ORDER BY d.created_at ASC`,
    [householdId]
  );
  const defects = defectsResult.rows || [];
  for (const defect of defects) {
    const photoResult = await pool.query(
      'SELECT id, kind, url, thumb_url, taken_at FROM photo WHERE defect_id = $1 ORDER BY kind, taken_at',
      [defect.id]
    );
    defect.photos = photoResult.rows || [];
  }
  return defects.map((d) => ({
    ...defectToVisualItem(d),
    source: '세대주',
    result: d.memo || '',
    created_at: d.created_at
  }));
}

// 세대(household) 기준 점검결과만 조회 — 최종보고서용 (하자 무관, 타입별 N건)
async function loadHouseholdInspectionsForReport(householdId) {
  const result = await queryInspectionRows(pool, {
    whereClause: 'ii.case_id IN (SELECT id FROM case_header WHERE household_id = $1)',
    params: [householdId],
    orderBy: 'ii.created_at ASC',
  });
  const visual = [], thermal = [], air = [], radon = [], level = [];
  (result.rows || []).forEach((row) => {
    const base = {
      defect_id: row.defect_id,
      location: row.location,
      trade: row.trade,
      serial_no: row.serial_no,
      note: row.note,
      result: row.result,
      result_text: getResultText(row.result),
      created_at: row.created_at
    };
    switch (row.type) {
      case 'visual': {
        const vPhotos = (row.inspection_photos && Array.isArray(row.inspection_photos))
          ? row.inspection_photos
          : (row.inspection_photos ? [row.inspection_photos] : []);
        visual.push({ ...base, photos: vPhotos });
        break;
      }
      case 'thermal': {
        const tThermal = (row.thermal_photos && Array.isArray(row.thermal_photos))
          ? row.thermal_photos
          : (row.thermal_photos ? [row.thermal_photos] : []);
        const tInspection = (row.inspection_photos && Array.isArray(row.inspection_photos))
          ? row.inspection_photos
          : (row.inspection_photos ? [row.inspection_photos] : []);
        thermal.push({ ...base, photos: [...tInspection, ...tThermal] });
        break;
      }
      case 'air': {
        const aPhotos = (row.inspection_photos && Array.isArray(row.inspection_photos))
          ? row.inspection_photos
          : (row.inspection_photos ? [row.inspection_photos] : []);
        const processTypeLabel = row.process_type === 'flush_out' ? 'Flush-out' : row.process_type === 'bake_out' ? 'Bake-out' : '-';
        air.push({
          ...base,
          process_type: row.process_type,
          process_type_label: processTypeLabel,
          tvoc: row.tvoc,
          hcho: row.hcho,
          co2: row.co2,
          unit_tvoc: row.unit_tvoc,
          unit_hcho: row.unit_hcho,
          photos: aPhotos
        });
        break;
      }
      case 'radon': {
        const rPhotos = (row.inspection_photos && Array.isArray(row.inspection_photos))
          ? row.inspection_photos
          : (row.inspection_photos ? [row.inspection_photos] : []);
        radon.push({ ...base, radon: row.radon, unit: row.unit_radon, photos: rPhotos });
        break;
      }
      case 'level': {
        const refMm = row.reference_mm != null ? row.reference_mm : 150;
        const has4 = row.point1_left_mm != null || row.point1_right_mm != null || row.point2_left_mm != null || row.point2_right_mm != null || row.point3_left_mm != null || row.point3_right_mm != null || row.point4_left_mm != null || row.point4_right_mm != null;
        const lPhotos = (row.inspection_photos && Array.isArray(row.inspection_photos))
          ? row.inspection_photos
          : (row.inspection_photos ? [row.inspection_photos] : []);
        level.push({
          ...base,
          left_mm: row.left_mm,
          right_mm: row.right_mm,
          point1_left_mm: row.point1_left_mm,
          point1_right_mm: row.point1_right_mm,
          point2_left_mm: row.point2_left_mm,
          point2_right_mm: row.point2_right_mm,
          point3_left_mm: row.point3_left_mm,
          point3_right_mm: row.point3_right_mm,
          point4_left_mm: row.point4_left_mm,
          point4_right_mm: row.point4_right_mm,
          reference_mm: row.reference_mm,
          level_reference_mm: refMm,
          level_summary_text: has4
            ? `1번 좌${row.point1_left_mm ?? '-'}/우${row.point1_right_mm ?? '-'} 2번 좌${row.point2_left_mm ?? '-'}/우${row.point2_right_mm ?? '-'} 3번 좌${row.point3_left_mm ?? '-'}/우${row.point3_right_mm ?? '-'} 4번 좌${row.point4_left_mm ?? '-'}/우${row.point4_right_mm ?? '-'} (기준 ${refMm}mm)`
            : `좌 ${row.left_mm ?? '-'}mm / 우 ${row.right_mm ?? '-'}mm`,
          photos: lPhotos
        });
        break;
      }
      default:
        break;
    }
  });
  return { visual, thermal, air, radon, level };
}

// 사용자(세대) 기준 보고서 데이터: 해당 세대의 모든 하자 + 하자별 점검내용(inspection_item by defect_id)
async function loadHouseholdReportData(householdId) {
  const householdResult = await pool.query(
    `SELECT h.dong, h.ho, h.resident_name, h.resident_name_encrypted, h.phone, h.phone_encrypted, c.name as complex_name
     FROM household h JOIN complex c ON h.complex_id = c.id WHERE h.id = $1`,
    [householdId]
  );
  if (householdResult.rows.length === 0) return null;
  const household = householdResult.rows[0];
  const complex = household.complex_name || '';
  const dong = household.dong || '';
  const ho = household.ho || '';
  const name = household.resident_name_encrypted
    ? decrypt(household.resident_name_encrypted)
    : (household.resident_name || '');
  const phone = household.phone_encrypted
    ? decrypt(household.phone_encrypted)
    : (household.phone || '');

  const defectsResult = await pool.query(
    `SELECT d.id, d.case_id, d.location, d.trade, d.content, d.memo, d.created_at,
            c.type as case_type, c.created_at as case_created_at
     FROM defect d
     JOIN case_header c ON d.case_id = c.id
     WHERE c.household_id = $1
     ORDER BY c.created_at DESC, d.created_at DESC`,
    [householdId]
  );
  const defects = defectsResult.rows || [];

  let totalThermal = 0, totalAir = 0, totalRadon = 0, totalLevel = 0;

  for (const defect of defects) {
    const photoResult = await pool.query(
      'SELECT id, kind, url, thumb_url, taken_at FROM photo WHERE defect_id = $1 ORDER BY kind, taken_at',
      [defect.id]
    );
    defect.photos = photoResult.rows || [];

    const itemResult = await queryInspectionRows(pool, {
      whereClause: 'ii.defect_id = $1',
      params: [defect.id],
      orderBy: 'ii.created_at ASC',
    });
    const air = [], radon = [], level = [], thermal = [], visual = [];
    const itemPhotos = (item) => {
      const ip = (item.inspection_photos && Array.isArray(item.inspection_photos))
        ? item.inspection_photos
        : (item.inspection_photos ? [item.inspection_photos] : []);
      const tp = (item.thermal_photos && Array.isArray(item.thermal_photos))
        ? item.thermal_photos
        : (item.thermal_photos ? [item.thermal_photos] : []);
      return [...ip, ...tp];
    };
    (itemResult.rows || []).forEach((item) => {
      const base = {
        location: item.location,
        trade: item.trade,
        serial_no: item.serial_no,
        note: item.note,
        result: item.result,
        result_text: getResultText(item.result),
        created_at: item.created_at
      };
      switch (item.type) {
        case 'air': {
          const processTypeLabel = item.process_type === 'flush_out' ? 'Flush-out' : item.process_type === 'bake_out' ? 'Bake-out' : '-';
          air.push({
            ...base,
            process_type: item.process_type,
            process_type_label: processTypeLabel,
            tvoc: item.tvoc,
            hcho: item.hcho,
            co2: item.co2,
            unit_tvoc: item.unit_tvoc,
            unit_hcho: item.unit_hcho,
            photos: itemPhotos(item)
          });
          totalAir++;
          break;
        }
        case 'radon':
          radon.push({ ...base, radon: item.radon, unit: item.unit_radon, photos: itemPhotos(item) });
          totalRadon++;
          break;
        case 'level': {
          const refMm = item.reference_mm != null ? item.reference_mm : 150;
          const has4 = item.point1_left_mm != null || item.point1_right_mm != null || item.point2_left_mm != null || item.point2_right_mm != null || item.point3_left_mm != null || item.point3_right_mm != null || item.point4_left_mm != null || item.point4_right_mm != null;
          const p1 = has4 ? `${item.point1_left_mm ?? '-'}/${item.point1_right_mm ?? '-'}` : `${item.left_mm ?? '-'}/${item.right_mm ?? '-'}`;
          const p2 = has4 ? `${item.point2_left_mm ?? '-'}/${item.point2_right_mm ?? '-'}` : '-';
          const p3 = has4 ? `${item.point3_left_mm ?? '-'}/${item.point3_right_mm ?? '-'}` : '-';
          const p4 = has4 ? `${item.point4_left_mm ?? '-'}/${item.point4_right_mm ?? '-'}` : '-';
          const levelSummary = has4
            ? `1번 좌${item.point1_left_mm ?? '-'}/우${item.point1_right_mm ?? '-'} 2번 좌${item.point2_left_mm ?? '-'}/우${item.point2_right_mm ?? '-'} 3번 좌${item.point3_left_mm ?? '-'}/우${item.point3_right_mm ?? '-'} 4번 좌${item.point4_left_mm ?? '-'}/우${item.point4_right_mm ?? '-'} (기준 ${refMm}mm)`
            : `좌 ${item.left_mm ?? '-'}mm / 우 ${item.right_mm ?? '-'}mm`;
          level.push({
            ...base,
            left_mm: item.left_mm,
            right_mm: item.right_mm,
            point1_left_mm: item.point1_left_mm,
            point1_right_mm: item.point1_right_mm,
            point2_left_mm: item.point2_left_mm,
            point2_right_mm: item.point2_right_mm,
            point3_left_mm: item.point3_left_mm,
            point3_right_mm: item.point3_right_mm,
            point4_left_mm: item.point4_left_mm,
            point4_right_mm: item.point4_right_mm,
            reference_mm: item.reference_mm,
            level_reference_mm: refMm,
            level_p1_text: p1,
            level_p2_text: p2,
            level_p3_text: p3,
            level_p4_text: p4,
            level_summary_text: levelSummary,
            photos: itemPhotos(item)
          });
          totalLevel++;
          break;
        }
        case 'thermal':
          thermal.push({ ...base, photos: itemPhotos(item) });
          totalThermal++;
          break;
        case 'visual':
          visual.push({ ...base, photos: itemPhotos(item) });
          break;
      }
    });
    defect.inspections = { air, radon, level, thermal, visual };
  }

  const totalEquipment = totalThermal + totalAir + totalRadon + totalLevel;
  return {
    complex,
    dong,
    ho,
    name,
    phone,
    defects,
    total_defects: defects.length,
    total_thermal: totalThermal,
    total_air: totalAir,
    total_radon: totalRadon,
    total_level: totalLevel,
    total_equipment: totalEquipment,
    has_equipment_data: totalEquipment > 0
  };
}

// Comprehensive HTML report generator
function generateComprehensiveReportHTML(data) {
  const handlebars = require('handlebars');
  const fs = require('fs');
  const path = require('path');
  
  const templatePath = path.join(__dirname, '../templates/comprehensive-report.hbs');
  const templateSource = fs.readFileSync(templatePath, 'utf8');
  handlebars.registerHelper('eq', function (a, b, options) {
    return (a === b) ? options.fn(this) : options.inverse(this);
  });
  const template = handlebars.compile(templateSource);

  // Add formatDate helper
  const templateData = {
    ...data,
    formatDate: (date) => {
      if (!date) return '-';
      return new Date(date).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };
  
  return template(templateData);
}

// Simple HTML report generator (legacy)
function generateReportHTML(data) {
  const { complex, dong, ho, name, created_at, defects } = data;
  
  let defectsHtml = '';
  if (defects && defects.length > 0) {
    defectsHtml = defects.map((defect, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${defect.location}</td>
        <td>${defect.trade}</td>
        <td>${defect.content}</td>
        <td>${defect.memo || '-'}</td>
      </tr>
    `).join('');
  }

  return `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>세대 점검 종합보고서</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 24px; }
        h1 { font-size: 20px; color: #333; }
        h2 { font-size: 16px; margin-top: 24px; color: #555; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
        th { background-color: #f5f5f5; font-weight: bold; }
        .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <h1>세대 점검 종합보고서</h1>
      <div class="meta">
        단지: ${complex} / 동-호: ${dong}-${ho} / 성명: ${name} / 생성일: ${created_at}
      </div>
      
      <h2>하자 목록</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>위치</th>
            <th>세부공정</th>
            <th>내용</th>
            <th>메모</th>
          </tr>
        </thead>
        <tbody>
          ${defectsHtml}
        </tbody>
      </table>
      
      <h2>비고</h2>
      <p>※ 본 문서는 앱 입력값을 기반으로 자동 생성된 보고서입니다.</p>
    </body>
    </html>
  `;
}

module.exports = router;
