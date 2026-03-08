const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(process.cwd(), 'data', 'restaurantes.db');
const db = new Database(dbPath);

try {
    console.log('--- VENDORS ---');
    const vendors = db.prepare("SELECT username, related_id, full_name FROM users WHERE role = 'vendor'").all();
    console.table(vendors);

    console.log('--- VOUCHERS SUMMARY ---');
    const vouchers = db.prepare(`
        SELECT issuing_company_id, issuing_company_name, COUNT(*) as count 
        FROM vouchers 
        GROUP BY issuing_company_id
    `).all();
    console.table(vouchers);

    console.log('--- LATEST 5 VOUCHERS ---');
    const latest = db.prepare("SELECT id, issuing_company_id, issuing_company_name, client_id, issue_date FROM vouchers ORDER BY id DESC LIMIT 5").all();
    console.table(latest);
} catch (e) {
    console.error(e);
}
