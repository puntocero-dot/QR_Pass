const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-only';

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: 'Acceso no autorizado — Token requerido',
            code: 'AUTH_REQUIRED'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = {
            role: decoded.role || 'cashier',
            cashier_id: decoded.cashier_id,
            restaurant_id: decoded.restaurant_id,
            restaurant_name: decoded.restaurant_name,
            vendor_id: decoded.vendor_id,
            company_name: decoded.company_name,
            company_id: decoded.company_id
        };
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Sesión expirada — Por favor inicie sesión nuevamente',
                code: 'TOKEN_EXPIRED'
            });
        }
        return res.status(401).json({
            success: false,
            error: 'Token inválido',
            code: 'INVALID_TOKEN'
        });
    }
}
function authorizeRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Acceso denegado — Permisos insuficientes',
                code: 'FORBIDDEN'
            });
        }
        next();
    };
}

module.exports = { authMiddleware, authenticateToken: authMiddleware, authorizeRole, JWT_SECRET };
