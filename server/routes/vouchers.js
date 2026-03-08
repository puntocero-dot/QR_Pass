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
router.post('/validate', async (req, res) => {
    const { payload } = req.body;
    const db = getDB();

    const verification = verifyQRPayload(payload);
    if (!verification.valid) {
        return res.status(400).json({ success: false, error: verification.error });
    }

    try {
        const { rows } = await db.query('SELECT * FROM vouchers WHERE id = $1 AND hashed_code = $2', [verification.voucherId, verification.hashedCode]);
        const voucher = rows[0];

        if (!voucher) return res.status(404).json({ success: false, error: 'Vale no encontrado' });
        if (!voucher.is_active) return res.status(400).json({ success: false, error: 'Vale inactivo' });
        if (new Date(voucher.expiry_date) < new Date()) return res.status(400).json({ success: false, error: 'Vale vencido' });

        res.json({ success: true, voucher: sanitizeVoucher(voucher) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/vouchers/redeem
 */
router.post('/redeem', async (req, res) => {
    const { voucher_id, amount, invoice_number } = req.body;
    const db = getDB();
    const client = await db.connect();

    try {
        const { rows } = await client.query('SELECT * FROM vouchers WHERE id = $1', [voucher_id]);
        const voucher = rows[0];
        
        if (!voucher) return res.status(404).json({ success: false, error: 'Vale no encontrado' });
        if (parseFloat(voucher.current_value) < amount) return res.status(400).json({ success: false, error: 'Saldo insuficiente' });

        await client.query('BEGIN');
        
        const newBalance = Math.round((parseFloat(voucher.current_value) - amount) * 100) / 100;
        await client.query('UPDATE vouchers SET current_value = $1 WHERE id = $2', [newBalance, voucher_id]);

        await client.query(`
            INSERT INTO redemption_logs (id, voucher_id, timestamp, restaurant_id, cashier_id, amount_redeemed, invoice_number, action_type, unique_nonce)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [uuidv4(), voucher_id, new Date().toISOString(), req.user.restaurant_id, req.user.cashier_id, amount, invoice_number || null, 'REDEMPTION', uuidv4()]);

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

/**
 * GET /api/vouchers/redemptions/me
 */
router.get('/redemptions/me', async (req, res) => {
    const db = getDB();
    const cashierId = req.user.cashier_id;

    try {
        const { rows } = await db.query(`
            SELECT r.*, v.issuing_company_name 
            FROM redemption_logs r
            JOIN vouchers v ON r.voucher_id = v.id
            WHERE r.cashier_id = $1 
            AND CAST(r.timestamp AS DATE) = CURRENT_DATE
            ORDER BY r.timestamp DESC
        `, [cashierId]);

        res.json({ success: true, redemptions: rows });
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
