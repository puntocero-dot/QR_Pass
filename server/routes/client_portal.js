const express = require('express');
const { getDB } = require('../db');
const { generateQRPayload } = require('../utils/crypto');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const bcrypt = require('bcryptjs');

const router = express.Router();

/**
 * POST /api/client-portal/login
 */
router.post('/login', async (req, res) => {
    const { identifier, password } = req.body;
    const db = getDB();

    if (!identifier || !password) {
        return res.status(400).json({ success: false, error: 'Identificador y contraseña requeridos' });
    }

    try {
        // Find by Tax ID or exact Name
        const { rows } = await db.query(`
            SELECT * FROM clients 
            WHERE (tax_id = $1 OR name = $2) 
            AND is_active = 1
        `, [identifier, identifier]);
        
        const client = rows[0];

        if (!client || !(await bcrypt.compare(password, client.password))) {
            return res.status(401).json({ success: false, error: 'Credenciales inválidas o cuenta inactiva' });
        }

        const token = jwt.sign({
            id: client.id,
            company_id: client.id,
            name: client.name,
            role: 'client'
        }, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            success: true,
            token,
            client: {
                id: client.id,
                company_id: client.id,
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
router.get('/portal', authenticateToken, authorizeRole('client'), async (req, res) => {
    const db = getDB();
    const companyId = req.user.company_id;

    if (!companyId) {
        return res.status(403).json({ success: false, error: 'Usuario no vinculado a una empresa' });
    }

    try {
        const { rows: clientRows } = await db.query('SELECT id, name, trade_name FROM clients WHERE id = $1', [companyId]);
        const client = clientRows[0];
        
        const { rows: vouchers } = await db.query('SELECT * FROM vouchers WHERE client_id = $1', [companyId]);

        const processedVouchers = vouchers.map(v => ({
            ...v,
            initial_value: parseFloat(v.initial_value),
            current_value: parseFloat(v.current_value),
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
router.post('/assign-bulk', authenticateToken, authorizeRole('client'), async (req, res) => {
    const db = getDB();
    const { assignments } = req.body; 
    const companyId = req.user.company_id;

    if (!assignments || !Array.isArray(assignments)) {
        return res.status(400).json({ success: false, error: 'Datos de asignación inválidos' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        for (const item of assignments) {
            await client.query(`
                UPDATE vouchers 
                SET recipient_contact = $1, recipient_name = $2
                WHERE id = $3 AND client_id = $4
            `, [item.contact, item.contact, item.voucher_id, companyId]);
        }

        await client.query('COMMIT');
        res.json({ success: true, count: assignments.length });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

/**
 * POST /api/client-portal/assign
 */
router.post('/assign', authenticateToken, authorizeRole('client'), async (req, res) => {
    const { voucher_id, recipient_contact, recipient_name } = req.body;
    const db = getDB();
    const companyId = req.user.company_id;

    try {
        const result = await db.query(`
            UPDATE vouchers 
            SET recipient_name = $1, recipient_contact = $2 
            WHERE id = $3 AND client_id = $4
        `, [recipient_name || recipient_contact, recipient_contact, voucher_id, companyId]);

        if (result.rowCount > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'Vale no encontrado o no pertenece a la empresa' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
