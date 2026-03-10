const express = require('express');
const { getDB } = require('../db');

const router = express.Router();

router.get('/voucher/:id', async (req, res) => {
    try {
        const db = getDB();
        const { rows } = await db.query('SELECT * FROM vouchers WHERE id = $1', [req.params.id]);
        
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
                qr_payload: voucher.qr_payload,
                recipient_name: voucher.recipient_name
            }
        });
    } catch (err) {
        console.error('Error fetching public voucher:', err);
        res.status(500).json({ success: false, error: 'Error del servidor' });
    }
});

module.exports = router;
