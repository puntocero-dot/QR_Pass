const express = require('express');
const { getDB } = require('../db');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

const router = express.Router();

/**
 * GET /api/admin/stats
 */
router.get('/stats', authenticateToken, authorizeRole('admin', 'vendor'), async (req, res) => {
    const db = getDB();
    const isVendor = req.user.role === 'vendor';
    const companyId = req.user.company_id || req.user.vendor_id;

    try {
        let stats = {};
        
        if (isVendor) {
            const vRes = await db.query(`
                SELECT 
                    COUNT(*) as total_vouchers,
                    COUNT(*) FILTER (WHERE current_value > 0 AND expiry_date > NOW()) as active_vouchers,
                    SUM(initial_value) as total_value,
                    SUM(initial_value - current_value) as redeemed_value
                FROM vouchers 
                WHERE issuing_company_id = $1
            `, [companyId]);
            
            stats = {
                total_vouchers: parseInt(vRes.rows[0].total_vouchers || 0),
                active_vouchers: parseInt(vRes.rows[0].active_vouchers || 0),
                total_value: parseFloat(vRes.rows[0].total_value || 0),
                redeemed_value: parseFloat(vRes.rows[0].redeemed_value || 0)
            };

            const rRes = await db.query(`
                SELECT COUNT(*) as count 
                FROM redemption_logs rl
                JOIN vouchers v ON rl.voucher_id = v.id
                WHERE v.issuing_company_id = $1
            `, [companyId]);
            stats.total_redemptions = parseInt(rRes.rows[0].count || 0);
        } else {
            const vRes = await db.query(`
                SELECT 
                    COUNT(*) as total_vouchers,
                    COUNT(*) FILTER (WHERE current_value > 0 AND expiry_date > NOW()) as active_vouchers,
                    SUM(initial_value) as total_value,
                    SUM(initial_value - current_value) as redeemed_value
                FROM vouchers
            `);
            
            stats = {
                total_vouchers: parseInt(vRes.rows[0].total_vouchers || 0),
                active_vouchers: parseInt(vRes.rows[0].active_vouchers || 0),
                total_value: parseFloat(vRes.rows[0].total_value || 0),
                redeemed_value: parseFloat(vRes.rows[0].redeemed_value || 0)
            };
            
            const rRes = await db.query('SELECT COUNT(*) as count FROM redemption_logs');
            stats.total_redemptions = parseInt(rRes.rows[0].count || 0);
        }

        const cRes = await db.query('SELECT COUNT(*) as count FROM clients WHERE is_active = 1');
        stats.total_clients = parseInt(cRes.rows[0].count || 0);
        
        const uRes = await db.query('SELECT COUNT(*) as count FROM users');
        stats.total_users = parseInt(uRes.rows[0].count || 0);

        res.json({
            success: true,
            stats
        });
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/users
 */
router.get('/users', authenticateToken, authorizeRole('admin', 'vendor'), async (req, res) => {
    const db = getDB();
    try {
        const { rows } = await db.query('SELECT id, username, role, full_name, related_id, created_at FROM users');
        res.json({ success: true, users: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/users
 * Create or Update user
 */
router.post('/users', authenticateToken, authorizeRole('admin', 'vendor'), async (req, res) => {
    const db = getDB();
    const { id, username, password, role, full_name, related_id } = req.body;

    try {
        if (id) {
            // Update
            let query = 'UPDATE users SET username = $1, role = $2, full_name = $3, related_id = $4';
            const params = [username, role, full_name, related_id];
            
            if (password && password !== '********') {
                query += ', password = $' + (params.length + 1);
                const hashedPassword = await bcrypt.hash(password, 10);
                params.push(hashedPassword);
            }
            
            query += ' WHERE id = $' + (params.length + 1);
            params.push(id);
            
            await db.query(query, params);
        } else {
            // Create
            const hashedPassword = await bcrypt.hash(password, 10);
            await db.query(`
                INSERT INTO users (id, username, password, role, full_name, related_id, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [uuidv4(), username, hashedPassword, role, full_name, related_id, new Date().toISOString()]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/admin/users/:id
 */
router.delete('/users/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    const db = getDB();
    try {
        await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/vouchers
 */
router.get('/vouchers', authenticateToken, authorizeRole('admin'), async (req, res) => {
    const db = getDB();
    const { generateQRPayload } = require('../utils/crypto');
    try {
        const { rows } = await db.query(`
            SELECT v.*, c.name as client_name 
            FROM vouchers v 
            LEFT JOIN clients c ON v.client_id = c.id
            ORDER BY v.issue_date DESC
            LIMIT 1000
        `);
        
        const enriched = rows.map(v => ({
            ...v,
            qr_payload: generateQRPayload(v.id, v.hashed_code)
        }));
        
        res.json({ success: true, vouchers: enriched });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
