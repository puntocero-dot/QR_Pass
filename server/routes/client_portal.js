const express = require('express');
const { getDB } = require('../db');
const { generateQRPayload } = require('../utils/crypto');

const router = express.Router();

/**
 * GET /api/client/portal
 * Fetch client info and vouchers using access_token
 */
router.get('/portal', (req, res) => {
    const token = req.query.token;
    if (!token) {
        return res.status(401).json({ success: false, error: 'Token requerido' });
    }

    const db = getDB();
    const client = db.prepare('SELECT * FROM clients WHERE access_token = ? AND is_active = 1').get(token);

    if (!client) {
        return res.status(404).json({ success: false, error: 'Acceso no válido o revocado' });
    }

    const vouchers = db.prepare(`
        SELECT * FROM vouchers 
        WHERE client_id = ? 
        ORDER BY issue_date DESC
    `).all(client.id);

    const enriched = vouchers.map(v => ({
        ...v,
        qr_payload: generateQRPayload(v.id, v.hashed_code),
        is_expired: new Date(v.expiry_date) < new Date()
    }));

    res.json({
        success: true,
        client: {
            name: client.name,
            trade_name: client.trade_name
        },
        vouchers: enriched
    });
});

/**
 * POST /api/client/assign
 * Optional: Mark a voucher as assigned to a name/contact
 */
router.post('/assign', (req, res) => {
    const { token, voucher_id, recipient_name, recipient_contact } = req.body;
    const db = getDB();

    const client = db.prepare('SELECT id FROM clients WHERE access_token = ?').get(token);
    if (!client) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const result = db.prepare(`
        UPDATE vouchers 
        SET recipient_name = ?, recipient_contact = ? 
        WHERE id = ? AND client_id = ?
    `).run(recipient_name, recipient_contact, voucher_id, client.id);

    if (result.changes > 0) {
        res.json({ success: true, message: 'Vale asignado correctamente' });
    } else {
        res.status(404).json({ success: false, error: 'Vale no encontrado' });
    }
});

module.exports = router;
