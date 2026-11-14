require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const outputDirectory = path.resolve(__dirname, '..', 'backups');
fs.mkdirSync(outputDirectory, { recursive: true });
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const outputPath = path.join(outputDirectory, `bus_booking_${timestamp}.dump`);
const user = process.env.APP_DB_USER || 'bus_app';
const database = process.env.POSTGRES_DB || 'bus_booking';
const child = spawn('docker', ['compose', 'exec', '-T', 'db', 'pg_dump', '-Fc', '-U', user, database], { stdio: ['ignore', 'pipe', 'inherit'] });
const output = fs.createWriteStream(outputPath);
child.stdout.pipe(output);
child.on('error', (error) => { output.destroy(); console.error(`Backup failed: ${error.message}`); process.exitCode = 1; });
child.on('close', (code) => {
  output.end(() => {
    if (code !== 0) {
      fs.rmSync(outputPath, { force: true });
      console.error(`pg_dump exited with code ${code}`);
      process.exitCode = code || 1;
      return;
    }
    console.log(`Backup created: ${path.relative(process.cwd(), outputPath)}`);
  });
});
