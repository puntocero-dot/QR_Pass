const express = require('express');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Demo credentials — replace with real auth in production
const STAFF_CREDENTIALS = {
    cajero: {
        password: 'campero2024',
        role: 'cashier',
        cashier_id: 'CAJ-001',
        restaurant_id: 'CAMPERO_METROCENTRO_SS',
        restaurant_name: 'SS Metrocentro'
    },
    admin: {
        password: 'admin2024',
        role: 'cashier',
        cashier_id: 'ADM-001',
        restaurant_id: 'CAMPERO_METROCENTRO_SS',
        restaurant_name: 'SS Metrocentro'
    },
    vendedor: {
        password: 'vendedor2024',
        role: 'vendor',
        vendor_id: 'VEND-001',
        company_name: 'Tigo El Salvador',
        company_id: 'TIGO-SV-001'
    }
};

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Returns: { success, token, user }
 */
router.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: 'Usuario y contraseña son requeridos',
            code: 'MISSING_CREDENTIALS'
        });
    }

    const staff = STAFF_CREDENTIALS[username.toLowerCase()];

    if (!staff || staff.password !== password) {
        return res.status(401).json({
            success: false,
            error: 'Credenciales incorrectas',
            code: 'INVALID_CREDENTIALS'
        });
    }

    const payload = { role: staff.role };

    if (staff.role === 'vendor') {
        payload.vendor_id = staff.vendor_id;
        payload.company_name = staff.company_name;
        payload.company_id = staff.company_id;
    } else {
        payload.cashier_id = staff.cashier_id;
        payload.restaurant_id = staff.restaurant_id;
        payload.restaurant_name = staff.restaurant_name;
    }

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });

    res.json({
        success: true,
        token,
        user: { ...payload }
    });
});

module.exports = router;
