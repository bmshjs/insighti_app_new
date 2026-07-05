/**
 * init-db.sql 기준 레퍼런스(샘플) 데이터 idempotent 복구
 */
const bcrypt = require('bcryptjs');

async function countNonAdminHouseholds(client) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM household h
     JOIN complex c ON c.id = h.complex_id
     WHERE LOWER(TRIM(c.name)) <> 'admin'`
  );
  return result.rows[0].n;
}

async function restoreSampleCasesAndDefects(client) {
  const seoul = await client.query(
    `SELECT id FROM complex WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
    ['서울 인싸이트자이']
  );
  if (seoul.rows.length === 0) return;

  const seoulId = seoul.rows[0].id;
  const hh1 = await client.query(
    `SELECT h.id FROM household h
     WHERE h.complex_id = $1 AND h.dong = '101' AND h.ho = '1203'`,
    [seoulId]
  );
  const hh2 = await client.query(
    `SELECT h.id FROM household h
     WHERE h.complex_id = $1 AND h.dong = '102' AND h.ho = '1501'`,
    [seoulId]
  );
  const household1Id = hh1.rows[0]?.id;
  const household2Id = hh2.rows[0]?.id;

  if (household1Id) {
    await client.query(
      `INSERT INTO case_header (id, household_id, type) VALUES
        ('CASE-24001', $1, '하자접수')
       ON CONFLICT (id) DO UPDATE SET household_id = EXCLUDED.household_id, type = EXCLUDED.type`,
      [household1Id]
    );
    await client.query(
      `UPDATE case_header SET household_id = $1 WHERE id = 'CASE-24001'`,
      [household1Id]
    );
    const case1 = await client.query(
      `SELECT id FROM case_header WHERE household_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [household1Id]
    );
    const case1Id = case1.rows[0]?.id || 'CASE-24001';
    await client.query(`DELETE FROM photo WHERE defect_id IN ('DEF-1', 'DEF-2')`);
    await client.query(`DELETE FROM defect WHERE id IN ('DEF-1', 'DEF-2') OR case_id = $1`, [case1Id]);
    await client.query(
      `INSERT INTO defect (id, case_id, location, trade, content, memo) VALUES
        ('DEF-1', $1, '거실', '바닥재', '마루판 들뜸', '현장 확인 필요'),
        ('DEF-2', $1, '주방', '타일', '타일 균열', '')`,
      [case1Id]
    );
  }
  if (household2Id) {
    await client.query(
      `INSERT INTO case_header (id, household_id, type) VALUES
        ('CASE-24002', $1, '하자접수')
       ON CONFLICT (id) DO UPDATE SET household_id = EXCLUDED.household_id, type = EXCLUDED.type`,
      [household2Id]
    );
    await client.query(
      `UPDATE case_header SET household_id = $1 WHERE id = 'CASE-24002'`,
      [household2Id]
    );
    const case2 = await client.query(
      `SELECT id FROM case_header WHERE household_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [household2Id]
    );
    const case2Id = case2.rows[0]?.id || 'CASE-24002';
    await client.query(`DELETE FROM photo WHERE defect_id = 'DEF-3'`);
    await client.query(`DELETE FROM defect WHERE id = 'DEF-3' OR case_id = $1`, [case2Id]);
    await client.query(
      `INSERT INTO defect (id, case_id, location, trade, content, memo) VALUES
        ('DEF-3', $1, '욕실', '도장', '페인트 벗겨짐', '습기 문제 의심')`,
      [case2Id]
    );
  }
}

