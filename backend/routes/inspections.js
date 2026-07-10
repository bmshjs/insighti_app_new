// 장비점검 관련 API 라우트
const express = require('express');
const pool = require('../database');
const { authenticateToken, requireEquipmentAccess, requireInspectorAccess } = require('../middleware/auth');
const { queryInspectionRows, groupInspectionRows } = require('../utils/inspectionQuery');
const { ensureInspectionSchema } = require('../utils/ensureInspectionSchema');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

let inspectionSchemaReady = false;

async function ensureInspectionSchemaMiddleware(req, res, next) {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return next();
  }
  try {
    if (!inspectionSchemaReady) {
      const result = await ensureInspectionSchema(pool);
      inspectionSchemaReady = !!result.ok;
      if (!inspectionSchemaReady) {
        return res.status(503).json({
          error: '점검 스키마를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.',
        });
      }
    }
    next();
  } catch (error) {
    console.error('점검 스키마 보강 오류:', error);
    res.status(500).json({
      error: '서버 오류가 발생했습니다',
      message: error.message,
    });
  }
}

router.use(ensureInspectionSchemaMiddleware);

function inspectionError(res, error, label) {
  console.error(`${label}:`, error);
  res.status(500).json({ error: '서버 오류가 발생했습니다', message: error.message });
}

// 입력 검증 규칙
const ValidationRules = {
  air: {
    tvoc: { min: 0, max: 20, decimal: 2 },
    hcho: { min: 0, max: 20, decimal: 2 },
    co2: { min: 0, max: 10000, decimal: 0 }
  },
  radon: {
    radon: { min: 0, max: 5000, decimal: 2 }
  },
  level: {
    left_mm: { min: -50, max: 50, decimal: 1 },
    right_mm: { min: -50, max: 50, decimal: 1 },
    point_mm: { min: -10, max: 10, decimal: 1 },
    reference_mm: { min: 1, max: 999, decimal: 1 }
  }
};

// 입력값 검증 함수
function validateInput(value, rules) {
  if (value === null || value === undefined) return true; // 선택적 필드는 null 허용
  
  const num = parseFloat(value);
  if (isNaN(num)) return false;
  
  if (num < rules.min || num > rules.max) return false;
  
  // 소수점 자리수 검증
  const decimalPlaces = (value.toString().split('.')[1] || '').length;
  if (decimalPlaces > rules.decimal) return false;
  
  return true;
}

// 열화상 점검 항목 생성
router.post('/thermal', authenticateToken, requireInspectorAccess, async (req, res) => {
  try {
    const { caseId, defectId, location, trade, note, result = 'normal' } = req.body;
    
    if (!caseId || !location) {
      return res.status(400).json({ error: '케이스 ID와 위치는 필수입니다' });
    }
    
    const itemId = uuidv4();
    
    // 점검 항목 생성 (defect_id 포함)
    const query = `
      INSERT INTO inspection_item (id, case_id, defect_id, type, location, trade, note, result)
      VALUES ($1, $2, $3, 'thermal', $4, $5, $6, $7)
      RETURNING *
    `;
    
    const queryResult = await pool.query(query, [itemId, caseId, defectId || null, location, trade, note, result]);
    
    res.status(201).json({
      success: true,
      item: queryResult.rows[0],
      message: '열화상 점검 항목이 생성되었습니다'
    });
    
  } catch (error) {
    inspectionError(res, error, '열화상 점검 항목 생성 오류');
  }
});

// 육안점검 항목 생성 (점검원 점검의견) — defectId 선택(세대별 점검 시 생략)
router.post('/visual', authenticateToken, requireInspectorAccess, async (req, res) => {
  try {
    const { caseId, defectId, location, trade, note, result = 'normal' } = req.body;

    if (!caseId) {
      return res.status(400).json({ error: '케이스 ID는 필수입니다' });
    }

    const itemId = uuidv4();
    const loc = (location && String(location).trim()) || '육안';

    const query = `
      INSERT INTO inspection_item (id, case_id, defect_id, type, location, trade, note, result)
      VALUES ($1, $2, $3, 'visual', $4, $5, $6, $7)
      RETURNING *
    `;
    const queryResult = await pool.query(query, [itemId, caseId, defectId || null, loc, trade || null, note || null, result]);

    res.status(201).json({
      success: true,
      item: queryResult.rows[0],
      message: '육안점검 항목이 저장되었습니다'
    });
  } catch (error) {
    inspectionError(res, error, '육안점검 항목 생성 오류');
  }
});

