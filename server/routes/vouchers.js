const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { verifyQRPayload } = require('../utils/crypto');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// All voucher routes require authentication
router.use(authMiddleware);

/**
 * POST /api/vouchers/validate
 */
router.post('/validate', (req, res) => {
    const { payload } = req.body;
    const db = getDB();

    const verification = verifyQRPayload(payload);
    if (!verification.valid) {
        return res.status(400).json({ success: false, error: verification.error });
    }

    const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ? AND hashed_code = ?')
        .get(verification.voucherId, verification.hashedCode);

    if (!voucher) return res.status(404).json({ success: false, error: 'Vale no encontrado' });
    if (!voucher.is_active) return res.status(400).json({ success: false, error: 'Vale inactivo' });
    if (new Date(voucher.expiry_date) < new Date()) return res.status(400).json({ success: false, error: 'Vale vencido' });

    res.json({ success: true, voucher: sanitizeVoucher(voucher) });
});

/**
 * POST /api/vouchers/redeem
 */
router.post('/redeem', (req, res) => {
    const { voucher_id, amount, invoice_number } = req.body;
    const db = getDB();

    try {
        const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(voucher_id);
        if (!voucher) return res.status(404).json({ success: false, error: 'Vale no encontrado' });
        if (voucher.current_value < amount) return res.status(400).json({ success: false, error: 'Saldo insuficiente' });

        const transaction = db.transaction(() => {
            const newBalance = Math.round((voucher.current_value - amount) * 100) / 100;
            db.prepare('UPDATE vouchers SET current_value = ? WHERE id = ?').run(newBalance, voucher_id);

            db.prepare(`
                INSERT INTO redemption_logs (id, voucher_id, timestamp, restaurant_id, cashier_id, amount_redeemed, invoice_number, action_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(uuidv4(), voucher_id, new Date().toISOString(), req.user.restaurant_id, req.user.cashier_id, amount, invoice_number || null, 'REDEMPTION');
        });

        transaction();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/vouchers/redemptions/me
 */
router.get('/redemptions/me', (req, res) => {
    const db = getDB();
    const cashierId = req.user.cashier_id;

    try {
        const redemptions = db.prepare(`
            SELECT r.*, v.issuing_company_name 
            FROM redemption_logs r
            JOIN vouchers v ON r.voucher_id = v.id
            WHERE r.cashier_id = ? 
            AND date(r.timestamp) = date('now', 'localtime')
            ORDER BY r.timestamp DESC
        `).all(cashierId);

        res.json({ success: true, redemptions });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

function sanitizeVoucher(v) {
    return {
        id: v.id,
        initial_value: v.initial_value,
        current_value: v.current_value,
        issuing_company_name: v.issuing_company_name,
        expiry_date: v.expiry_date
    };
}

module.exports = router;
