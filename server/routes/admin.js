const express = require('express');
const { getDB } = require('../db');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/admin/stats
 */
router.get('/stats', authenticateToken, authorizeRole('admin', 'vendor'), (req, res) => {
    const db = getDB();
    const isVendor = req.user.role === 'vendor';
    const companyId = req.user.company_id || req.user.vendor_id;

    try {
        let totalVouchers, totalRedeemed;
        
        if (isVendor) {
            totalVouchers = db.prepare('SELECT COUNT(*) as count FROM vouchers WHERE issuing_company_id = ?').get(companyId).count;
            totalRedeemed = db.prepare(`
                SELECT COUNT(*) as count 
                FROM redemption_logs rl
                JOIN vouchers v ON rl.voucher_id = v.id
                WHERE v.issuing_company_id = ?
            `).get(companyId).count;
        } else {
            totalVouchers = db.prepare('SELECT COUNT(*) as count FROM vouchers').get().count;
            totalRedeemed = db.prepare('SELECT COUNT(*) as count FROM redemption_logs').get().count;
        }

        const activeClients = db.prepare('SELECT COUNT(*) as count FROM clients WHERE is_active = 1').get().count;
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

        res.json({
            success: true,
            stats: {
                totalVouchers,
                totalRedeemed,
                activeClients,
                totalUsers
            }
        });
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/users
 */
router.get('/users', authenticateToken, authorizeRole('admin', 'vendor'), (req, res) => {
    const db = getDB();
    try {
        const users = db.prepare('SELECT id, username, role, full_name, related_id, created_at FROM users').all();
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/users
 * Create or Update user
 */
router.post('/users', authenticateToken, authorizeRole('admin', 'vendor'), (req, res) => {
    const db = getDB();
    const { id, username, password, role, full_name, related_id } = req.body;

    try {
        if (id) {
            // Update
            let query = 'UPDATE users SET username = ?, role = ?, full_name = ?, related_id = ?';
            const params = [username, role, full_name, related_id];
            
            if (password && password !== '********') {
                query += ', password = ?';
                params.push(password);
            }
            
            query += ' WHERE id = ?';
            params.push(id);
            
            db.prepare(query).run(...params);
        } else {
            // Create
            const stmt = db.prepare(`
                INSERT INTO users (id, username, password, role, full_name, related_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(uuidv4(), username, password, role, full_name, related_id, new Date().toISOString());
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/admin/users/:id
 */
router.delete('/users/:id', authenticateToken, authorizeRole('admin'), (req, res) => {
    const db = getDB();
    try {
        db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/vouchers
 */
router.get('/vouchers', authenticateToken, authorizeRole('admin'), (req, res) => {
    const db = getDB();
    const { generateQRPayload } = require('../utils/crypto');
    try {
        const vouchers = db.prepare(`
            SELECT v.*, c.name as client_name 
            FROM vouchers v 
            LEFT JOIN clients c ON v.client_id = c.id
            ORDER BY v.issue_date DESC
            LIMIT 1000
        `).all();
        
        const enriched = vouchers.map(v => ({
            ...v,
            qr_payload: generateQRPayload(v.id, v.hashed_code)
        }));
        
        res.json({ success: true, vouchers: enriched });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