// 열화상 사진 업로드 (기존 thermal_photo 테이블)
router.post('/thermal/:itemId/photos', authenticateToken, requireInspectorAccess, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { file_url, caption } = req.body;

    if (!file_url) {
      return res.status(400).json({ error: '파일 URL은 필수입니다' });
    }

    const photoId = uuidv4();

    const query = `
      INSERT INTO thermal_photo (id, item_id, file_url, caption)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    const result = await pool.query(query, [photoId, itemId, file_url, caption]);

    res.status(201).json({
      success: true,
      photo: result.rows[0],
      message: '열화상 사진이 업로드되었습니다'
    });
  } catch (error) {
    console.error('열화상 사진 업로드 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// 모든 점검(육안/열화상/공기질/라돈/레벨기) 항목에 이미지 추가 (최대 2개, sort_order 0 또는 1)
router.post('/items/:itemId/photos', authenticateToken, requireInspectorAccess, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { file_url, caption, sort_order = 0 } = req.body;

    if (!file_url) {
      return res.status(400).json({ error: '파일 URL은 필수입니다' });
    }

    const countResult = await pool.query(
      'SELECT COUNT(*) AS cnt FROM inspection_photo WHERE item_id = $1',
      [itemId]
    );
    const count = parseInt(countResult.rows[0]?.cnt || '0', 10);
    if (count >= 2) {
      return res.status(400).json({ error: '점검당 이미지는 최대 2개까지 저장할 수 있습니다' });
    }

    const photoId = uuidv4();
    const order = [0, 1].includes(parseInt(sort_order, 10)) ? parseInt(sort_order, 10) : count;

    await pool.query(
      `INSERT INTO inspection_photo (id, item_id, file_url, caption, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [photoId, itemId, file_url, caption || null, order]
    );

    const row = (await pool.query('SELECT * FROM inspection_photo WHERE id = $1', [photoId])).rows[0];
    res.status(201).json({
      success: true,
      photo: row,
      message: '점검 사진이 저장되었습니다'
    });
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(503).json({ error: 'inspection_photo 테이블이 없습니다. migrate-inspection-photos.sql 실행 후 다시 시도하세요.' });
    }
    console.error('점검 사진 추가 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// 점검 사진 삭제 (교체 시 기존 사진 제거용)
router.delete('/items/:itemId/photos/:photoId', authenticateToken, requireInspectorAccess, async (req, res) => {
  try {
    const { itemId, photoId } = req.params;
    const result = await pool.query(
      'DELETE FROM inspection_photo WHERE id = $1 AND item_id = $2 RETURNING id',
      [photoId, itemId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: '사진을 찾을 수 없습니다' });
    }
    res.json({ success: true, message: '사진이 삭제되었습니다' });
  } catch (error) {
    console.error('점검 사진 삭제 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// 공기질 측정 등록
router.post('/air', authenticateToken, requireInspectorAccess, async (req, res) => {
  try {
    const { caseId, defectId, location, trade, process_type, tvoc, hcho, co2, note, result = 'normal' } = req.body;
    
    if (!caseId || !location) {
      return res.status(400).json({ error: '케이스 ID와 위치는 필수입니다' });
    }
    
    if (process_type != null && process_type !== '' && !['flush_out', 'bake_out'].includes(process_type)) {
      return res.status(400).json({ error: '공정 유형은 flush_out 또는 bake_out 이어야 합니다' });
    }
    
    // 입력값 검증
    if (tvoc !== null && !validateInput(tvoc, ValidationRules.air.tvoc)) {
      return res.status(400).json({ error: 'TVOC 값이 유효하지 않습니다 (0-20, 소수점 2자리)' });
    }
    
    if (hcho !== null && !validateInput(hcho, ValidationRules.air.hcho)) {
      return res.status(400).json({ error: 'HCHO 값이 유효하지 않습니다 (0-20, 소수점 2자리)' });
    }
    
    if (co2 !== null && !validateInput(co2, ValidationRules.air.co2)) {
      return res.status(400).json({ error: 'CO2 값이 유효하지 않습니다 (0-10000)' });
    }
    
    const itemId = uuidv4();
    
    // 트랜잭션 시작
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // 점검 항목 생성 (defect_id 포함)
      const itemQuery = `
        INSERT INTO inspection_item (id, case_id, defect_id, type, location, trade, note, result)
        VALUES ($1, $2, $3, 'air', $4, $5, $6, $7)
        RETURNING *
      `;
      
      const itemResult = await client.query(itemQuery, [itemId, caseId, defectId || null, location, trade, note, result]);
      
      // 공기질 측정값 저장 (process_type: Flush-out / Bake-out)
      const measureQuery = `
        INSERT INTO air_measure (item_id, process_type, tvoc, hcho, co2)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      
      const measureResult = await client.query(measureQuery, [
        itemId,
        process_type && ['flush_out', 'bake_out'].includes(process_type) ? process_type : null,
        tvoc ? parseFloat(tvoc) : null,
        hcho ? parseFloat(hcho) : null,
        co2 ? parseFloat(co2) : null
      ]);
      
      await client.query('COMMIT');
      
      res.status(201).json({
        success: true,
        item: itemResult.rows[0],
        measure: measureResult.rows[0],
        message: '공기질 측정이 등록되었습니다'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    inspectionError(res, error, '공기질 측정 등록 오류');
  }
});

// 라돈 측정 등록
router.post('/radon', authenticateToken, requireInspectorAccess, async (req, res) => {
  try {
    const { caseId, defectId, location, trade, radon, unit_radon = 'Bq/m³', note, result = 'normal' } = req.body;
    
    if (!caseId || !location) {
      return res.status(400).json({ error: '케이스 ID와 위치는 필수입니다' });
    }
    
    if (!radon) {
      return res.status(400).json({ error: '라돈 측정값은 필수입니다' });
    }
    
    // 입력값 검증
    if (!validateInput(radon, ValidationRules.radon.radon)) {
      return res.status(400).json({ error: '라돈 값이 유효하지 않습니다 (0-5000, 소수점 2자리)' });
    }
    
    if (!['Bq/m³', 'pCi/L'].includes(unit_radon)) {
      return res.status(400).json({ error: '라돈 단위는 Bq/m³ 또는 pCi/L이어야 합니다' });
    }
    
    const itemId = uuidv4();
    
    // 트랜잭션 시작
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // 점검 항목 생성 (defect_id 포함)
      const itemQuery = `
        INSERT INTO inspection_item (id, case_id, defect_id, type, location, trade, note, result)
        VALUES ($1, $2, $3, 'radon', $4, $5, $6, $7)
        RETURNING *
      `;
      
      const itemResult = await client.query(itemQuery, [itemId, caseId, defectId || null, location, trade, note, result]);
      
      // 라돈 측정값 저장
      const measureQuery = `
        INSERT INTO radon_measure (item_id, radon, unit_radon)
        VALUES ($1, $2, $3)
        RETURNING *
      `;
      
      const measureResult = await client.query(measureQuery, [itemId, parseFloat(radon), unit_radon]);
      
      await client.query('COMMIT');
      
      res.status(201).json({
        success: true,
        item: itemResult.rows[0],
        measure: measureResult.rows[0],
        message: '라돈 측정이 등록되었습니다'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    inspectionError(res, error, '라돈 측정 등록 오류');
  }
});

// 레벨기 측정 등록 (4 point ±10mm, 기준 150mm)
router.post('/level', authenticateToken, requireInspectorAccess, async (req, res) => {
  try {
    const {
      caseId, defectId, location, trade, note, result = 'normal',
      left_mm, right_mm,
      point1_left_mm, point1_right_mm, point2_left_mm, point2_right_mm,
      point3_left_mm, point3_right_mm, point4_left_mm, point4_right_mm,
      reference_mm
    } = req.body;
    
    if (!caseId || !location) {
      return res.status(400).json({ error: '케이스 ID와 위치는 필수입니다' });
    }
    
    const pointRules = ValidationRules.level.point_mm;
    const refRules = ValidationRules.level.reference_mm;
    const points = [
      [point1_left_mm, point1_right_mm],
      [point2_left_mm, point2_right_mm],
      [point3_left_mm, point3_right_mm],
      [point4_left_mm, point4_right_mm]
    ];
    
    const has4Point = points.some(([l, r]) => l != null && l !== '' || r != null && r !== '');
    const hasLegacy = left_mm != null && left_mm !== '' && right_mm != null && right_mm !== '';
    
    if (!has4Point && !hasLegacy) {
      return res.status(400).json({ error: '4개 측정점(좌/우) 또는 기존 좌/우 수치를 입력해주세요' });
    }
    
    for (let i = 0; i < points.length; i++) {
      const [l, r] = points[i];
      if (l != null && l !== '' && !validateInput(l, pointRules)) {
        return res.status(400).json({ error: `${i + 1}번 좌측 수치가 유효하지 않습니다 (±10mm, 소수점 1자리)` });
      }
      if (r != null && r !== '' && !validateInput(r, pointRules)) {
        return res.status(400).json({ error: `${i + 1}번 우측 수치가 유효하지 않습니다 (±10mm, 소수점 1자리)` });
      }
    }
    
    if (reference_mm != null && reference_mm !== '' && !validateInput(reference_mm, refRules)) {
      return res.status(400).json({ error: '기준(mm) 값이 유효하지 않습니다 (1~999, 소수점 1자리)' });
    }
    
    if (hasLegacy && (left_mm == null || right_mm == null || !validateInput(left_mm, ValidationRules.level.left_mm) || !validateInput(right_mm, ValidationRules.level.right_mm))) {
      return res.status(400).json({ error: '기존 좌/우 수치는 -50~+50, 소수점 1자리여야 합니다' });
    }
    
    const itemId = uuidv4();
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const itemQuery = `
        INSERT INTO inspection_item (id, case_id, defect_id, type, location, trade, note, result)
        VALUES ($1, $2, $3, 'level', $4, $5, $6, $7)
        RETURNING *
      `;
      
      const itemResult = await client.query(itemQuery, [itemId, caseId, defectId || null, location, trade, note, result]);
      
      const parseOpt = (v) => (v != null && v !== '' ? parseFloat(v) : null);
      
      const measureQuery = `
        INSERT INTO level_measure (
          item_id, left_mm, right_mm,
          point1_left_mm, point1_right_mm, point2_left_mm, point2_right_mm,
          point3_left_mm, point3_right_mm, point4_left_mm, point4_right_mm,
          reference_mm
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `;
      
      const measureResult = await client.query(measureQuery, [
        itemId,
        hasLegacy ? parseFloat(left_mm) : (parseOpt(point1_left_mm) ?? null),
        hasLegacy ? parseFloat(right_mm) : (parseOpt(point1_right_mm) ?? null),
        parseOpt(point1_left_mm), parseOpt(point1_right_mm),
        parseOpt(point2_left_mm), parseOpt(point2_right_mm),
        parseOpt(point3_left_mm), parseOpt(point3_right_mm),
        parseOpt(point4_left_mm), parseOpt(point4_right_mm),
        reference_mm != null && reference_mm !== '' ? parseFloat(reference_mm) : 150
      ]);
      
      await client.query('COMMIT');
      
      res.status(201).json({
        success: true,
        item: itemResult.rows[0],
        measure: measureResult.rows[0],
        message: '레벨기 측정이 등록되었습니다'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    inspectionError(res, error, '레벨기 측정 등록 오류');
  }
});

// 세대(household)용 케이스 ID 조회 또는 생성 (점검결과 입력 시 케이스 없을 수 있음)
router.get('/case-for-household/:householdId', authenticateToken, requireInspectorAccess, async (req, res) => {
  try {
    const { householdId } = req.params;
    const hid = parseInt(householdId, 10);
    if (isNaN(hid)) {
      return res.status(400).json({ error: '유효한 세대 ID가 필요합니다' });
    }
    let row = (await pool.query(
      'SELECT id FROM case_header WHERE household_id = $1 ORDER BY created_at DESC LIMIT 1',
      [hid]
    )).rows[0];
    if (!row) {
      const caseId = `CASE-${Date.now().toString().slice(-9)}`;
      await pool.query(
        'INSERT INTO case_header (id, household_id, type, created_at) VALUES ($1, $2, $3, NOW())',
        [caseId, hid, '종합점검']
      );
      row = { id: caseId };
    }
    res.json({ success: true, caseId: row.id });
  } catch (error) {
    console.error('케이스 조회/생성 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// 세대(household)별 점검 항목 조회 — 타입별 N건 (하자 무관)
router.get('/by-household/:householdId', authenticateToken, async (req, res) => {
  try {
    const { householdId } = req.params;
    const hid = parseInt(householdId, 10);
    if (isNaN(hid)) {
      return res.status(400).json({ error: '유효한 세대 ID가 필요합니다' });
    }

    const result = await queryInspectionRows(pool, {
      whereClause: 'ii.case_id IN (SELECT id FROM case_header WHERE household_id = $1)',
      params: [hid],
      orderBy: 'ii.created_at ASC',
    });
    const grouped = groupInspectionRows(result.rows, { fixedTypes: true });

    res.json({
      success: true,
      householdId: hid,
      inspections: grouped,
      total: result.rows.length
    });
  } catch (error) {
    console.error('세대별 점검 항목 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다', message: error.message });
  }
});

// 세대(household)별 점검결과 전체 삭제
router.delete('/by-household/:householdId', authenticateToken, requireInspectorAccess, async (req, res) => {
  try {
    const { householdId } = req.params;
    const hid = parseInt(householdId, 10);
    if (isNaN(hid)) {
      return res.status(400).json({ error: '유효한 세대 ID가 필요합니다' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const caseIdsResult = await client.query(
        'SELECT id FROM case_header WHERE household_id = $1',
        [hid]
      );
      const caseIds = (caseIdsResult.rows || []).map((r) => r.id);
      if (caseIds.length === 0) {
        await client.query('ROLLBACK');
        return res.json({ success: true, deleted: 0, message: '삭제할 점검결과가 없습니다' });
      }

      const itemIdsResult = await client.query(
        'SELECT id FROM inspection_item WHERE case_id = ANY($1::text[])',
        [caseIds]
      );
      const itemIds = (itemIdsResult.rows || []).map((r) => r.id);

      if (itemIds.length === 0) {
        await client.query('ROLLBACK');
        return res.json({ success: true, deleted: 0, message: '삭제할 점검결과가 없습니다' });
      }

      await client.query('DELETE FROM air_measure WHERE item_id = ANY($1::text[])', [itemIds]);
      await client.query('DELETE FROM radon_measure WHERE item_id = ANY($1::text[])', [itemIds]);
      await client.query('DELETE FROM level_measure WHERE item_id = ANY($1::text[])', [itemIds]);
      await client.query('DELETE FROM thermal_photo WHERE item_id = ANY($1::text[])', [itemIds]);
      await client.query('DELETE FROM inspection_photo WHERE item_id = ANY($1::text[])', [itemIds]);
      const delResult = await client.query('DELETE FROM inspection_item WHERE case_id = ANY($1::text[]) RETURNING id', [caseIds]);

      await client.query('COMMIT');
      const deleted = delResult.rowCount || 0;
      res.json({
        success: true,
        deleted,
        message: `${deleted}건의 점검결과가 삭제되었습니다`
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('세대별 점검결과 삭제 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// 케이스별 점검 항목 조회
router.get('/:caseId', authenticateToken, async (req, res) => {
  try {
    const { caseId } = req.params;
    
    const result = await queryInspectionRows(pool, {
      whereClause: 'ii.case_id = $1',
      params: [caseId],
      orderBy: 'ii.created_at DESC',
    });
    const grouped = groupInspectionRows(result.rows);

    res.json({
      success: true,
      caseId: caseId,
      inspections: grouped,
      total: result.rows.length
    });
    
  } catch (error) {
    console.error('점검 항목 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다', message: error.message });
  }
});

// 하자별 점검 항목 조회
router.get('/defects/:defectId', authenticateToken, async (req, res) => {
  try {
    const { defectId } = req.params;
    
    const result = await queryInspectionRows(pool, {
      whereClause: 'ii.defect_id = $1',
      params: [defectId],
      orderBy: 'ii.created_at DESC',
    });
    const grouped = groupInspectionRows(result.rows);

    res.json({
      success: true,
      defectId: defectId,
      inspections: grouped,
      total: result.rows.length
    });
    
  } catch (error) {
    console.error('하자별 점검 항목 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다', message: error.message });
  }
});

// 점검 항목 수정 (공통: location, trade, note, result + 타입별 측정값)
router.put('/:itemId', authenticateToken, requireInspectorAccess, async (req, res) => {
  try {
    const { itemId } = req.params;
    const body = req.body || {};
    const { type, location, trade, note, result } = body;

    const exist = (await pool.query('SELECT id, type FROM inspection_item WHERE id = $1', [itemId])).rows[0];
    if (!exist) {
      return res.status(404).json({ error: '점검 항목을 찾을 수 없습니다' });
    }
    const itemType = type || exist.type;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updates = [];
      const vals = [];
      let p = 1;
      if (location !== undefined) { updates.push(`location = $${p++}`); vals.push(location); }
      if (trade !== undefined) { updates.push(`trade = $${p++}`); vals.push(trade); }
      if (note !== undefined) { updates.push(`note = $${p++}`); vals.push(note); }
      if (result !== undefined) { updates.push(`result = $${p++}`); vals.push(result); }
      if (updates.length) {
        vals.push(itemId);
        await client.query(`UPDATE inspection_item SET ${updates.join(', ')} WHERE id = $${p}`, vals);
      }

      if (itemType === 'air') {
        const { process_type, tvoc, hcho, co2 } = body;
        const upd = [];
        const vals = [];
        let p = 1;
        if (process_type !== undefined) { upd.push(`process_type = $${p++}`); vals.push(['flush_out', 'bake_out'].includes(process_type) ? process_type : null); }
        if (tvoc !== undefined) { upd.push(`tvoc = $${p++}`); vals.push(tvoc !== '' && tvoc != null ? parseFloat(tvoc) : null); }
        if (hcho !== undefined) { upd.push(`hcho = $${p++}`); vals.push(hcho !== '' && hcho != null ? parseFloat(hcho) : null); }
        if (co2 !== undefined) { upd.push(`co2 = $${p++}`); vals.push(co2 !== '' && co2 != null ? parseFloat(co2) : null); }
        if (upd.length) {
          vals.push(itemId);
          await client.query(`UPDATE air_measure SET ${upd.join(', ')} WHERE item_id = $${p}`, vals);
        }
      } else if (itemType === 'radon') {
        const { radon, unit_radon } = body;
        const upd = [];
        const vals = [];
        let p = 1;
        if (radon !== undefined) { upd.push(`radon = $${p++}`); vals.push(radon !== '' && radon != null ? parseFloat(radon) : null); }
        if (unit_radon !== undefined) { upd.push(`unit_radon = $${p++}`); vals.push(unit_radon); }
        if (upd.length) {
          vals.push(itemId);
          await client.query(`UPDATE radon_measure SET ${upd.join(', ')} WHERE item_id = $${p}`, vals);
        }
      } else if (itemType === 'level') {
        const {
          left_mm, right_mm,
          point1_left_mm, point1_right_mm, point2_left_mm, point2_right_mm,
          point3_left_mm, point3_right_mm, point4_left_mm, point4_right_mm,
          reference_mm
        } = body;
        const parseOpt = (v) => (v != null && v !== '' ? parseFloat(v) : null);
        const p1l = parseOpt(point1_left_mm); const p1r = parseOpt(point1_right_mm);
        const p2l = parseOpt(point2_left_mm); const p2r = parseOpt(point2_right_mm);
        const p3l = parseOpt(point3_left_mm); const p3r = parseOpt(point3_right_mm);
        const p4l = parseOpt(point4_left_mm); const p4r = parseOpt(point4_right_mm);
        const refMm = reference_mm != null && reference_mm !== '' ? parseFloat(reference_mm) : 150;
        const leftVal = left_mm != null && left_mm !== '' ? parseFloat(left_mm) : (p1l ?? null);
        const rightVal = right_mm != null && right_mm !== '' ? parseFloat(right_mm) : (p1r ?? null);
        await client.query(
          `UPDATE level_measure SET
            left_mm = COALESCE($2, left_mm), right_mm = COALESCE($3, right_mm),
            point1_left_mm = COALESCE($4, point1_left_mm), point1_right_mm = COALESCE($5, point1_right_mm),
            point2_left_mm = COALESCE($6, point2_left_mm), point2_right_mm = COALESCE($7, point2_right_mm),
            point3_left_mm = COALESCE($8, point3_left_mm), point3_right_mm = COALESCE($9, point3_right_mm),
            point4_left_mm = COALESCE($10, point4_left_mm), point4_right_mm = COALESCE($11, point4_right_mm),
            reference_mm = COALESCE($12, reference_mm)
           WHERE item_id = $1`,
          [itemId, leftVal, rightVal, p1l, p1r, p2l, p2r, p3l, p3r, p4l, p4r, refMm]
        );
      }

      await client.query('COMMIT');
      const updated = (await pool.query(
        'SELECT ii.*, am.process_type, am.tvoc, am.hcho, rm.radon, rm.unit_radon, lm.left_mm, lm.right_mm, lm.point1_left_mm, lm.point1_right_mm, lm.point2_left_mm, lm.point2_right_mm, lm.point3_left_mm, lm.point3_right_mm, lm.point4_left_mm, lm.point4_right_mm, lm.reference_mm FROM inspection_item ii LEFT JOIN air_measure am ON ii.id = am.item_id LEFT JOIN radon_measure rm ON ii.id = rm.item_id LEFT JOIN level_measure lm ON ii.id = lm.item_id WHERE ii.id = $1',
        [itemId]
      )).rows[0];
      res.json({ success: true, item: updated, message: '점검 항목이 수정되었습니다' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('점검 항목 수정 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// 점검 항목 삭제
router.delete('/:itemId', authenticateToken, async (req, res) => {
  try {
    const { itemId } = req.params;
    
    // 트랜잭션 시작
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // 관련 측정값 삭제
      await client.query('DELETE FROM air_measure WHERE item_id = $1', [itemId]);
      await client.query('DELETE FROM radon_measure WHERE item_id = $1', [itemId]);
      await client.query('DELETE FROM level_measure WHERE item_id = $1', [itemId]);
      await client.query('DELETE FROM thermal_photo WHERE item_id = $1', [itemId]);
      await client.query('DELETE FROM inspection_photo WHERE item_id = $1', [itemId]);
      
      // 점검 항목 삭제
      const result = await client.query('DELETE FROM inspection_item WHERE id = $1 RETURNING *', [itemId]);
      
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: '점검 항목을 찾을 수 없습니다' });
      }
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: '점검 항목이 삭제되었습니다'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('점검 항목 삭제 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

module.exports = router;
