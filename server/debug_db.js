const { getDB } = require('./db');
const db = getDB();
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
