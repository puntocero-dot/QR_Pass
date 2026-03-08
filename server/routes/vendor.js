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
router.post('/vouchers/create', async (req, res) => {
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

    const voucherValue = parseFloat(value);
    const purchaseId = uuidv4();
    const issueDate = new Date().toISOString();
    const expiryDate = new Date(Date.now() + expiry_days * 24 * 60 * 60 * 1000).toISOString();

    const createdVouchers = [];
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        
        for (let i = 0; i < qty; i++) {
            const id = uuidv4();
            const hashedCode = generateHashedCode();
            const qrPayload = generateQRPayload(id, hashedCode);

            await client.query(`
                INSERT INTO vouchers (id, original_purchase_id, hashed_code, initial_value, current_value,
                  issuing_company_id, issuing_company_name, client_id, issue_date, expiry_date, is_active, use_type)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11)
            `, [
                id, purchaseId, hashedCode, voucherValue, voucherValue,
                req.user.company_id || 'ADMIN',
                req.body.custom_company_name || req.user.company_name || 'Restaurantes Admin',
                client_id, issueDate, expiryDate, use_type
            ]);

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

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `${qty} vale(s) creado(s) exitosamente por $${voucherValue.toFixed(2)} c/u`,
            purchase_id: purchaseId,
            total_value: (voucherValue * qty).toFixed(2),
            vouchers: createdVouchers,
            created_by: {
                vendor_id: req.user.vendor_id || req.user.id,
                company_name: req.user.company_name || 'Admin'
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating vouchers:', err);
        res.status(500).json({ success: false, error: 'Error al crear vales' });
    } finally {
        client.release();
    }
});

/**
 * GET /api/vendor/vouchers
 * List all vouchers created by this vendor's company
 */
router.get('/vouchers', async (req, res) => {
    const db = getDB();
    const companyId = req.user.company_id || req.user.vendor_id;
    
    try {
        const { rows: vouchers } = await db.query(`
            SELECT v.id, v.initial_value, v.current_value, v.hashed_code, v.issue_date, v.expiry_date, v.is_active, v.use_type, v.original_purchase_id, v.client_id,
                   c.name as client_name
            FROM vouchers v
            LEFT JOIN clients c ON v.client_id = c.id
            WHERE v.issuing_company_id = $1
            ORDER BY v.issue_date DESC
            LIMIT 2000
        `, [companyId]);

        // Add QR payloads to each
        const enriched = vouchers.map(v => ({
            ...v,
            initial_value: parseFloat(v.initial_value),
            current_value: parseFloat(v.current_value),
            is_active: !!v.is_active,
            qr_payload: generateQRPayload(v.id, v.hashed_code),
            is_expired: new Date(v.expiry_date) < new Date(),
            remaining_pct: v.initial_value > 0 ? Math.round((v.current_value / v.initial_value) * 100) : 0
        }));

        // Summary stats
        const stats = {
            total_vouchers: enriched.length,
            active: enriched.filter(v => v.is_active && new Date(v.expiry_date) > new Date()).length,
            expired: enriched.filter(v => new Date(v.expiry_date) < new Date()).length,
            total_initial_value: enriched.reduce((sum, v) => sum + v.initial_value, 0),
            total_remaining_value: enriched.reduce((sum, v) => sum + v.current_value, 0),
            total_redeemed_value: enriched.reduce((sum, v) => sum + (v.initial_value - v.current_value), 0)
        };

        res.json({
            success: true,
            stats,
            vouchers: enriched
        });
    } catch (err) {
        console.error('Error fetching vendor vouchers:', err);
        res.status(500).json({ success: false, error: 'Error al obtener vales' });
    }
});

/**
 * GET /api/vendor/vouchers/:id
 * Get a single voucher detail with its QR payload and redemption history
 */
router.get('/vouchers/:id', async (req, res) => {
    const db = getDB();
    const companyId = req.user.company_id || req.user.vendor_id;
    
    try {
        const { rows } = await db.query('SELECT * FROM vouchers WHERE id = $1 AND issuing_company_id = $2', [req.params.id, companyId]);
        const voucher = rows[0];

        if (!voucher) {
            return res.status(404).json({
                success: false,
                error: 'Vale no encontrado'
            });
        }

        const { rows: history } = await db.query(
            'SELECT * FROM redemption_logs WHERE voucher_id = $1 ORDER BY timestamp DESC',
            [voucher.id]
        );

        res.json({
            success: true,
            voucher: {
                ...voucher,
                initial_value: parseFloat(voucher.initial_value),
                current_value: parseFloat(voucher.current_value),
                is_active: !!voucher.is_active,
                qr_payload: generateQRPayload(voucher.id, voucher.hashed_code)
            },
            history
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error al obtener detalle' });
    }
});

/**
 * POST /api/vendor/vouchers/bulk
 * Create multiple vouchers from a list of recipients
 */
router.post('/vouchers/bulk', async (req, res) => {
    const { client_id, value, recipients, expiry_days, custom_company_name } = req.body;
    const db = getDB();

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ success: false, error: 'Lista de destinatarios inválida' });
    }

    const voucherValue = parseFloat(value);
    const issueDate = new Date().toISOString();
    const expiryDate = new Date(Date.now() + (parseInt(expiry_days) || 365) * 24 * 60 * 60 * 1000).toISOString();

    const results = [];
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        
        for (const item of recipients) {
            const id = uuidv4();
            const code = uuidv4().split('-')[0];
            const hashed = crypto.createHash('sha256').update(code).digest('hex');

            await client.query(`
                INSERT INTO vouchers (
                    id, hashed_code, initial_value, current_value, 
                    issuing_company_id, issuing_company_name, client_id, 
                    issue_date, expiry_date, recipient_name, recipient_contact, use_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Multiple')
            `, [
                id, hashed, voucherValue, voucherValue,
                req.user.company_id || 'ADMIN',
                custom_company_name || req.user.company_name || 'Restaurantes Admin',
                client_id,
                issueDate,
                expiryDate,
                item.name || '',
                item.contact || ''
            ]);

            results.push({
                index: results.length + 1,
                id,
                value: voucherValue,
                qr_payload: generateQRPayload(id, hashed),
                expiry_date: expiryDate,
                use_type: 'Multiple'
            });
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `${recipients.length} vales generados exitosamente`,
            vouchers: results
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk create error:', err);
        res.status(500).json({ success: false, error: 'Error al procesar carga masiva' });
    } finally {
        client.release();
    }
});

module.exports = router;
