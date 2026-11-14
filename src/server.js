require('dotenv').config();

const app = require('./app');
const prisma = require('./config/database');

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', message: 'server_started', port }));
});

async function shutdown(signal) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', message: 'server_shutdown', signal }));
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
