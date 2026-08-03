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

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin' || req.user?.username !== ADMIN_USERNAME) {
    return res.status(403).json({ success: false, message: 'Admin access only' });
  }
  next();
};

const requireTeamLeader = (req, res, next) => {
  if (!['admin', 'leader'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Team leader access required' });
  }
  next();
};

const requireCitizen = (req, res, next) => {
  if (req.user?.role !== 'citizen') {
    return res.status(403).json({ success: false, message: 'Citizen access only' });
  }
  next();
};

module.exports = { verifyToken, requireAdmin, requireTeamLeader, requireCitizen };
