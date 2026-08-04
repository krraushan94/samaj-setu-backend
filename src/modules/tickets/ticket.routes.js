const { Router } = require('express');
const { verifyToken, requireTeamLeader } = require('../../middleware/auth');
const { ticketCreateLimiter } = require('../../middleware/rateLimiters');
const { createTicket, listTickets, getTicket, updateStatus, upvoteTicket, rateTicket, assignTicket, addNote, sosTicket } = require('./ticket.controller');

const router = Router();

// SOS is deliberately NOT rate-limited — throttling a genuine emergency would defeat the point.
router.post('/sos',         verifyToken, sosTicket);
router.post('/',            verifyToken, ticketCreateLimiter, createTicket);
router.get('/',             verifyToken, listTickets);
router.get('/:id',          verifyToken, getTicket);
router.patch('/:id/status', verifyToken, requireTeamLeader, updateStatus);
router.patch('/:id/assign', verifyToken, requireTeamLeader, assignTicket);
router.post('/:id/upvote',  verifyToken, upvoteTicket);
router.post('/:id/rate',    verifyToken, rateTicket);
router.post('/:id/note',    verifyToken, requireTeamLeader, addNote);

module.exports = router;
