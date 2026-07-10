const pool = require('../database');
const { ensureInspectionSchema } = require('../utils/ensureInspectionSchema');

async function run() {
  try {
    const result = await ensureInspectionSchema(pool);
    console.log('ensureInspectionSchema:', result);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error('Failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
