require('dotenv').config();
const { getTestDatabaseUrl } = require('./scripts/test-database');

process.env.DATABASE_URL = getTestDatabaseUrl();
process.env.NODE_ENV = 'test';
