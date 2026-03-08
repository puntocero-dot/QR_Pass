const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB, seedDemoData } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/vouchers', require('./routes/vouchers'));
app.use('/api/vendor', require('./routes/vendor'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/client-portal', require('./routes/client_portal'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        code: 'INTERNAL_ERROR'
    });
});

// Main app startup
async function startServer() {
  try {
    // Initialize Database
    await initDB();
    
    // Seed demo data
    await seedDemoData();

    app.listen(PORT, () => {
      console.log(`🐔 ═══════════════════════════════════════════════════`);
      console.log(`   Servidor activo en: http://localhost:${PORT}`);
      console.log(`   RESTAURANTES — Sistema de Canje de Vales`);
      console.log(`   ═══════════════════════════════════════════════════`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

module.exports = app;
