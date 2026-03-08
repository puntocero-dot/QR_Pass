const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { generateHashedCode, generateQRPayload } = require('../utils/crypto');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// All vendor routes require auth
router.use(authMiddleware);

// Vendor role check middleware
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
 * POST /api/vendor/vouchers/create
 * Body: { value, quantity, expiry_days, use_type }
 * Creates one or more vouchers and returns them with QR payloads
 */
router.post('/vouchers/create', (req, res) => {
    const { value, quantity = 1, expiry_days = 365, use_type = 'Multiple', client_id = '' } = req.body;
    const db = getDB();

    // Validation
    if (!value || parseFloat(value) <= 0) {
        return res.status(400).json({
            success: false,
            error: 'El valor del vale debe ser mayor a $0.00',
            code: 'INVALID_VALUE'
        });
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 1 || qty > 500) {
        return res.status(400).json({
            success: false,
            error: 'Cantidad debe ser entre 1 y 500',
            code: 'INVALID_QUANTITY'
        });
    }

    if (!['Single', 'Multiple'].includes(use_type)) {
        return res.status(400).json({
            success: false,
            error: 'Tipo de uso debe ser "Single" o "Multiple"',
            code: 'INVALID_USE_TYPE'
        });
    }

    const voucherValue = parseFloat(value);
    const purchaseId = uuidv4(); // Group all vouchers in this batch
    const issueDate = new Date().toISOString();
    const expiryDate = new Date(Date.now() + expiry_days * 24 * 60 * 60 * 1000).toISOString();

    const createdVouchers = [];

    const insertStmt = db.prepare(`
    INSERT INTO vouchers (id, original_purchase_id, hashed_code, initial_value, current_value,
      issuing_company_id, issuing_company_name, client_id, issue_date, expiry_date, is_active, use_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

    const transaction = db.transaction(() => {
        for (let i = 0; i < qty; i++) {
            const id = uuidv4();
            const hashedCode = generateHashedCode();
            const qrPayload = generateQRPayload(id, hashedCode);

            insertStmt.run(
                id,
                purchaseId,
                hashedCode,
                voucherValue,
                voucherValue,
                req.user.company_id,
                req.body.custom_company_name || req.user.company_name,
                client_id,
                issueDate,
                expiryDate,
                use_type
            );

            createdVouchers.push({
                id,
                hashed_code: hashedCode,
                qr_payload: qrPayload,
                value: voucherValue,
                expiry_date: expiryDate,
                use_type,
                index: i + 1
            });
        }
    });

    try {
        transaction();

        res.json({
            success: true,
            message: `${qty} vale(s) creado(s) exitosamente por $${voucherValue.toFixed(2)} c/u`,
            purchase_id: purchaseId,
            total_value: (voucherValue * qty).toFixed(2),
            vouchers: createdVouchers,
            created_by: {
                vendor_id: req.user.vendor_id,
                company_name: req.user.company_name
            }
        });
    } catch (err) {
        console.error('Error creating vouchers:', err);
        res.status(500).json({
            success: false,
            error: 'Error al crear vales',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * GET /api/vendor/vouchers
 * List all vouchers created by this vendor's company
 */
router.get('/vouchers', (req, res) => {
    const db = getDB();
    const vouchers = db.prepare(`
    SELECT v.id, v.initial_value, v.current_value, v.hashed_code, v.issue_date, v.expiry_date, v.is_active, v.use_type, v.original_purchase_id, v.client_id,
           c.name as client_name
    FROM vouchers v
    LEFT JOIN clients c ON v.client_id = c.id
    WHERE v.issuing_company_id = ?
    ORDER BY v.issue_date DESC
    LIMIT 2000
  `).all(req.user.company_id);

    // Add QR payloads to each
    const enriched = vouchers.map(v => ({
        ...v,
        is_active: !!v.is_active,
        qr_payload: generateQRPayload(v.id, v.hashed_code),
        is_expired: new Date(v.expiry_date) < new Date(),
        remaining_pct: v.initial_value > 0 ? Math.round((v.current_value / v.initial_value) * 100) : 0
    }));

    // Summary stats
    const stats = {
        total_vouchers: vouchers.length,
        active: vouchers.filter(v => v.is_active && new Date(v.expiry_date) > new Date()).length,
        expired: vouchers.filter(v => new Date(v.expiry_date) < new Date()).length,
        total_initial_value: vouchers.reduce((sum, v) => sum + v.initial_value, 0),
        total_remaining_value: vouchers.reduce((sum, v) => sum + v.current_value, 0),
        total_redeemed_value: vouchers.reduce((sum, v) => sum + (v.initial_value - v.current_value), 0)
    };

    res.json({
        success: true,
        stats,
        vouchers: enriched
    });
});

/**
 * GET /api/vendor/vouchers/:id
 * Get a single voucher detail with its QR payload and redemption history
 */
router.get('/vouchers/:id', (req, res) => {
    const db = getDB();
    const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ? AND issuing_company_id = ?')
        .get(req.params.id, req.user.company_id);

    if (!voucher) {
        return res.status(404).json({
            success: false,
            error: 'Vale no encontrado',
            code: 'NOT_FOUND'
        });
    }

    const history = db.prepare(
        'SELECT * FROM redemption_logs WHERE voucher_id = ? ORDER BY timestamp DESC'
    ).all(voucher.id);

    res.json({
        success: true,
        voucher: {
            ...voucher,
            is_active: !!voucher.is_active,
            qr_payload: generateQRPayload(voucher.id, voucher.hashed_code)
        },
        history
    });
});

/**
 * POST /api/vendor/vouchers/bulk
 * Create multiple vouchers from a list of recipients
 */
router.post('/vouchers/bulk', (req, res) => {
    const { client_id, value, recipients, expiry_days, custom_company_name } = req.body;
    const db = getDB();

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ success: false, error: 'Lista de destinatarios inválida' });
    }

    const voucherValue = parseFloat(value);
    const issueDate = new Date().toISOString();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + (parseInt(expiry_days) || 365));

    const results = [];

    try {
        const stmt = db.prepare(`
            INSERT INTO vouchers (
                id, hashed_code, initial_value, current_value, 
                issuing_company_id, issuing_company_name, client_id, 
                issue_date, expiry_date, recipient_name, recipient_contact, use_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // Transaction for better performance
        const runTransaction = db.transaction((list) => {
            for (const item of list) {
                const id = uuidv4();
                const code = uuidv4().split('-')[0];
                const hashed = crypto.createHash('sha256').update(code).digest('hex');

                stmt.run(
                    id, hashed, voucherValue, voucherValue,
                    req.user.company_id,
                    custom_company_name || req.user.company_name,
                    client_id,
                    issueDate,
                    expiryDate.toISOString(),
                    item.name || '',
                    item.contact || '',
                    'Multiple'
                );

                results.push({
                    index: results.length + 1,
                    id,
                    value: voucherValue,
                    qr_payload: generateQRPayload(id, hashed),
                    expiry_date: expiryDate.toISOString(),
                    use_type: 'Multiple'
                });
            }
        });

        runTransaction(recipients);

        res.json({
            success: true,
            message: `${recipients.length} vales generados exitosamente`,
            vouchers: results
        });

    } catch (err) {
        console.error('Bulk create error:', err);
        res.status(500).json({ success: false, error: 'Error al procesar carga masiva' });
    }
});

module.exports = router;
