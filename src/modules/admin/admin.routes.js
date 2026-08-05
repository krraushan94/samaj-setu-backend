const { Router } = require('express');
const { verifyToken, requireAdmin, requirePrimaryAdmin, requireTeamLeader } = require('../../middleware/auth');
const { getDashboardStats, browseTable, getImpressions, recordImpression, exportTable, getDeptStats } = require('./admin.controller');

const router = Router();

// Impression tracking — any logged-in user
router.post('/impressions', verifyToken, recordImpression);

// Any admin (including sub-admins) — getDashboardStats itself omits cash figures
// unless the caller is Admin_Raushan.
router.get('/stats',          verifyToken, requireAdmin, getDashboardStats);
router.get('/dept-stats',     verifyToken, requireTeamLeader, getDeptStats);
router.get('/impressions',    verifyToken, requireAdmin, getImpressions);

// Admin_Raushan only — raw table browser/export can surface payments and full user PII.
router.get('/db/:table',      verifyToken, requirePrimaryAdmin, browseTable);
router.get('/export/:table',  verifyToken, requirePrimaryAdmin, exportTable);

module.exports = router;
