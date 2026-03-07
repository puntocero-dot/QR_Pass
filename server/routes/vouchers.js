const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { verifyQRPayload } = require('../utils/crypto');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// All voucher routes require authentication
router.use(authMiddleware);

/**
 * GET /api/vouchers/validate/:code
 * Validates a QR code: crypto check, DB lookup, expiry, balance
 */
router.get('/validate/:code', (req, res) => {
    const { code } = req.params;
    const db = getDB();

    // Step 1: Verify cryptographic signature
    const verification = verifyQRPayload(decodeURIComponent(code));
    if (!verification.valid) {
        // Log the failed attempt
        logAction(db, {
            voucher_id: 'UNKNOWN',
            restaurant_id: req.user.restaurant_id,
            cashier_id: req.user.cashier_id,
            action_type: 'QUERY',
            amount_redeemed: 0,
            notes: `Validación fallida: ${verification.error}`
        });

        return res.status(400).json({
            success: false,
            error: verification.error,
            code: 'INVALID_SIGNATURE',
            step: 'CRYPTO_VALIDATION'
        });
    }

    // Step 2: Database lookup
    const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ? AND hashed_code = ?')
        .get(verification.voucherId, verification.hashedCode);

    if (!voucher) {
        return res.status(404).json({
            success: false,
            error: 'Vale no encontrado en el sistema',
            code: 'VOUCHER_NOT_FOUND',
            step: 'DB_LOOKUP'
        });
    }

    // Step 3: Check expiry
    const now = new Date();
    const expiryDate = new Date(voucher.expiry_date);
    if (expiryDate < now) {
        return res.status(400).json({
            success: false,
            error: `Vale vencido el ${expiryDate.toLocaleDateString('es-SV')}`,
            code: 'VOUCHER_EXPIRED',
            step: 'EXPIRY_CHECK',
            voucher: sanitizeVoucher(voucher)
        });
    }

    // Step 4: Check active status
    if (!voucher.is_active) {
        return res.status(400).json({
            success: false,
            error: 'Vale desactivado — contacte al administrador',
            code: 'VOUCHER_INACTIVE',
            step: 'ACTIVE_CHECK',
            voucher: sanitizeVoucher(voucher)
        });
    }

    // Step 5: Check balance
    if (voucher.current_value <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Vale sin saldo disponible',
            code: 'NO_BALANCE',
            step: 'BALANCE_CHECK',
            voucher: sanitizeVoucher(voucher)
        });
    }

    // Log successful query
    logAction(db, {
        voucher_id: voucher.id,
        restaurant_id: req.user.restaurant_id,
        cashier_id: req.user.cashier_id,
        action_type: 'QUERY',
        amount_redeemed: 0,
        notes: 'Consulta exitosa'
    });

    // All validations passed
    res.json({
        success: true,
        voucher: sanitizeVoucher(voucher),
        message: 'Vale válido — Listo para canjear'
    });
});

/**
 * POST /api/vouchers/redeem
 * Body: { voucher_id, amount, nonce }
 * Processes a partial or full redemption
 */
