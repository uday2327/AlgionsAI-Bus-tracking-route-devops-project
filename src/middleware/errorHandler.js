function errorHandler(error, _request, response, _next) {
  const status = error.status || 500;
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    message: error.message || 'Internal server error',
    status
  }));
  response.status(status).json({ error: status >= 500 ? 'Internal server error' : error.message });
}

module.exports = errorHandler;
