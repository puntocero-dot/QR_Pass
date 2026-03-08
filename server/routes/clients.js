const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const crypto = require('crypto');

const router = express.Router();

// All client routes require auth + vendor role
router.use(authMiddleware);

function vendorOnly(req, res, next) {
    if (req.user.role !== 'vendor') {
        return res.status(403).json({
            success: false,
            error: 'Acceso denegado — Solo vendedores autorizados',
            code: 'FORBIDDEN'
        });
    }
    next();
}

router.use(vendorOnly);

/**
 * GET /api/clients
 * List all clients for this vendor's company
 */
router.get('/', (req, res) => {
    const db = getDB();
    const clients = db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM vouchers WHERE client_id = c.id) as voucher_count,
      (SELECT COALESCE(SUM(initial_value), 0) FROM vouchers WHERE client_id = c.id) as total_value,
      (SELECT COALESCE(SUM(initial_value - current_value), 0) FROM vouchers WHERE client_id = c.id) as redeemed_value
    FROM clients c
    WHERE c.is_active = 1
    ORDER BY c.name ASC
  `).all();

    res.json({
        success: true,
        clients: clients.map(c => ({ ...c, is_active: !!c.is_active }))
    });
});

/**
 * POST /api/clients
 * Create a new client
 */
router.post('/', (req, res) => {
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
        db.prepare(`
      INSERT INTO clients (id, name, trade_name, tax_id, email, phone, address, contact_person, notes, access_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            id,
            name.trim(),
            trade_name || '',
            tax_id || '',
            email || '',
            phone || '',
            address || '',
            contact_person || '',
            notes || '',
            crypto.randomBytes(16).toString('hex'), // Initial access_token
            new Date().toISOString()
        );

        res.json({
            success: true,
            message: `Cliente "${name}" creado exitosamente`,
            client: { id, name: name.trim() }
        });
    } catch (err) {
        console.error('Error creating client:', err);
        res.status(500).json({
            success: false,
            error: 'Error al crear cliente',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * PUT /api/clients/:id
 * Update a client
 */
router.put('/:id', (req, res) => {
    const { name, trade_name, tax_id, email, phone, address, contact_person, notes } = req.body;
    const db = getDB();

    const existing = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
    if (!existing) {
        return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: 'El nombre es requerido' });
    }

    try {
        db.prepare(`
      UPDATE clients SET name=?, trade_name=?, tax_id=?, email=?, phone=?, address=?, contact_person=?, notes=?
      WHERE id=?
    `).run(
            name.trim(),
            trade_name || '',
            tax_id || '',
            email || '',
            phone || '',
            address || '',
            contact_person || '',
            notes || '',
            req.params.id
        );

        res.json({ success: true, message: 'Cliente actualizado' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error al actualizar' });
    }
});

/**
 * DELETE /api/clients/:id
 * Soft-delete a client
 */
router.delete('/:id', (req, res) => {
    const db = getDB();

    const existing = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
    if (!existing) {
        return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    db.prepare('UPDATE clients SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Cliente eliminado' });
});

/**
 * GET /api/clients/:id/vouchers
 * Detailed report of vouchers for a specific client
 */
router.get('/:id/vouchers', (req, res) => {
    const db = getDB();
    const { generateQRPayload } = require('../utils/crypto');

    const vouchers = db.prepare(`
        SELECT * FROM vouchers 
        WHERE client_id = ? 
        ORDER BY issue_date DESC
    `).all(req.params.id);

    const enriched = vouchers.map(v => ({
        ...v,
        is_active: !!v.is_active,
        qr_payload: generateQRPayload(v.id, v.hashed_code),
        is_expired: new Date(v.expiry_date) < new Date()
    }));

    res.json({
        success: true,
        vouchers: enriched
    });
});

module.exports = router;
