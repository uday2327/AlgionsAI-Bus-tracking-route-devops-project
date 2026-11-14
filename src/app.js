const express = require('express');
const prisma = require('./config/database');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const apiRoutes = require('./routes/apiRoutes');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(requestLogger);

app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));
app.get('/ready', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ status: 'ready', database: 'connected' });
  } catch {
    response.status(503).json({ status: 'not_ready', database: 'unavailable' });
  }
});
app.use('/api', apiRoutes);
app.use((_request, response) => response.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
