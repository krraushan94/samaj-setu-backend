const { randomUUID: uuidv4 } = require('crypto');
const { query } = require('../../config/db');
const { asyncHandler } = require('../../middleware/errorHandler');

const genPaymentRef = () => `PAY-${new Date().getFullYear()}-${Math.random().toString(36).toUpperCase().slice(2, 8)}`;

// Initiate cash payment — generates reference number
const initiatePayment = asyncHandler(async (req, res) => {
  const { ticketId } = req.body;
  const userId = req.user.id;

  const ticket = await query('SELECT id, status FROM tickets WHERE id=$1 AND user_id=$2', [ticketId, userId]);
  if (!ticket.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });
  if (ticket.rows[0].status !== 'payment_pending') {
    return res.status(400).json({ success: false, message: 'Payment already processed' });
  }

  // Check if payment record already exists
  const existing = await query('SELECT reference_number FROM payments WHERE ticket_id=$1', [ticketId]);
  if (existing.rows.length) {
    return res.json({ success: true, referenceNumber: existing.rows[0].reference_number, amount: 50 });
  }

  const referenceNumber = genPaymentRef();
  await query(
    'INSERT INTO payments (id, ticket_id, user_id, reference_number, method, status) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), ticketId, userId, referenceNumber, 'cash', 'pending']
  );

  res.status(201).json({ success: true, referenceNumber, amount: 50, method: 'cash',
    instructions: 'Please visit the Office and pay ₹50 cash quoting this reference number.' });
});

// Confirm cash received (team leader or admin)
const confirmPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await query(
    'UPDATE payments SET status=$1, confirmed_by=$2, confirmed_at=NOW() WHERE id=$3',
    ['confirmed', req.user.id === 'admin' ? null : req.user.id, id]
  );
  // Activate the linked ticket
  const payment = await query('SELECT ticket_id FROM payments WHERE id=$1', [id]);
  if (payment.rows.length) {
    await query("UPDATE tickets SET status='open', updated_at=NOW() WHERE id=$1", [payment.rows[0].ticket_id]);
  }
  res.json({ success: true, message: 'Payment confirmed, ticket is now active' });
});

// List payments (team leader/admin)
const listPayments = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (status) conditions.push(`p.status = $${params.push(status)}`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT p.*, t.ticket_number, t.title, u.full_name, u.mobile
     FROM payments p
     LEFT JOIN tickets t ON p.ticket_id = t.id
     LEFT JOIN users u ON p.user_id = u.id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params
  );
  res.json({ success: true, payments: result.rows });
});

module.exports = { initiatePayment, confirmPayment, listPayments };
