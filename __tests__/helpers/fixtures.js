const jwt = require('jsonwebtoken');

const sign = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

const citizenToken  = () => sign({ id: 'user-uuid-1', role: 'citizen', mobile: '9999900000' });
const leaderToken   = () => sign({ id: 'team-uuid-1', role: 'leader', departmentId: 'dept-uuid-1', username: 'team_leader1' });
const adminToken    = () => sign({ id: 'admin', role: 'admin', username: 'Admin_Raushan' });
const memberToken   = () => sign({ id: 'team-uuid-2', role: 'member', departmentId: 'dept-uuid-1' });

const mockUser = {
  id: 'user-uuid-1', full_name: 'Test Citizen', mobile: '9999900000',
  email: 'test@example.com', gender: 'female', age_group: '18-35',
  pincode: '700157', mandal: 'New Town', ward: '5', colony: 'Hatiara',
  is_verified: true, is_blocked: false, created_at: new Date().toISOString(),
};

const mockTicket = {
  id: 'ticket-uuid-1', ticket_number: 'SJT-2026-ABCDE',
  user_id: 'user-uuid-1', category: 'infrastructure', sub_category: 'street_light',
  title: 'Street light broken near Ward 5', description: 'Light at main road not working since 3 days',
  priority: 'medium', status: 'open', department_id: 'dept-uuid-1',
  is_anonymous: false, upvote_count: 0, created_at: new Date().toISOString(),
};

const mockPayment = {
  id: 'pay-uuid-1', ticket_id: 'ticket-uuid-1', user_id: 'user-uuid-1',
  reference_number: 'PAY-2026-XYZABC', amount: 50.00, method: 'cash',
  status: 'pending', created_at: new Date().toISOString(),
};

module.exports = { citizenToken, leaderToken, adminToken, memberToken, mockUser, mockTicket, mockPayment };
