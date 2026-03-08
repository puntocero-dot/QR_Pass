// Set the environment variable BEFORE requiring the DB module
process.env.DATABASE_URL = 'postgresql://postgres:OAINvQuQaAHSWyItBIzNbLdNTLTAtoaR@centerbeam.proxy.rlwy.net:56832/railway';

const { initDB, seedDemoData } = require('./server/db');

async function setup() {
  try {
    console.log('Initializing PostgreSQL schema on Railway...');
    await initDB();
    
    console.log('Seeding demo data...');
    await seedDemoData();
    
    console.log('🚀 Database setup complete on Railway!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to setup database:', err);
    process.exit(1);
  }
}

setup();