async function restoreReferenceData(client) {
  console.log('[restore] reference data seeding...');

  await client.query(`
    INSERT INTO complex (name, address) VALUES
      ('서울 인싸이트자이', '서울시 강남구 테헤란로 123'),
      ('부산 해운대 뷰', '부산시 해운대구 해운대로 456')
    ON CONFLICT (name) DO NOTHING
  `);

  const complexes = await client.query(
    `SELECT id, name FROM complex
     WHERE LOWER(TRIM(name)) IN (LOWER(TRIM($1)), LOWER(TRIM($2)))`,
    ['서울 인싸이트자이', '부산 해운대 뷰']
  );
  const byName = {};
  for (const row of complexes.rows) {
    const key = row.name && row.name.includes('인싸이트') ? '서울 인싸이트자이' : '부산 해운대 뷰';
    byName[key] = row.id;
  }
  const seoulId = byName['서울 인싸이트자이'];
  const busanId = byName['부산 해운대 뷰'];

  if (seoulId) {
    await client.query(
      `INSERT INTO household (complex_id, dong, ho, resident_name, phone, user_type) VALUES
        ($1, '101', '1203', '홍길동', '010-1234-5678', 'resident'),
        ($1, '102', '1501', '김철수', '010-2345-6789', 'resident')
       ON CONFLICT (complex_id, dong, ho) DO NOTHING`,
      [seoulId]
    );
  }
  if (busanId) {
    await client.query(
      `INSERT INTO household (complex_id, dong, ho, resident_name, phone, user_type) VALUES
        ($1, '201', '0802', '이영희', '010-3456-7890', 'resident')
       ON CONFLICT (complex_id, dong, ho) DO NOTHING`,
      [busanId]
    );
  }

  await restoreSampleCasesAndDefects(client);

  await client.query(`
    INSERT INTO defect_videos (defect_category_id, youtube_video_id, youtube_url, title, description, timestamp_start, timestamp_end, is_primary)
    SELECT dc.id, 'USQGTW34lO8', 'https://youtu.be/USQGTW34lO8', '벽지 보수 방법', '벽지 찢김 현상 확인 및 보수 방법', 0, 300, TRUE
    FROM defect_categories dc
    WHERE dc.name = '벽지찢김'
      AND NOT EXISTS (SELECT 1 FROM defect_videos dv WHERE dv.defect_category_id = dc.id)
  `);
  await client.query(`
    INSERT INTO defect_videos (defect_category_id, youtube_video_id, youtube_url, title, description, timestamp_start, timestamp_end, is_primary)
    SELECT dc.id, 'USQGTW34lO8', 'https://youtu.be/USQGTW34lO8', '벽균열 진단', '벽균열의 원인과 진단 방법', 300, 600, TRUE
    FROM defect_categories dc
    WHERE dc.name = '벽균열'
      AND NOT EXISTS (SELECT 1 FROM defect_videos dv WHERE dv.defect_category_id = dc.id)
  `);
  await client.query(`
    INSERT INTO defect_videos (defect_category_id, youtube_video_id, youtube_url, title, description, timestamp_start, timestamp_end, is_primary)
    SELECT dc.id, 'USQGTW34lO8', 'https://youtu.be/USQGTW34lO8', '마루판 보수', '마루판 들뜸 현상 및 보수 방법', 600, 900, TRUE
    FROM defect_categories dc
    WHERE dc.name = '마루판들뜸'
      AND NOT EXISTS (SELECT 1 FROM defect_videos dv WHERE dv.defect_category_id = dc.id)
  `);

  const adminExists = await client.query(
    `SELECT 1 FROM admin_user WHERE email = 'admin@insighti.com' LIMIT 1`
  );
  if (adminExists.rows.length === 0) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await client.query(
      `INSERT INTO admin_user (email, password_hash, name, role, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      ['admin@insighti.com', passwordHash, 'Super Admin', 'super_admin']
    );
    console.log('[restore] admin_user admin@insighti.com created');
  }

  const inspTable = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'inspector_registration' LIMIT 1`
  );
  if (inspTable.rows.length > 0 && seoulId) {
    const inspCount = await client.query('SELECT COUNT(*)::int AS n FROM inspector_registration');
    if (inspCount.rows[0].n === 0) {
      await client.query(
        `INSERT INTO inspector_registration (
           complex_id, dong, ho, inspector_name, phone, company_name,
           license_number, email, registration_reason, status
         ) VALUES
         ($1, '101', '1205', '김점검', '010-5555-5555', 'ABC 점검회사', '12345', 'kim@abc.com', '장비점검 업무를 위해 등록을 신청합니다.', 'pending'),
         ($1, '102', '1206', '이점검', '010-6666-6666', 'XYZ 점검회사', '67890', 'lee@xyz.com', '열화상 및 공기질 측정 업무를 위해 등록을 신청합니다.', 'pending')`,
        [seoulId]
      );
    }
  }

  const summary = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM complex) AS complexes,
      (SELECT COUNT(*)::int FROM household) AS households,
      (SELECT COUNT(*)::int FROM case_header) AS cases,
      (SELECT COUNT(*)::int FROM defect) AS defects,
      (SELECT COUNT(*)::int FROM defect_categories) AS defect_categories,
      (SELECT COUNT(*)::int FROM defect_videos) AS defect_videos,
      (SELECT COUNT(*)::int FROM admin_user) AS admins
  `);
  console.log('[restore] done:', summary.rows[0]);
  return summary.rows[0];
}

async function restoreReferenceDataIfEmpty(client) {
  const nonAdmin = await countNonAdminHouseholds(client);
  const caseCount = await client.query('SELECT COUNT(*)::int AS n FROM case_header');

  if (nonAdmin > 0 && caseCount.rows[0].n > 0) {
    console.log(`[restore] skip (${nonAdmin} households, ${caseCount.rows[0].n} cases exist)`);
    return { skipped: true, nonAdminHouseholds: nonAdmin, cases: caseCount.rows[0].n };
  }

  if (nonAdmin > 0 && caseCount.rows[0].n === 0) {
    console.log('[restore] households exist but no cases — restoring sample cases/defects');
    await restoreSampleCasesAndDefects(client);
    const summary = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM case_header) AS cases,
        (SELECT COUNT(*)::int FROM defect) AS defects
    `);
    return { skipped: false, partial: true, summary: summary.rows[0] };
  }

  const summary = await restoreReferenceData(client);
  return { skipped: false, summary };
}

module.exports = {
  restoreReferenceData,
  restoreReferenceDataIfEmpty,
  restoreSampleCasesAndDefects,
};
