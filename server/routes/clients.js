const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const crypto = require('crypto');

const router = express.Router();

// All client routes require auth + vendor role
router.use(authMiddleware);

function authorizeManagement(req, res, next) {
    if (req.user.role !== 'vendor' && req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            error: 'Acceso denegado — Solo personal autorizado',
            code: 'FORBIDDEN'
        });
    }
    next();
}

router.use(authorizeManagement);

/**
 * GET /api/clients
 * List all clients for this vendor's company
 */
router.get('/', async (req, res) => {
    const db = getDB();
    try {
        const { rows: clients } = await db.query(`
            SELECT c.*, 
              (SELECT COUNT(*) FROM vouchers WHERE client_id = c.id) as voucher_count,
              (SELECT COALESCE(SUM(initial_value), 0) FROM vouchers WHERE client_id = c.id) as total_value,
              (SELECT COALESCE(SUM(initial_value - current_value), 0) FROM vouchers WHERE client_id = c.id) as redeemed_value
            FROM clients c
            WHERE c.is_active = 1
            ORDER BY c.name ASC
        `);

        res.json({
            success: true,
            clients: clients.map(c => ({ 
                ...c, 
                is_active: !!c.is_active,
                total_value: parseFloat(c.total_value),
                redeemed_value: parseFloat(c.redeemed_value)
            }))
        });
    } catch (err) {
        console.error('Error fetching clients:', err);
        res.status(500).json({ success: false, error: 'Error al obtener clientes' });
    }
});

/**
 * POST /api/clients
 * Create a new client
 */
router.post('/', async (req, res) => {
    const { name, trade_name, tax_id, email, phone, address, contact_person, notes } = req.body;
    const db = getDB();

    if (!name || !name.trim()) {
        return res.status(400).json({
            success: false,
            error: 'El nombre del cliente es requerido',
            code: 'MISSING_NAME'
        });
    }

    const id = uuidv4();

    try {
        await db.query(`
            INSERT INTO clients (id, name, trade_name, tax_id, email, phone, address, contact_person, notes, access_token, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
            id,
            name.trim(),
            trade_name || '',
            tax_id || '',
            email || '',
            phone || '',
            address || '',
            contact_person || '',
            notes || '',
            crypto.randomBytes(16).toString('hex'),
            new Date().toISOString()
        ]);

        res.json({
            success: true,
            message: `Cliente "${name}" creado exitosamente`,
            client: { id, name: name.trim() }
        });
    } catch (err) {
        console.error('Error creating client:', err);
        res.status(500).json({ success: false, error: 'Error al crear cliente' });
    }
});

/**
 * PUT /api/clients/:id
 * Update a client
 */
router.put('/:id', async (req, res) => {
    const { name, trade_name, tax_id, email, phone, address, contact_person, notes } = req.body;
    const db = getDB();

    try {
        const { rows } = await db.query('SELECT id FROM clients WHERE id = $1', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'El nombre es requerido' });
        }

        await db.query(`
            UPDATE clients SET name=$1, trade_name=$2, tax_id=$3, email=$4, phone=$5, address=$6, contact_person=$7, notes=$8
            WHERE id=$9
        `, [
            name.trim(),
            trade_name || '',
            tax_id || '',
            email || '',
            phone || '',
            address || '',
            contact_person || '',
            notes || '',
            req.params.id
        ]);

        res.json({ success: true, message: 'Cliente actualizado' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error al actualizar' });
    }
});

router.delete('/:id', async (req, res) => {
    const db = getDB();

    try {
        const { rows } = await db.query('SELECT id FROM clients WHERE id = $1', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
        }

        await db.query('UPDATE clients SET is_active = 0 WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'Cliente eliminado' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error al eliminar' });
    }
});

/**
 * GET /api/clients/:id/vouchers
 * Detailed report of vouchers for a specific client
 */
router.get('/:id/vouchers', async (req, res) => {
    const db = getDB();
    const { generateQRPayload } = require('../utils/crypto');

    try {
        const { rows: vouchers } = await db.query(`
            SELECT * FROM vouchers 
            WHERE client_id = $1 
            ORDER BY issue_date DESC
        `, [req.params.id]);

        const enriched = vouchers.map(v => ({
            ...v,
            initial_value: parseFloat(v.initial_value),
            current_value: parseFloat(v.current_value),
            is_active: !!v.is_active,
            qr_payload: generateQRPayload(v.id, v.hashed_code),
            is_expired: new Date(v.expiry_date) < new Date()
        }));

        res.json({
            success: true,
            vouchers: enriched
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error al obtener vales' });
    }
});

module.exports = router;
