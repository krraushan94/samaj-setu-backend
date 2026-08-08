/**
 * Full end-to-end journey against a real in-memory Postgres-compatible database
 * (pg-mem — see helpers/pgMemDb.js). Unlike the per-module tests, nothing here is
 * scripted with mockResolvedValueOnce: every request hits the real Express app,
 * real controllers, and real SQL, with state genuinely persisted across steps —
 * exactly like production, except the database lives in memory and is thrown away
 * when the test ends. Never touches the real Neon/Render database.
 *
 * Journey: citizen registers → logs in → reports a paid issue → pays cash →
 * gets it assigned/resolved by a team → triggers SOS → requests an office visit →
 * a team leader assigns/tracks a task with a member → they chat → admin reviews
 * the cross-department summary → admin blocks the citizen.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');

const ADMIN_PLAINTEXT_PASSWORD = 'E2E-Test-Admin-Pass-1';
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PLAINTEXT_PASSWORD, 10);
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Admin_Raushan';

jest.mock('../src/config/db', () => require('./helpers/pgMemDb').dbMockFactory());

const { migrateAll, pool } = require('./helpers/pgMemDb');
const app = require('../src/app');

jest.setTimeout(30000);

// sendOtpSms falls back to console.log with no FAST2SMS_API_KEY set — read the plaintext
// OTP back out of that, the same way a developer would watch the terminal in dev.
const logSpy = jest.spyOn(console, 'log');
function otpFor(mobile) {
  const line = logSpy.mock.calls.map((c) => c.join(' ')).reverse().find((l) => l.includes(`OTP for ${mobile}`));
  return line.match(/:\s*(\d{6})/)[1];
}

const CITIZEN_MOBILE = '9800011111';

// GET /api/tickets/:id's SELECT t.* + json_agg(...) GROUP BY t.id relies on the same
// real-Postgres functional-dependency rule pg-mem's parser doesn't implement (see the
// GET /api/departments workaround above) — use the plain-join list endpoint instead,
// which every role can call and which has no such aggregate.
async function findTicket(token, ticketId) {
  const res = await request(app).get('/api/tickets').set('Authorization', `Bearer ${token}`);
  return res.body.tickets.find((t) => t.id === ticketId);
}

describe('E2E: full citizen-to-admin journey', () => {
  let citizenToken, citizenId;
  let adminToken;
  let othersDeptId, socialDeptId;
  let leaderToken, leaderId;
  let memberToken, memberId;
  let socialLeaderToken;
  let ticketId, paymentId, taskId;

  beforeAll(async () => {
    await migrateAll();
  });

  it('registers a new citizen via OTP', async () => {
    const sendRes = await request(app).post('/api/auth/send-otp').send({ mobile: CITIZEN_MOBILE });
    expect(sendRes.status).toBe(200);
    const otp = otpFor(CITIZEN_MOBILE);

    const verifyRes = await request(app).post('/api/auth/verify-otp').send({ mobile: CITIZEN_MOBILE, otp });
    expect(verifyRes.body.isNewUser).toBe(true);
    const { tempToken } = verifyRes.body;

    const registerRes = await request(app).post('/api/auth/register').send({
      tempToken, firstName: 'Anita', lastName: 'Roy', gender: 'female',
      pincode: '700157', ward: 'Ward 12', colony: 'Hatiara',
      aadharNumber: '123412341234', password: 'Citizen@Pass1',
    });
    expect(registerRes.status).toBe(201);
    citizenToken = registerRes.body.accessToken;
    citizenId = registerRes.body.user.id;
    expect(citizenToken).toBeTruthy();
  });

  it('logs the citizen back in with mobile + password (not OTP)', async () => {
    const res = await request(app).post('/api/auth/login').send({ mobile: CITIZEN_MOBILE, password: 'Citizen@Pass1' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('citizen');
    citizenToken = res.body.accessToken; // refresh to the login-issued token
  });

  it('logs in as the bootstrapped admin', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: process.env.ADMIN_USERNAME, password: ADMIN_PLAINTEXT_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
    adminToken = res.body.accessToken;
  });

  it('admin sets up an "Others" team leader + member, and a Social Welfare leader', async () => {
    // GET /api/departments' SELECT d.* + json_agg(...) GROUP BY d.id relies on a real-Postgres
    // functional-dependency rule (grouping by a table's PK lets you select its other columns
    // unaggregated) that pg-mem's parser doesn't implement — a harness limitation, not a bug in
    // the route. Fetch department ids directly from the same in-memory DB instead.
    const deptRows = (await pool.query('SELECT id, name FROM departments')).rows;
    othersDeptId = deptRows.find((d) => d.name === 'Others').id;
    socialDeptId = deptRows.find((d) => d.name === 'Social Welfare').id;

    const leaderRes = await request(app).post(`/api/departments/${othersDeptId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Leader Lal', username: 'leader.others', password: 'Leader@Pass1', role: 'leader' });
    expect(leaderRes.status).toBe(201);

    const socialLeaderRes = await request(app).post(`/api/departments/${socialDeptId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Social Leader', username: 'leader.social', password: 'Leader@Pass2', role: 'leader' });
    expect(socialLeaderRes.status).toBe(201);

    const leaderLogin = await request(app).post('/api/auth/login').send({ username: 'leader.others', password: 'Leader@Pass1' });
    leaderToken = leaderLogin.body.accessToken;
    leaderId = leaderLogin.body.member.id;
    expect(leaderLogin.body.role).toBe('leader');

    const socialLeaderLogin = await request(app).post('/api/auth/login').send({ username: 'leader.social', password: 'Leader@Pass2' });
    socialLeaderToken = socialLeaderLogin.body.accessToken;

    const memberAddRes = await request(app).post('/api/departments/members')
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ fullName: 'Member Mia', username: 'member.others', password: 'Member@Pass1' });
    expect(memberAddRes.status).toBe(201);

    const memberLogin = await request(app).post('/api/auth/login').send({ username: 'member.others', password: 'Member@Pass1' });
    memberToken = memberLogin.body.accessToken;
    memberId = memberLogin.body.member.id;
    expect(memberLogin.body.role).toBe('member');
  });

  it('citizen reports a paid (non-exempt) issue and pays cash', async () => {
    const createRes = await request(app).post('/api/tickets')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ category: 'land_property', subCategory: 'Land Dispute', title: 'Boundary wall dispute', locationText: 'Hatiara Colony' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('payment_pending');
    expect(createRes.body.paymentRequired).toBe(true);
    ticketId = createRes.body.ticketId;

    const payRes = await request(app).post('/api/payments/initiate')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ ticketId });
    expect(payRes.status).toBe(201);
    expect(payRes.body.referenceNumber).toMatch(/^PAY-/);

    const listPayments = await request(app).get('/api/payments?status=pending').set('Authorization', `Bearer ${leaderToken}`);
    paymentId = listPayments.body.payments.find((p) => p.ticket_id === ticketId).id;

    const confirmRes = await request(app).post(`/api/payments/${paymentId}/confirm`).set('Authorization', `Bearer ${leaderToken}`);
    expect(confirmRes.status).toBe(200);

    const ticket = await findTicket(leaderToken, ticketId);
    expect(ticket.status).toBe('open');
  });

  it('leader assigns the ticket to a member, who sees it; leader then resolves it and the citizen is notified', async () => {
    const assignRes = await request(app).patch(`/api/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ assignedTo: memberId });
    expect(assignRes.status).toBe(200);

    const memberNotifs = await request(app).get('/api/notifications').set('Authorization', `Bearer ${memberToken}`);
    expect(memberNotifs.body.notifications.some((n) => n.type === 'ticket_assigned')).toBe(true);

    const statusRes = await request(app).patch(`/api/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ status: 'resolved', note: 'Boundary re-surveyed and marked' });
    expect(statusRes.status).toBe(200);

    const citizenNotifs = await request(app).get('/api/notifications').set('Authorization', `Bearer ${citizenToken}`);
    const statusNotif = citizenNotifs.body.notifications.find((n) => n.type === 'ticket_status');
    expect(statusNotif).toBeTruthy();

    const markRead = await request(app).patch(`/api/notifications/${statusNotif.id}/read`).set('Authorization', `Bearer ${citizenToken}`);
    expect(markRead.status).toBe(200);
  });

  it('citizen triggers SOS, bypassing payment, and the Social Welfare team is notified', async () => {
    const sosRes = await request(app).post('/api/tickets/sos')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ locationText: 'Near Ram Mandir, Hatiara' });
    expect(sosRes.status).toBe(201);

    const sosTicket = await findTicket(socialLeaderToken, sosRes.body.ticketId);
    expect(sosTicket.status).toBe('open'); // never payment_pending
    expect(sosTicket.priority).toBe('critical');

    const socialNotifs = await request(app).get('/api/notifications').set('Authorization', `Bearer ${socialLeaderToken}`);
    expect(socialNotifs.body.notifications.some((n) => n.type === 'sos')).toBe(true);
  });

  it('citizen requests an office visit; admin schedules it and the citizen is notified', async () => {
    const createVisit = await request(app).post('/api/visits')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ visitorName: 'Anita Roy', contactMobile: CITIZEN_MOBILE, address: 'Hatiara Colony', reason: 'Discuss land dispute papers', numberOfPersons: 2 });
    expect(createVisit.status).toBe(201);
    const visitId = createVisit.body.visit.id;

    const scheduleRes = await request(app).patch(`/api/visits/${visitId}/schedule`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'scheduled', scheduledTime: '2026-08-15 11:00 AM' });
    expect(scheduleRes.status).toBe(200);

    const citizenNotifs = await request(app).get('/api/notifications').set('Authorization', `Bearer ${citizenToken}`);
    expect(citizenNotifs.body.notifications.some((n) => n.type === 'office_visit')).toBe(true);
  });

  it('leader assigns an overdue task to the member; member completes it and the leader is notified', async () => {
    const createTask = await request(app).post('/api/teamwork/tasks')
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ title: 'File dispute paperwork', assignedTo: memberId, dueDate: '2020-01-01', priority: 'high' });
    expect(createTask.status).toBe(201);
    taskId = createTask.body.task.id;

    const summaryBefore = await request(app).get('/api/teamwork/tasks/summary').set('Authorization', `Bearer ${adminToken}`);
    expect(summaryBefore.body.overdueCount).toBeGreaterThanOrEqual(1);

    const memberTasks = await request(app).get('/api/teamwork/tasks').set('Authorization', `Bearer ${memberToken}`);
    expect(memberTasks.body.tasks.some((t) => t.id === taskId)).toBe(true);

    const completeRes = await request(app).patch(`/api/teamwork/tasks/${taskId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ status: 'completed', progressNote: 'Filed at the office today' });
    expect(completeRes.status).toBe(200);

    const leaderNotifs = await request(app).get('/api/notifications').set('Authorization', `Bearer ${leaderToken}`);
    expect(leaderNotifs.body.notifications.some((n) => n.type === 'task_status')).toBe(true);

    const summaryAfter = await request(app).get('/api/teamwork/tasks/summary').set('Authorization', `Bearer ${adminToken}`);
    // completed tasks never count as overdue, regardless of due date
    expect(summaryAfter.body.overdueCount).toBe(0);
  });

  it('leader and member chat about the department, and admin can read the same thread', async () => {
    const send1 = await request(app).post('/api/teamwork/messages')
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ message: 'Good work on the boundary dispute filing' });
    expect(send1.status).toBe(201);

    const send2 = await request(app).post('/api/teamwork/messages')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ message: 'Thanks — filed and receipted' });
    expect(send2.status).toBe(201);

    const memberView = await request(app).get('/api/teamwork/messages').set('Authorization', `Bearer ${memberToken}`);
    expect(memberView.body.messages.length).toBeGreaterThanOrEqual(2);

    const adminView = await request(app).get(`/api/teamwork/messages?departmentId=${othersDeptId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(adminView.body.messages.length).toBe(memberView.body.messages.length);
  });

  it('admin blocks the citizen, who can no longer log in', async () => {
    const blockRes = await request(app).patch(`/api/users/${citizenId}/block`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ blocked: true });
    expect(blockRes.status).toBe(200);

    const loginAttempt = await request(app).post('/api/auth/login').send({ mobile: CITIZEN_MOBILE, password: 'Citizen@Pass1' });
    expect(loginAttempt.status).toBe(401);
  });
});
