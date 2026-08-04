const { Router } = require('express');
const { verifyToken, requireTeamLeader, requireCitizen } = require('../../middleware/auth');
const { ticketCreateLimiter } = require('../../middleware/rateLimiters');
const { createTicket, listTickets, getTicket, updateStatus, upvoteTicket, rateTicket, assignTicket, addNote, sosTicket } = require('./ticket.controller');

const router = Router();

// createTicket/sosTicket/upvoteTicket/rateTicket all write req.user.id into a column that
// foreign-keys to the citizen `users` table — calling them as admin/team crashes with a raw
// FK-violation 500 (admin/team ids live in separate tables), so these are citizen-only.
// SOS is deliberately NOT rate-limited — throttling a genuine emergency would defeat the point.
router.post('/sos',         verifyToken, requireCitizen, sosTicket);
router.post('/',            verifyToken, requireCitizen, ticketCreateLimiter, createTicket);
router.get('/',             verifyToken, listTickets);
router.get('/:id',          verifyToken, getTicket);
router.patch('/:id/status', verifyToken, requireTeamLeader, updateStatus);
router.patch('/:id/assign', verifyToken, requireTeamLeader, assignTicket);
router.post('/:id/upvote',  verifyToken, requireCitizen, upvoteTicket);
router.post('/:id/rate',    verifyToken, requireCitizen, rateTicket);
router.post('/:id/note',    verifyToken, requireTeamLeader, addNote);

module.exports = router;
