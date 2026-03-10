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
        const { rows: userRows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        let user = userRows[0];
        let isClientTable = false;

        // If not in users table, try matching in clients table
        if (!user) {
            const { rows: clientRows } = await db.query(`
                SELECT * FROM clients 
                WHERE (tax_id = $1 OR name = $1) AND is_active = 1
            `, [username]);
            
            if (clientRows[0]) {
                user = clientRows[0];
                isClientTable = true;
            }
        }

        if (!user) {
            return res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
        }

        let isMatch = false;
        if (user.password && user.password.startsWith('$2')) {
            isMatch = await bcrypt.compare(password, user.password);
        } else {
            // Plaintext fallback for legacy unhashed passwords
            isMatch = (password === user.password);
            
            // Proactively upgrade the password to bcrypt in the database if it matched
            if (isMatch) {
                try {
                    const hashed = await bcrypt.hash(password, 10);
                    if (isClientTable) {
                        await db.query('UPDATE clients SET password = $1 WHERE id = $2', [hashed, user.id]);
                    } else {
                        await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, user.id]);
                    }
                } catch (updateErr) {
                    console.error('Failed to upgrade password hash:', updateErr);
                }
            }
        }

        if (!isMatch) {
            return res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
        }

        const payload = { 
            id: user.id,
            username: isClientTable ? (user.tax_id || user.name) : user.username,
            role: isClientTable ? 'client' : user.role,
            full_name: isClientTable ? user.name : user.full_name
        };

        if (payload.role === 'vendor') {
            payload.vendor_id = user.related_id;
            payload.company_id = user.related_id;
            payload.company_name = user.full_name; 
        } else if (payload.role === 'admin') {
            payload.company_id = 'ADMIN';
            payload.company_name = 'Restaurantes Admin';
        } else if (payload.role === 'client') {
            payload.company_id = isClientTable ? user.id : user.related_id;
            payload.company_name = isClientTable ? user.name : user.full_name;
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
