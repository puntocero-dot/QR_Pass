const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(process.cwd(), 'data', 'restaurantes.db');
console.log('Using DB at:', dbPath);

const db = new Database(dbPath);
try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('--- TABLES ---');
    console.table(tables);

    if (tables.some(t => t.name === 'users')) {
        const users = db.prepare('SELECT username, role FROM users').all();
        console.log('--- USERS ---');
        console.table(users);
    }
    
    if (tables.some(t => t.name === 'vouchers')) {
        const vouchers = db.prepare('SELECT issuing_company_name, COUNT(*) as count FROM vouchers GROUP BY issuing_company_name').all();
        console.log('--- VOUCHERS ---');
        console.table(vouchers);
    }
} catch (e) {
    console.error(e);
}
