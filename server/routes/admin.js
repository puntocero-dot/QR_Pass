const express = require('express');
const { getDB } = require('../db');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/admin/stats
 */
router.get('/stats', authenticateToken, authorizeRole('admin'), (req, res) => {
    const db = getDB();
    try {
        const totalVouchers = db.prepare('SELECT COUNT(*) as count FROM vouchers').get().count;
        const totalRedeemed = db.prepare('SELECT COUNT(*) as count FROM redemption_logs').get().count;
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
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/users
 */
router.get('/users', authenticateToken, authorizeRole('admin'), (req, res) => {
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
router.post('/users', authenticateToken, authorizeRole('admin'), (req, res) => {
    const db = getDB();
    const { id, username, password, role, full_name, related_id } = req.body;

    try {
        if (id) {
            // Update
            const stmt = db.prepare(`
                UPDATE users 
                SET username = ?, password = ?, role = ?, full_name = ?, related_id = ?
                WHERE id = ?
            `);
            stmt.run(username, password, role, full_name, related_id, id);
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

module.exports = router;
