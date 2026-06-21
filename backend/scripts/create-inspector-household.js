/**
 * 점검원 계정 세대(admin / 000 / 000)를 DB에 생성.
 * complex 'admin' 없으면 생성, household 없으면 생성, user_type='admin'.
 *
 * 사용:
 *   npm run create-inspector
 *     → 기본: 마이그레이션용 DB(insighti_db_yckk)에 생성
 *   DATABASE_URL="postgresql://..." npm run create-inspector
 *     → Render 앱 DB에 넣으려면 Render 대시보드 Environment의 DATABASE_URL 값을 넣고 실행.
 *     (Render DB는 보통 Render 내부에서만 접근 가능하므로, Render Shell에서 실행하거나
 *      대시보드에서 해당 서비스 → Shell → cd backend && npm run create-inspector)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const { Pool } = require('pg');
const { resolveDatabaseUrl, getPoolSslConfig } = require('../utils/databaseUrl');

const connectionString = resolveDatabaseUrl();
if (!connectionString) {
  console.error('❌ DATABASE_URL 또는 DB_HOST/DB_USER/DB_NAME 설정이 필요합니다.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: getPoolSslConfig(connectionString),
});

const INSPECTOR_COMPLEX = 'admin';
const INSPECTOR_DONG = '000';
const INSPECTOR_HO = '000';
const INSPECTOR_NAME = '점검원';
const INSPECTOR_PHONE = '010-0000-0000';

async function run() {
  const client = await pool.connect();
  try {
    let complexId;
    const complexRows = await client.query(
      "SELECT id FROM complex WHERE LOWER(TRIM(name)) = 'admin' LIMIT 1"
    );
    if (complexRows.rows.length === 0) {
      const ins = await client.query(
        "INSERT INTO complex (name, address) VALUES ($1, $2) RETURNING id",
        [INSPECTOR_COMPLEX, '점검원 전용']
      );
      complexId = ins.rows[0].id;
      console.log('✅ complex "admin" 생성됨, id:', complexId);
    } else {
      complexId = complexRows.rows[0].id;
      console.log('✅ complex "admin" 이미 존재, id:', complexId);
    }

    const hRows = await client.query(
      'SELECT id, user_type FROM household WHERE complex_id = $1 AND dong = $2 AND ho = $3',
      [complexId, INSPECTOR_DONG, INSPECTOR_HO]
    );
    if (hRows.rows.length === 0) {
      await client.query(
        `INSERT INTO household (complex_id, dong, ho, resident_name, phone, user_type)
         VALUES ($1, $2, $3, $4, $5, 'admin')`,
        [complexId, INSPECTOR_DONG, INSPECTOR_HO, INSPECTOR_NAME, INSPECTOR_PHONE]
      );
      const idResult = await client.query(
        'SELECT id FROM household WHERE complex_id = $1 AND dong = $2 AND ho = $3',
        [complexId, INSPECTOR_DONG, INSPECTOR_HO]
      );
      const householdId = idResult.rows[0].id;
      console.log('✅ 점검원 세대 생성됨, household id:', householdId);
      console.log('   로그인: 단지=admin, 동=000, 호=000, 이름=점검원, 전화=010-0000-0000');
    } else {
      const householdId = hRows.rows[0].id;
      const userType = hRows.rows[0].user_type;
      if (userType !== 'admin') {
        await client.query(
          "UPDATE household SET user_type = 'admin', resident_name = $1, phone = $2 WHERE id = $3",
          [INSPECTOR_NAME, INSPECTOR_PHONE, householdId]
        );
        console.log('✅ 기존 세대 user_type을 admin으로 변경, id:', householdId);
      } else {
        console.log('✅ 점검원 세대 이미 존재, id:', householdId);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
