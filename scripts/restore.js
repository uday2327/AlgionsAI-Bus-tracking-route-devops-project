require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const backupPath = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(backupPath) || !fs.statSync(backupPath).isFile()) {
  console.error('Usage: npm run restore -- backups/your-backup.dump');
  process.exit(1);
}
console.warn('WARNING: this replaces matching database objects/data. Keep a separate backup first.');
const user = process.env.APP_DB_USER || 'bus_app';
const database = process.env.POSTGRES_DB || 'bus_booking';
const restore = spawn('docker', ['compose', 'exec', '-T', 'db', 'pg_restore', '--clean', '--if-exists', '--no-owner', '-U', user, '-d', database], { stdio: ['pipe', 'inherit', 'inherit'] });
fs.createReadStream(backupPath).pipe(restore.stdin);
restore.on('error', (error) => { console.error(`Restore failed: ${error.message}`); process.exitCode = 1; });
restore.on('close', (code) => {
  if (code !== 0) {
    console.error(`pg_restore exited with code ${code}`);
    process.exitCode = code || 1;
    return;
  }
  const verify = spawn('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', user, '-d', database, '-c', 'SELECT count(*) AS routes FROM "Route";'], { stdio: 'inherit' });
  verify.on('error', (error) => { console.error(`Verification failed: ${error.message}`); process.exitCode = 1; });
  verify.on('close', (verifyCode) => {
    if (verifyCode !== 0) process.exitCode = verifyCode || 1;
    else console.log('Restore complete; verify the count above and check /ready.');
  });
});
