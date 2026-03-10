const express = require('express');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const { getDB } = require('../db');

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const db = getDB();

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: 'Usuario y contraseña son requeridos'
        });
    }

const bcrypt = require('bcryptjs');

    try {
        const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales incorrectas'
            });
        }

        const payload = { 
            id: user.id,
            username: user.username,
            role: user.role,
            full_name: user.full_name
        };

        if (user.role === 'vendor') {
            payload.vendor_id = user.related_id;
            payload.company_id = user.related_id;
            payload.company_name = user.full_name; 
        } else if (user.role === 'admin') {
            payload.company_id = 'ADMIN';
            payload.company_name = 'Restaurantes Admin';
        } else if (user.role === 'client') {
            payload.company_id = user.related_id;
            payload.company_name = user.full_name;
        } else {
            payload.cashier_id = user.id;
            payload.restaurant_id = user.related_id;
            payload.restaurant_name = 'Restaurantes SV';
        }

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });

        res.json({
            success: true,
            token,
            user: payload
        });
    } catch (err) {
        console.error('Auth error:', err);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});
/*
// Original hardcoded logic removed
const STAFF_CREDENTIALS = { ... }
*/

module.exports = router;
