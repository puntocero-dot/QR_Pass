const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { generateHashedCode, generateQRPayload } = require('./utils/crypto');

// Use DATABASE_URL from Railway or fallback for local dev
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/restaurantes';

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    console.log('🐘 Connecting to PostgreSQL...');
    
    // Create Clients table
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        trade_name TEXT DEFAULT '',
        tax_id TEXT DEFAULT '',
        email TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        address TEXT DEFAULT '',
        contact_person TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        access_token TEXT UNIQUE,
        password TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1
      );
    `);

    // Create Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        full_name TEXT DEFAULT '',
        related_id TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create Voucher table
    await client.query(`
      CREATE TABLE IF NOT EXISTS vouchers (
        id TEXT PRIMARY KEY,
        original_purchase_id TEXT NOT NULL,
        hashed_code TEXT UNIQUE NOT NULL,
        initial_value DECIMAL(10,2) NOT NULL,
        current_value DECIMAL(10,2) NOT NULL,
        issuing_company_id TEXT NOT NULL,
        issuing_company_name TEXT DEFAULT '',
        client_id TEXT DEFAULT '',
        issue_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        expiry_date TIMESTAMPTZ NOT NULL,
        recipient_name TEXT DEFAULT '',
        recipient_contact TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1,
        use_type TEXT DEFAULT 'Multiple'
      );
    `);

    // Create RedemptionLog table
    await client.query(`
      CREATE TABLE IF NOT EXISTS redemption_logs (
        id TEXT PRIMARY KEY,
        voucher_id TEXT NOT NULL,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        restaurant_id TEXT NOT NULL,
        cashier_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        amount_redeemed DECIMAL(10,2) DEFAULT 0,
        invoice_number TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        unique_nonce TEXT UNIQUE NOT NULL
      );
    `);

    // Create indexes (Postgres syntax)
    await client.query('CREATE INDEX IF NOT EXISTS idx_vouchers_hashed_code ON vouchers(hashed_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_vouchers_client_id ON vouchers(client_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');

    console.log('✅ PostgreSQL tables and indexes ready');
  } catch (err) {
    console.error('❌ Database initialization error:', err);
    throw err;
  } finally {
    client.release();
  }
}

function getDB() {
  return pool;
}

async function seedDemoData() {
  const db = getDB();
  const { rows } = await db.query('SELECT COUNT(*) FROM users');
  
  if (parseInt(rows[0].count) === 0) {
    console.log('🌱 Seeding initial demo data...');
    
    await db.query(`
      INSERT INTO users (id, username, password, role, full_name, related_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [uuidv4(), 'admin', process.env.ADMIN_PASS || 'admin2024', 'admin', 'Super Administrador', '']);
    
    await db.query(`
      INSERT INTO users (id, username, password, role, full_name, related_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [uuidv4(), 'vendedor', process.env.VENDOR_PASS || 'vendedor2024', 'vendor', 'Vendedor Demo', 'VEND-001']);

    console.log('✅ Demo users created');
  }
}

module.exports = { initDB, getDB, seedDemoData };
