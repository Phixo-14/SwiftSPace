const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const uri = process.env.MONGO_URI || 'mongodb+srv://Admin:SwiftSpace123@cluster0.lhldhif.mongodb.net/swiftspace?retryWrites=true&w=majority&appName=Cluster0';
const backupRoot = path.join(__dirname, 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(backupRoot, timestamp);

fs.mkdirSync(outDir, { recursive: true });

console.log('Starting MongoDB backup...');
console.log(`Target: ${outDir}`);

try {
  execSync(`mongodump --uri="${uri}" --out="${outDir}"`, { stdio: 'inherit' });
  console.log(`Backup created successfully at ${outDir}`);
} catch (error) {
  console.error('Backup failed. Make sure mongodump is installed and your Atlas connection is valid.');
  console.error(error.message);
  process.exit(1);
}
