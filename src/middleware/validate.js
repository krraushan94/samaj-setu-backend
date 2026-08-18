const { validationResult } = require('express-validator');

// express-validator's body()/query() chains only *record* failures on the request — nothing
// rejects the request unless something actually reads that result. This middleware is that
// missing piece: put it after a route's validation chains and it 400s on the first failure.
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }
  next();
};

module.exports = { validate };
