const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(process.cwd(), 'data', 'restaurantes.db');
console.log('Trying DB at:', dbPath);

if (!fs.existsSync(dbPath)) {
    console.error('DB NOT FOUND at', dbPath);
    process.exit(1);
}

const db = new Database(dbPath);
try {
    const users = db.prepare('SELECT id, username, role, related_id FROM users').all();
    console.log('--- USERS ---');
    console.table(users);
    
    const vouchers = db.prepare('SELECT id, issuing_company_id, issuing_company_name, client_id FROM vouchers LIMIT 10').all();
    console.log('--- VOUCHERS ---');
    console.table(vouchers);
} catch (e) {
    console.error(e);
}
