// Simple PostgreSQL connection
const { Pool } = require('pg');
const config = require('./config');
const {
  resolveDatabaseUrl,
  getPoolSslConfig,
} = require('./utils/databaseUrl');

const connectionString = resolveDatabaseUrl();
let pool;

if (connectionString) {
  console.log('📊 Using DATABASE_URL for connection');
  pool = new Pool({
    connectionString,
    ssl: getPoolSslConfig(connectionString),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });
} else {
  console.log('📊 Using config file for connection');
  pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    ssl: false,
  });
}

async function verifyDatabaseConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1 AS ok');
  } finally {
    client.release();
  }
}

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('   DATABASE_URL 호스트가 dpg-xxx-a 형태만 있으면 .singapore-postgres.render.com 이 붙는지 확인하세요.');
  } else {
    console.log('✅ Database connected successfully');
    release();
  }
});

pool.on('connect', () => {
  console.log('✅ Database connected');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err.message);
});

module.exports = pool;
module.exports.verifyDatabaseConnection = verifyDatabaseConnection;
