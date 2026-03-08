const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data', 'restaurantes.db');
console.log('Inspecting DB at:', dbPath);

if (!fs.existsSync(dbPath)) {
    console.error('ERROR: DB file not found!');
    process.exit(1);
}

const db = new Database(dbPath);

try {
    const users = db.prepare("SELECT username, role, related_id, full_name FROM users").all();
    console.log('\n--- SYSTEM USERS ---');
    console.table(users);

    const voucherCount = db.prepare("SELECT COUNT(*) as count FROM vouchers").get().count;
    console.log(`\nTOTAL VOUCHERS IN DB: ${voucherCount}`);

    const voucherOwnership = db.prepare(`
        SELECT issuing_company_id, issuing_company_name, COUNT(*) as count 
        FROM vouchers 
        GROUP BY issuing_company_id, issuing_company_name
    `).all();
    console.log('\n--- VOUCHER OWNERSHIP DISTRIBUTION ---');
    console.table(voucherOwnership);

    const sampleVouchers = db.prepare("SELECT id, issuing_company_id, issuing_company_name, client_id, issue_date FROM vouchers LIMIT 10").all();
    console.log('\n--- SAMPLE VOUCHERS (LATEST 10) ---');
    console.table(sampleVouchers);

} catch (err) {
    console.error('Runtime error:', err);
}