router.post('/redeem', (req, res) => {
    const { voucher_id, amount, nonce } = req.body;
    const db = getDB();

    // Validate input
    if (!voucher_id || amount === undefined || amount === null || !nonce) {
        return res.status(400).json({
            success: false,
            error: 'Datos incompletos: voucher_id, amount y nonce son requeridos',
            code: 'MISSING_FIELDS'
        });
    }

    const redeemAmount = parseFloat(amount);
    if (isNaN(redeemAmount) || redeemAmount <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Monto inválido — debe ser mayor a $0.00',
            code: 'INVALID_AMOUNT'
        });
    }

    // Idempotency check — prevent duplicate processing
    const existingLog = db.prepare('SELECT id FROM redemption_logs WHERE unique_nonce = ?').get(nonce);
    if (existingLog) {
        return res.status(409).json({
            success: false,
            error: 'Esta transacción ya fue procesada (nonce duplicado)',
            code: 'DUPLICATE_NONCE'
        });
    }

    // Fetch voucher
    const voucher = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(voucher_id);
    if (!voucher) {
        return res.status(404).json({
            success: false,
            error: 'Vale no encontrado',
            code: 'VOUCHER_NOT_FOUND'
        });
    }

    // Re-validate expiry and status
    const now = new Date();
    if (new Date(voucher.expiry_date) < now) {
        return res.status(400).json({
            success: false,
            error: 'Vale vencido — no se puede canjear',
            code: 'VOUCHER_EXPIRED'
        });
    }

    if (!voucher.is_active) {
        return res.status(400).json({
            success: false,
            error: 'Vale desactivado',
            code: 'VOUCHER_INACTIVE'
        });
    }

    // Check sufficient balance
    if (redeemAmount > voucher.current_value) {
        return res.status(400).json({
            success: false,
            error: `Saldo insuficiente. Disponible: $${voucher.current_value.toFixed(2)}, Solicitado: $${redeemAmount.toFixed(2)}`,
            code: 'INSUFFICIENT_BALANCE',
            available: voucher.current_value
        });
    }

    // Atomic transaction: update balance + create log
    const transaction = db.transaction(() => {
        const newBalance = Math.round((voucher.current_value - redeemAmount) * 100) / 100;
        const actionType = newBalance === 0 ? 'FULL_REDEMPTION' : 'PARTIAL_REDEMPTION';

        // Update voucher balance
        db.prepare('UPDATE vouchers SET current_value = ? WHERE id = ?')
            .run(newBalance, voucher_id);

        // If use_type is Single and fully redeemed, deactivate
        if (voucher.use_type === 'Single' && newBalance === 0) {
            db.prepare('UPDATE vouchers SET is_active = 0 WHERE id = ?')
                .run(voucher_id);
        }

        // Create redemption log
        const logId = uuidv4();
        db.prepare(`
      INSERT INTO redemption_logs (id, voucher_id, timestamp, restaurant_id, cashier_id,
        action_type, amount_redeemed, notes, unique_nonce)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            logId,
            voucher_id,
            new Date().toISOString(),
            req.user.restaurant_id,
            req.user.cashier_id,
            actionType,
            redeemAmount,
            `Canje en ${req.user.restaurant_name || req.user.restaurant_id}`,
            nonce
        );

        return { newBalance, actionType, logId };
    });

    try {
        const result = transaction();

        res.json({
            success: true,
            message: result.actionType === 'FULL_REDEMPTION'
                ? '✅ Canje completo — Vale agotado'
                : `✅ Canje parcial — Nuevo saldo: $${result.newBalance.toFixed(2)}`,
            redemption: {
                log_id: result.logId,
                amount_redeemed: redeemAmount,
                new_balance: result.newBalance,
                action_type: result.actionType,
                restaurant_id: req.user.restaurant_id,
                cashier_id: req.user.cashier_id,
                timestamp: new Date().toISOString()
            }
        });
    } catch (err) {
        console.error('Error en canje:', err);
        res.status(500).json({
            success: false,
            error: 'Error interno al procesar el canje',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * GET /api/vouchers/:id/history
 * Returns redemption history for a voucher
 */
router.get('/:id/history', (req, res) => {
    const db = getDB();
    const logs = db.prepare(
        'SELECT * FROM redemption_logs WHERE voucher_id = ? ORDER BY timestamp DESC LIMIT 50'
    ).all(req.params.id);

    res.json({ success: true, history: logs });
});

// ── Helpers ──────────────────────────────────────────────

function sanitizeVoucher(v) {
    return {
        id: v.id,
        initial_value: v.initial_value,
        current_value: v.current_value,
        issuing_company_name: v.issuing_company_name,
        issue_date: v.issue_date,
        expiry_date: v.expiry_date,
        is_active: !!v.is_active,
        use_type: v.use_type
    };
}

function logAction(db, data) {
    try {
        db.prepare(`
      INSERT INTO redemption_logs (id, voucher_id, timestamp, restaurant_id, cashier_id,
        action_type, amount_redeemed, notes, unique_nonce)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            uuidv4(),
            data.voucher_id,
            new Date().toISOString(),
            data.restaurant_id,
            data.cashier_id,
            data.action_type,
            data.amount_redeemed,
            data.notes || '',
            uuidv4() // Auto-generate nonce for system logs
        );
    } catch (err) {
        console.error('Error logging action:', err.message);
    }
}

module.exports = router;
