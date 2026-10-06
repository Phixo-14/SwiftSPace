#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const backupRoot = path.join(repoRoot, 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(backupRoot, timestamp);
const uri = process.env.MONGO_URI;

if (!uri) {
  console.error('MONGO_URI is required. Example: MONGO_URI="mongodb+srv://user:pass@cluster.mongodb.net/dbname"');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const useDocker = process.env.USE_DOCKER === 'true';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (useDocker) {
  const dockerVolumePath = path.resolve(repoRoot, 'backups');
  const dockerOutDir = `/backups/${timestamp}`;
  run('docker', [
    'run',
    '--rm',
    '-v', `${dockerVolumePath}:/backups`,
    'mongo:7',
    'mongodump',
    '--uri', uri,
    '--out', dockerOutDir,
  ]);
} else {
  run('mongodump', ['--uri', uri, '--out', outDir]);
}

console.log(`MongoDB backup saved to ${outDir}`);
