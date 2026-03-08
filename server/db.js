const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { generateHashedCode, generateQRPayload } = require('./utils/crypto');

const fs = require('fs');

const DATA_DIR = fs.existsSync('/data') ? '/data' : (fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, '..', 'data'));
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'restaurantes.db');
console.log(`📦 Database path: ${DB_PATH}`);

let db;

function initDB() {
  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create Clients table
  db.exec(`
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
      password TEXT, -- For portal login
      created_at TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );
  `);

  // Create Users table for management
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'vendor', 'cashier')),
      full_name TEXT DEFAULT '',
      related_id TEXT DEFAULT '', -- restaurant_id or vendor_id
      created_at TEXT NOT NULL
    );
  `);

  // Create Voucher table
  db.exec(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id TEXT PRIMARY KEY,
      original_purchase_id TEXT NOT NULL,
      hashed_code TEXT UNIQUE NOT NULL,
      initial_value REAL NOT NULL,
      current_value REAL NOT NULL,
      issuing_company_id TEXT NOT NULL,
      issuing_company_name TEXT DEFAULT '',
      client_id TEXT DEFAULT '',
      issue_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      recipient_name TEXT DEFAULT '',
      recipient_contact TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      use_type TEXT DEFAULT 'Multiple' CHECK(use_type IN ('Single', 'Multiple'))
    );
  `);

  // Create RedemptionLog table
  db.exec(`
    CREATE TABLE IF NOT EXISTS redemption_logs (
      id TEXT PRIMARY KEY,
      voucher_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      restaurant_id TEXT NOT NULL,
      cashier_id TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK(action_type IN ('QUERY', 'FULL_REDEMPTION', 'PARTIAL_REDEMPTION')),
      amount_redeemed REAL DEFAULT 0,
      invoice_number TEXT DEFAULT '', -- New field for ticket/invoice
      notes TEXT DEFAULT '',
      unique_nonce TEXT UNIQUE NOT NULL
    );
  `);

  // Create indexes for fast reads
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vouchers_hashed_code ON vouchers(hashed_code);
    CREATE INDEX IF NOT EXISTS idx_vouchers_expiry_date ON vouchers(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_vouchers_client_id ON vouchers(client_id);
    CREATE INDEX IF NOT EXISTS idx_redemption_logs_voucher_id ON redemption_logs(voucher_id);
    CREATE INDEX IF NOT EXISTS idx_redemption_logs_timestamp ON redemption_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_redemption_logs_nonce ON redemption_logs(unique_nonce);
    CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
    CREATE INDEX IF NOT EXISTS idx_clients_tax_id ON clients(tax_id);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `);

  console.log('✅ Base de datos inicializada correctamente');

  // Run migrations for existing DBs
  runMigrations(db);

  return db;
}

function runMigrations(db) {
  // Add columns if they don't exist
  try {
    const cols = db.prepare("PRAGMA table_info(vouchers)").all();
    if (!cols.find(c => c.name === 'client_id')) {
      db.exec("ALTER TABLE vouchers ADD COLUMN client_id TEXT DEFAULT ''");
      console.log('✅ Migración: columna client_id agregada a vouchers');
    }
    if (!cols.find(c => c.name === 'recipient_name')) {
      db.exec("ALTER TABLE vouchers ADD COLUMN recipient_name TEXT DEFAULT ''");
      db.exec("ALTER TABLE vouchers ADD COLUMN recipient_contact TEXT DEFAULT ''");
      console.log('✅ Migración: campos de destinatario agregados a vouchers');
    }

    const redemptionCols = db.prepare("PRAGMA table_info(redemption_logs)").all();
    if (!redemptionCols.find(c => c.name === 'invoice_number')) {
      db.exec("ALTER TABLE redemption_logs ADD COLUMN invoice_number TEXT DEFAULT ''");
      console.log('✅ Migración: columna invoice_number agregada a redemption_logs');
    }
  } catch (e) { /* ignore */ }

  // Assign orphan vouchers to the main vendor ID to avoid 'missing' historical data
  try {
    db.prepare("UPDATE vouchers SET issuing_company_id = 'VEND-001' WHERE issuing_company_id = '' OR issuing_company_id IS NULL OR issuing_company_id = 'ADMIN'").run();
    console.log('✅ Migración: vales huérfanos asignados a VEND-001');
  } catch (e) { console.error('Orphan migration error:', e); }

  try {
    const clientCols = db.prepare("PRAGMA table_info(clients)").all();
    if (!clientCols.find(c => c.name === 'password')) {
      db.exec("ALTER TABLE clients ADD COLUMN password TEXT");
      console.log('✅ Migración: columna password agregada a clients');
    }
    if (!clientCols.find(c => c.name === 'access_token')) {
      db.exec("ALTER TABLE clients ADD COLUMN access_token TEXT UNIQUE");
      console.log('✅ Migración: columna access_token agregada a clients');
    }

    // Generate tokens and default passwords
    const crypto = require('crypto');
    const clientsToUpdate = db.prepare("SELECT id, tax_id FROM clients WHERE access_token IS NULL OR password IS NULL").all();
    if (clientsToUpdate.length > 0) {
      const updateStmt = db.prepare("UPDATE clients SET access_token = ?, password = ? WHERE id = ?");
      const migration = db.transaction((list) => {
        for (const c of list) {
          const token = crypto.randomBytes(16).toString('hex');
          const pass = c.tax_id || 'restaurantes2024';
          updateStmt.run(token, pass, c.id);
        }
      });
      migration(clientsToUpdate);
      console.log(`✅ Migración: ${clientsToUpdate.length} credenciales actualizadas para clientes`);
    }
  } catch (e) { console.error('Migration error:', e); }

  // Remove FK constraint from redemption_logs by recreating without it
  // (SQLite doesn't support dropping FKs, but our new CREATE skips the FK)
}

function getDB() {
  if (!db) {
    return initDB();
  }
  return db;
}

function seedDemoData() {
  const database = getDB();

  // Check if data already exists
  const count = database.prepare('SELECT COUNT(*) as c FROM vouchers').get();
  const userCount = database.prepare('SELECT COUNT(*) as c FROM users').get();

  if (userCount.c === 0) {
    const insertUser = database.prepare(`
      INSERT INTO users (id, username, password, role, full_name, related_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    // Initial demo users
    insertUser.run(uuidv4(), 'admin', process.env.ADMIN_PASS || 'admin2024', 'admin', 'Super Administrador', '', new Date().toISOString());
    insertUser.run(uuidv4(), 'cajero', process.env.CASHIER_PASS || 'restaurantes2024', 'cashier', 'Cajero Metrocentro', 'RESTAURANTE_METROCENTRO_SS', new Date().toISOString());
    insertUser.run(uuidv4(), 'vendedor', process.env.VENDOR_PASS || 'vendedor2024', 'vendor', 'Vendedor Demo', 'VEND-001', new Date().toISOString());
    
    console.log('✅ Usuarios iniciales creados');
  }

  if (count.c > 0) {
    console.log('ℹ️  Datos demo ya existen, omitiendo seed...');
    return;
  }

  const vouchers = [
    {
      id: uuidv4(),
      original_purchase_id: uuidv4(),
      hashed_code: generateHashedCode(),
      initial_value: 45.00,
      current_value: 45.00,
      issuing_company_id: 'VEND-001',
      issuing_company_name: 'Tigo El Salvador',
      issue_date: '2024-01-15T00:00:00Z',
      expiry_date: '2026-12-31T23:59:59Z',
      is_active: 1,
      use_type: 'Multiple'
    },
    {
      id: uuidv4(),
      original_purchase_id: uuidv4(),
      hashed_code: generateHashedCode(),
      initial_value: 25.00,
      current_value: 5.50,
      issuing_company_id: 'VEND-001',
      issuing_company_name: 'Claro El Salvador',
      issue_date: '2024-03-01T00:00:00Z',
      expiry_date: '2026-12-31T23:59:59Z',
      is_active: 1,
      use_type: 'Multiple'
    },
    {
      id: uuidv4(),
      original_purchase_id: uuidv4(),
      hashed_code: generateHashedCode(),
      initial_value: 15.00,
      current_value: 15.00,
      issuing_company_id: 'VEND-001',
      issuing_company_name: 'Digicel El Salvador',
      issue_date: '2023-06-01T00:00:00Z',
      expiry_date: '2024-06-01T23:59:59Z',
      is_active: 0,
      use_type: 'Single'
    }
  ];

  const insertStmt = database.prepare(`
    INSERT INTO vouchers (id, original_purchase_id, hashed_code, initial_value, current_value,
      issuing_company_id, issuing_company_name, issue_date, expiry_date, is_active, use_type)
    VALUES (@id, @original_purchase_id, @hashed_code, @initial_value, @current_value,
      @issuing_company_id, @issuing_company_name, @issue_date, @expiry_date, @is_active, @use_type)
  `);

  const insertMany = database.transaction((items) => {
    for (const item of items) {
      insertStmt.run(item);
    }
  });

  insertMany(vouchers);

  // Print QR codes for testing
  console.log(`\n🐔 ═══════════════════════════════════════════════════`);
  console.log(`   RESTAURANTES — Base de Datos Conectada`);
  console.log(`   ═══════════════════════════════════════════════════\n`);

  for (const v of vouchers) {
    const qrPayload = generateQRPayload(v.id, v.hashed_code);
    const status = v.is_active ? (new Date(v.expiry_date) > new Date() ? '✅ ACTIVO' : '❌ VENCIDO') : '❌ INACTIVO';
    console.log(`   Vale: ${v.issuing_company_name}`);
    console.log(`   Estado: ${status} | Saldo: $${v.current_value.toFixed(2)} / $${v.initial_value.toFixed(2)}`);
    console.log(`   QR: ${qrPayload}`);
    console.log('   ─────────────────────────────────────────────────\n');
  }

  console.log('✅ Datos demo insertados correctamente\n');
}

module.exports = { initDB, getDB, seedDemoData };
