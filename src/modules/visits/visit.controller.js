const { randomUUID: uuidv4 } = require('crypto');
const { query } = require('../../config/db');
const { asyncHandler } = require('../../middleware/errorHandler');
const { notifyCitizen } = require('../../utils/notify');

// Citizen requests an in-person office visit
const createVisit = asyncHandler(async (req, res) => {
  const { visitorName, aadharNumber, contactMobile, address, reason, numberOfPersons, preferredDate } = req.body;
  if (!visitorName?.trim() || !contactMobile?.trim() || !address?.trim() || !reason?.trim()) {
    return res.status(400).json({ success: false, message: 'Name, contact number, address and reason are required' });
  }
  const persons = parseInt(numberOfPersons, 10) || 1;
  if (persons < 1 || persons > 20) {
    return res.status(400).json({ success: false, message: 'Number of persons must be between 1 and 20' });
  }

  const result = await query(
    `INSERT INTO office_visits (id, user_id, visitor_name, aadhar_number, contact_mobile, address, reason, number_of_persons, preferred_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [uuidv4(), req.user.id, visitorName.trim(), aadharNumber || null, contactMobile.trim(), address.trim(), reason.trim(), persons, preferredDate || null]
  );
  res.status(201).json({ success: true, visit: result.rows[0] });
});

// Citizen's own visit requests
const myVisits = asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM office_visits WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ success: true, visits: result.rows });
});

// Citizen cancels their own pending/scheduled visit
const cancelVisit = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const visit = await query('SELECT user_id FROM office_visits WHERE id=$1', [id]);
  if (!visit.rows.length) return res.status(404).json({ success: false, message: 'Visit request not found' });
  if (visit.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not your visit request' });
  await query("UPDATE office_visits SET status='cancelled', updated_at=NOW() WHERE id=$1", [id]);
  res.json({ success: true });
});

// Admin — list all visit requests, optionally filtered by status
const listVisits = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [];
  const where = status ? `WHERE v.status = $${params.push(status)}` : '';
  const result = await query(
    `SELECT v.*, u.mobile AS account_mobile
     FROM office_visits v
     LEFT JOIN users u ON v.user_id = u.id
     ${where}
     ORDER BY v.created_at DESC`,
    params
  );
  res.json({ success: true, visits: result.rows });
});

// Admin — assign a scheduled time (or reject/cancel with a note)
const scheduleVisit = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { scheduledTime, adminNote, status } = req.body;
  const nextStatus = status || 'scheduled';
  if (!['scheduled', 'cancelled', 'completed'].includes(nextStatus)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }
  if (nextStatus === 'scheduled' && !scheduledTime?.trim()) {
    return res.status(400).json({ success: false, message: 'A scheduled time is required' });
  }
  const result = await query(
    'UPDATE office_visits SET status=$1, scheduled_time=$2, admin_note=$3, updated_at=NOW() WHERE id=$4 RETURNING *',
    [nextStatus, scheduledTime || null, adminNote || null, id]
  );
  if (!result.rows.length) return res.status(404).json({ success: false, message: 'Visit request not found' });

  const visit = result.rows[0];
  if (visit.user_id) {
    const messages = {
      scheduled: `Your office visit is scheduled for ${scheduledTime}.${adminNote ? ` Note: ${adminNote}` : ''}`,
      cancelled: `Your office visit request was cancelled.${adminNote ? ` Note: ${adminNote}` : ''}`,
      completed: 'Your office visit has been marked completed. Thank you for visiting.',
    };
    await notifyCitizen(visit.user_id, 'Office visit update', messages[nextStatus], 'office_visit');
  }
  res.json({ success: true, visit });
});

module.exports = { createVisit, myVisits, cancelVisit, listVisits, scheduleVisit };
