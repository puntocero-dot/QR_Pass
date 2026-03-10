const express = require('express');
const { getDB } = require('../db');
const { generateQRPayload } = require('../utils/crypto');

const router = express.Router();

router.get('/voucher/:id', async (req, res) => {
    try {
        const db = getDB();
        const { rows } = await db.query(`
            SELECT v.*, c.name as client_name 
            FROM vouchers v 
            LEFT JOIN clients c ON v.client_id = c.id 
            WHERE v.id = $1
        `, [req.params.id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Vale no encontrado' });
        }
        
        const voucher = rows[0];
        
        // Return only safe public information
        res.json({
            success: true,
            voucher: {
                id: voucher.id,
                issuing_company_name: voucher.issuing_company_name,
                initial_value: voucher.initial_value,
                current_value: voucher.current_value,
                expiry_date: voucher.expiry_date,
                is_active: voucher.is_active,
                qr_payload: generateQRPayload(voucher.id, voucher.hashed_code),
                recipient_name: voucher.recipient_name || voucher.client_name
            }
        });
    } catch (err) {
        console.error('Error fetching public voucher:', err);
        res.status(500).json({ success: false, error: 'Error del servidor' });
    }
});

module.exports = router;
