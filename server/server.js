const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB, seedDemoData } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
startServer();

module.exports = app;
