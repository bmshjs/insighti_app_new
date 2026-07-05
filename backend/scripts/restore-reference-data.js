require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const pool = require('../database');
const { bootstrapDatabase } = require('../utils/bootstrapDatabase');
const { ensureInspectorHousehold } = require('../utils/ensureInspectorHousehold');
const { restoreReferenceData } = require('../utils/restoreReferenceData');

(async () => {
  const client = await pool.connect();
  try {
    await pool.query('SELECT 1');
    console.log('✅ DB 연결 성공');
    await bootstrapDatabase(pool);
    await ensureInspectorHousehold(pool);
    const summary = await restoreReferenceData(client);
    console.log('✅ 레퍼런스 데이터 복구 완료:', summary);
  } catch (error) {
    console.error('❌ 복구 실패:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
