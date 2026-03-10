const express = require('express');
const { getDB } = require('../db');
const { generateQRPayload } = require('../utils/crypto');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy_fallback');

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

/**
 * POST /api/client-portal/send-email
 */
router.post('/send-email', authenticateToken, authorizeRole('client'), async (req, res) => {
    const db = getDB();
    const { voucher_id } = req.body;
    const companyId = req.user.company_id;

    try {
        const { rows } = await db.query('SELECT * FROM vouchers WHERE id = $1 AND client_id = $2', [voucher_id, companyId]);
        const voucher = rows[0];

        if (!voucher) return res.status(404).json({ success: false, error: 'Vale no encontrado o no pertenece a esta empresa' });
        
        let recipient_email = voucher.recipient_contact;
        if (!recipient_email || !recipient_email.includes('@')) {
            return res.status(400).json({ success: false, error: 'El contacto registrado no es un correo electrónico válido' });
        }

        if (!process.env.RESEND_API_KEY) {
            console.warn('RESEND_API_KEY no configurada. Simulando envío para desarrollo.');
            // Fallback for development if no key is provided
            return res.json({ success: true, dummy: true, message: 'Simulado (Falta API Key)' });
        }

        const publicLink = `https://${req.get('host')}/vale.html?id=${voucher.id}`;

        const htmlTemplate = `
        <div style="font-family: 'Inter', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; border-radius: 12px;">
            <div style="background-color: #1a1a25; padding: 40px; border-radius: 16px; text-align: center; color: white;">
                <h1 style="color: #FF3D00; margin-bottom: 5px;">¡Hola, ${voucher.recipient_name || 'Empleado'}!</h1>
                <p style="color: #aaa; margin-bottom: 30px;">Has recibido un vale de consumo de <strong>${voucher.issuing_company_name}</strong></p>
                
                <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin-bottom: 30px;">
                    <p style="text-transform: uppercase; font-size: 12px; color: #888; margin: 0 0 5px 0;">Saldo Disponible</p>
                    <h2 style="font-size: 40px; margin: 0; color: #4caf50;">$${parseFloat(voucher.current_value).toFixed(2)}</h2>
                </div>
                
                <a href="${publicLink}" style="display: inline-block; background: linear-gradient(135deg, #FF3D00, #D50000); color: white; padding: 15px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">ABRIR MI VALE Y VER QR</a>
                
                <p style="color: #666; font-size: 12px; margin-top: 30px;">Válido hasta: ${new Date(voucher.expiry_date).toLocaleDateString()}</p>
            </div>
        </div>
        `;

        const data = await resend.emails.send({
            from: 'QR Pass <onboarding@resend.dev>', // You can change this to your verified domain later
            to: [recipient_email],
            subject: `Tu vale de consumo de ${voucher.issuing_company_name} por $${parseFloat(voucher.initial_value).toFixed(2)}`,
            html: htmlTemplate
        });

        res.json({ success: true, data });
    } catch (err) {
        console.error('Error enviando email con Resend:', err);
        res.status(500).json({ success: false, error: err.message || 'Error al enviar el correo' });
    }
});

module.exports = router;
