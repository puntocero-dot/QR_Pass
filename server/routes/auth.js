const express = require('express');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Demo credentials — using environment variables for production
const STAFF_CREDENTIALS = {
    cajero: {
        password: process.env.CASHIER_PASS || 'restaurantes2024',
        role: 'cashier',
        cashier_id: 'CAJ-001',
        restaurant_id: 'RESTAURANTE_METROCENTRO_SS',
        restaurant_name: 'SS Metrocentro'
    },
    admin: {
        password: process.env.ADMIN_PASS || 'admin2024',
        role: 'cashier',
        cashier_id: 'ADM-001',
        restaurant_id: 'RESTAURANTE_METROCENTRO_SS',
        restaurant_name: 'SS Metrocentro'
    },
    vendedor: {
        password: process.env.VENDOR_PASS || 'vendedor2024',
        role: 'vendor',
        vendor_id: 'VEND-001',
        company_name: 'Empresa Demo',
        company_id: 'DEMO-SV-001'
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

    // DEBUG: Logging login attempt details (passwords hidden/masked)
    console.log(`Login attempt for: ${username}`);
    if (staff) {
        const passSet = !!staff.password;
        console.log(`User found. Pass set: ${passSet}. Pass length: ${staff.password ? staff.password.length : 0}`);
    } else {
        console.log(`User NOT found: ${username}`);
    }

    // Correct comparison with trimmed passwords
    const receivedPass = password ? password.trim() : '';
    const expectedPass = (staff && staff.password) ? staff.password.trim() : '';

    if (!staff || expectedPass !== receivedPass) {
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
