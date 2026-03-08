const express = require('express');
const { getDB } = require('../db');
const { generateQRPayload } = require('../utils/crypto');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

const router = express.Router();

/**
 * POST /api/client-portal/login
 */
router.post('/login', (req, res) => {
    const { identifier, password } = req.body;
    const db = getDB();

    if (!identifier || !password) {
        return res.status(400).json({ success: false, error: 'Identificador y contraseña requeridos' });
    }

    try {
        // Find by Tax ID or exact Name
        const client = db.prepare(`
            SELECT * FROM clients 
            WHERE (tax_id = ? OR name = ?) 
            AND password = ? 
            AND is_active = 1
        `).get(identifier, identifier, password);

        if (!client) {
            return res.status(401).json({ success: false, error: 'Credenciales inválidas o cuenta inactiva' });
        }

        const token = jwt.sign({
            id: client.id,
            name: client.name,
            role: 'client'
        }, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            success: true,
            token,
            client: {
                id: client.id,
                name: client.name,
                tax_id: client.tax_id
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error del servidor' });
    }
});

/**
 * GET /api/client-portal/portal
 */
router.get('/portal', authenticateToken, authorizeRole('client'), (req, res) => {
    const db = getDB();
    const clientId = req.user.id;

    try {
        const client = db.prepare('SELECT id, name, trade_name FROM clients WHERE id = ?').get(clientId);
        const vouchers = db.prepare('SELECT * FROM vouchers WHERE issuing_company_id = ?').all(clientId);

        const processedVouchers = vouchers.map(v => ({
            ...v,
            qr_payload: generateQRPayload(v.id, v.hashed_code),
            is_expired: new Date(v.expiry_date) < new Date()
        }));

        res.json({
            success: true,
            client,
            vouchers: processedVouchers
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error al cargar datos' });
    }
});

/**
 * POST /api/client-portal/assign-bulk
 */
router.post('/assign-bulk', authenticateToken, authorizeRole('client'), (req, res) => {
    const db = getDB();
    const { assignments } = req.body; // Array of { voucher_id, contact }

    if (!assignments || !Array.isArray(assignments)) {
        return res.status(400).json({ success: false, error: 'Datos de asignación inválidos' });
    }

    try {
        const updateStmt = db.prepare(`
            UPDATE vouchers 
            SET recipient_contact = ?, recipient_name = ?
            WHERE id = ? AND issuing_company_id = ?
        `);

        const transaction = db.transaction((list) => {
            for (const item of list) {
                // Assuming recipient_name can also be the contact if only one is provided
                updateStmt.run(item.contact, item.contact, item.voucher_id, req.user.id);
            }
        });

        transaction(assignments);
        res.json({ success: true, count: assignments.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/client-portal/assign
 */
router.post('/assign', authenticateToken, authorizeRole('client'), (req, res) => {
    const { voucher_id, recipient_contact, recipient_name } = req.body;
    const db = getDB();

    try {
        const result = db.prepare(`
            UPDATE vouchers 
            SET recipient_name = ?, recipient_contact = ? 
            WHERE id = ? AND issuing_company_id = ?
        `).run(recipient_name || recipient_contact, recipient_contact, voucher_id, req.user.id);

        if (result.changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'Vale no encontrado o no pertenece a la empresa' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
