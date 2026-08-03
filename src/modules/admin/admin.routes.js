const { Router } = require('express');
const { verifyToken, requireAdmin, requireTeamLeader } = require('../../middleware/auth');
const { getDashboardStats, browseTable, getImpressions, recordImpression, exportTable, getDeptStats } = require('./admin.controller');

const router = Router();

// Impression tracking — any logged-in user
router.post('/impressions', verifyToken, recordImpression);

// Admin_Raushan only below
router.get('/stats',          verifyToken, requireAdmin, getDashboardStats);
router.get('/dept-stats',     verifyToken, requireTeamLeader, getDeptStats);
router.get('/impressions',    verifyToken, requireAdmin, getImpressions);
router.get('/db/:table',      verifyToken, requireAdmin, browseTable);
router.get('/export/:table',  verifyToken, requireAdmin, exportTable);

module.exports = router;
