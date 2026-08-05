const jwt = require('jsonwebtoken');
const { ADMIN_USERNAME } = require('../config/constants');

const verifyToken = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  try {
    req.user = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

// Any admin account — Admin_Raushan (the primary admin) or one of the up-to-5 sub-admins
// he's created. Sub-admins have full operational access (teams, tickets, categories,
// events, announcements) but not the primary-only powers gated by requirePrimaryAdmin
// below (managing other admins, payments/financial data, the raw DB browser).
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only' });
  }
  next();
};

// Admin_Raushan specifically — for creating/managing other admin accounts and anything
// financial or otherwise too sensitive to delegate to a sub-admin.
const requirePrimaryAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin' || req.user?.username !== ADMIN_USERNAME) {
    return res.status(403).json({ success: false, message: 'Only Admin_Raushan can perform this action' });
  }
  next();
};

const requireTeamLeader = (req, res, next) => {
  if (!['admin', 'leader'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Team leader access required' });
  }
  next();
};

// Cash-payment handling stays with whoever's actually taking the money — a team leader
// (their department, their collections) or Admin_Raushan — but not a sub-admin.
const requirePaymentAccess = (req, res, next) => {
  if (req.user?.role === 'leader' || (req.user?.role === 'admin' && req.user?.username === ADMIN_USERNAME)) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Payment management is restricted to Admin_Raushan and team leaders' });
};

const requireCitizen = (req, res, next) => {
  if (req.user?.role !== 'citizen') {
    return res.status(403).json({ success: false, message: 'Citizen access only' });
  }
  next();
};

module.exports = { verifyToken, requireAdmin, requirePrimaryAdmin, requireTeamLeader, requirePaymentAccess, requireCitizen };
