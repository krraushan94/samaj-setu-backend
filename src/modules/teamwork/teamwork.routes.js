const { Router } = require('express');
const { verifyToken, requireTeamAccess, requireAdmin } = require('../../middleware/auth');
const { listTasks, createTask, updateTask, taskSummary, listMessages, postMessage } = require('./teamwork.controller');

const router = Router();

router.get('/tasks/summary', verifyToken, requireAdmin, taskSummary);
router.get('/tasks',         verifyToken, requireTeamAccess, listTasks);
router.post('/tasks',        verifyToken, requireTeamAccess, createTask);
router.patch('/tasks/:id',   verifyToken, requireTeamAccess, updateTask);
router.get('/messages',      verifyToken, requireTeamAccess, listMessages);
router.post('/messages',     verifyToken, requireTeamAccess, postMessage);

module.exports = router;
