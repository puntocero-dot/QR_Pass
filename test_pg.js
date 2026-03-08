const { Pool } = require('pg');

const connectionString = 'postgresql://postgres:OAINvQuQaAHSWyItBIzNbLdNTLTAtoaR@centerbeam.proxy.rlwy.net:56832/railway';

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function testConnection() {
  try {
    console.log('Testing connection to Railway PostgreSQL...');
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Connection successful! Server time:', res.rows[0].now);
    
    // Check tables
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Existing tables:', tables.rows.map(t => t.table_name));
    
    await pool.end();
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  }
}

testConnection();
