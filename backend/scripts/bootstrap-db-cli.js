require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const pool = require('../database');
const { bootstrapDatabase } = require('../utils/bootstrapDatabase');
const { ensureInspectorHousehold } = require('../utils/ensureInspectorHousehold');

(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('✅ DB 연결 성공');

    const bootstrap = await bootstrapDatabase(pool);
    console.log('bootstrap:', bootstrap);

    await ensureInspectorHousehold(pool);
    console.log('✅ 점검원 세대(admin/000/000) 확인 완료');
  } catch (error) {
    console.error('❌ bootstrap-db 실패:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
