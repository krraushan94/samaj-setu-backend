const { Router } = require('express');
const { verifyToken, requireTeamLeader } = require('../../middleware/auth');
const { createTicket, listTickets, getTicket, updateStatus, upvoteTicket, rateTicket, assignTicket, addNote, sosTicket } = require('./ticket.controller');

const router = Router();

router.post('/sos',         verifyToken, sosTicket);
router.post('/',            verifyToken, createTicket);
router.get('/',             verifyToken, listTickets);
router.get('/:id',          verifyToken, getTicket);
router.patch('/:id/status', verifyToken, requireTeamLeader, updateStatus);
router.patch('/:id/assign', verifyToken, requireTeamLeader, assignTicket);
router.post('/:id/upvote',  verifyToken, upvoteTicket);
router.post('/:id/rate',    verifyToken, rateTicket);
router.post('/:id/note',    verifyToken, requireTeamLeader, addNote);

module.exports = router;
