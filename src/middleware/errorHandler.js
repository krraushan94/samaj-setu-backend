const errorHandler = (err, _req, res, _next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    // stack only in development
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

// Wrap async route handlers to forward errors to errorHandler
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { errorHandler, asyncHandler };
