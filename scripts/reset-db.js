const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const files = ['cloudkitchen.db', 'cloudkitchen.db-wal', 'cloudkitchen.db-shm'];

for (const file of files) {
  const target = path.join(dataDir, file);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

console.log('Database removed. Starting the app again will recreate and seed it.');
require('../src/db');
console.log('Fresh database created with demo data.');
