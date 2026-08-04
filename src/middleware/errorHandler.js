const errorHandler = (err, _req, res, _next) => {
  console.error(err.stack);

  // Postgres unique/foreign-key violations — translate to a clean status + generic message
  // instead of leaking the raw constraint name (which happens for every route that doesn't
  // pre-check for a duplicate, e.g. usernames/mobile numbers).
  if (err.code === '23505') {
    return res.status(409).json({ success: false, message: 'That value is already in use.' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ success: false, message: 'Invalid request — a referenced record was not found.' });
  }

  const status = err.status || 500;
  // No route in this app deliberately throws for its message to reach the client — every
  // intentional error path returns explicitly with res.status(...).json(...). So anything
  // that lands here is an unexpected internal error (DB driver, bcrypt, etc.) and its raw
  // message should never be forwarded to the client in production.
  const isProd = process.env.NODE_ENV === 'production';
  res.status(status).json({
    success: false,
    message: isProd && !err.status ? 'Internal server error' : (err.message || 'Internal server error'),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

// Wrap async route handlers to forward errors to errorHandler
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { errorHandler, asyncHandler };
