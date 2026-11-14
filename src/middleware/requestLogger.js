function requestLogger(request, response, next) {
  const startedAt = Date.now();
  response.on('finish', () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'http_request',
      method: request.method,
      path: request.originalUrl,
      status: response.statusCode,
      durationMs: Date.now() - startedAt
    }));
  });
  next();
}

module.exports = requestLogger;
