// Full role/category simulation — acts like real citizens (20 per category, across every
// issue category including BMS/labour), team leaders (one per department, handling their
// own department's tickets), and the admin (cross-department oversight, moderation, visits,
// sub-admin management). Runs against an in-memory pg-mem-backed copy of the real app — same
// business logic as production, no real database or SMS/S3 needed.
//
// Usage: node scripts/fullRoleCategorySimulation.js
'use strict';

const path = require('path');
const bcrypt = require('bcryptjs');

const USERS_PER_CATEGORY = 20;
const ADMIN_PLAINTEXT_PASSWORD = 'Sim-Admin-Pass-1';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'sim-jwt-secret-not-for-real-use';
process.env.PORT = process.env.PORT || '5099';
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PLAINTEXT_PASSWORD, 10);
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Admin_Raushan';
delete process.env.FAST2SMS_API_KEY; // force the dev console.log OTP fallback

// ---- Disable rate limiting for this simulation (it's a QA functional pass, not a
// rate-limiter test — that's scripts/stressTest.js's job) by cache-injecting a no-op
// replacement for express-rate-limit before anything requires it. ----
const rateLimitModulePath = require.resolve('express-rate-limit', { paths: [path.join(__dirname, '..')] });
const noopLimiter = () => (req, res, next) => next();
noopLimiter.rateLimit = noopLimiter;
noopLimiter.ipKeyGenerator = (req) => (req && req.ip) || 'sim-ip';
require.cache[rateLimitModulePath] = { id: rateLimitModulePath, filename: rateLimitModulePath, loaded: true, exports: noopLimiter };

// ---- Capture console.log so we can pull OTPs back out (no jest.spyOn outside Jest) ----
const capturedLogs = [];
const origLog = console.log;
console.log = (...args) => { capturedLogs.push(args.map(String).join(' ')); origLog(...args); };
function otpFor(mobile) {
  for (let i = capturedLogs.length - 1; i >= 0; i--) {
    if (capturedLogs[i].includes(`OTP for ${mobile}`)) {
      const m = capturedLogs[i].match(/:\s*(\d{6})/);
      if (m) return m[1];
    }
  }
  return null;
}

// ---- pg-mem bootstrap (reuse the exact same harness the real test suite uses) ----
const { dbMockFactory, migrateAll } = require('../__tests__/helpers/pgMemDb');
const dbModulePath = require.resolve('../src/config/db.js');
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: dbMockFactory() };

const results = []; // { area, name, ok, detail }
function record(area, name, ok, detail) {
  results.push({ area, name, ok, detail: detail || '' });
  if (!ok) origLog(`  [FAIL] ${area} :: ${name} — ${detail}`);
}

const CATEGORIES = {
  infrastructure: ['Street Light', 'Road Damage', 'Pothole', 'Water Supply', 'Drainage/Sewage', 'Public Toilet', 'Bridge/Footpath', 'Disability Access (Ramps/Toilets)'],
  women_safety:   ['Eve Teasing', 'Harassment', 'Domestic Violence', 'Stalking', 'Chain Snatching', 'Unsafe Area'],
  security:       ['Theft', 'Robbery', 'Threat/Dhamki', 'Illegal Parking', 'Unlawful Activity'],
  land_property:  ['Land Dispute', 'Illegal Construction', 'Encroachment', 'Property Dispute'],
  health:         ['Open Defecation', 'Mosquito Breeding', 'Garbage Dumping', 'Hospital Complaint', 'Epidemic Alert'],
  education:      ['School Infrastructure', 'Teacher Absenteeism', 'Mid-Day Meal', 'Dropout Concern'],
  environment:    ['Illegal Tree Cutting', 'Water Body Encroachment', 'Pollution', 'Stray Animals'],
  social:         ['Drug Abuse', 'Child Labour', 'Support Needed', 'Domestic Abuse', 'Elder Abuse / Neglect', 'Caste-Based Discrimination', 'Mental Health Crisis'],
  missing:        ['Missing Person', 'Missing Child', 'Medical Emergency'],
  development:    ['Ongoing Work Complaint', 'Fund Misuse', 'Development Suggestion'],
  feedback:       ['Appreciation', 'Suggestion', 'Event Feedback', 'General Comment'],
  others:         ['General Complaint', 'Any Other'],
};

const LABOUR_SUBS = [
  'Corporate / Private Office Employee – Salary Delayed or Not Paid',
  'Factory / Industrial Worker – Unsafe Working Conditions / No Safety Gear',
  'Construction Worker – Wages Not Paid by Contractor',
  'Domestic Worker / Maid – Physical or Verbal Abuse by Employer',
  'Auto / Taxi / Cab Driver – Fare or Commission Dispute',
  'Bus / Transport Worker – Salary Delayed or Not Paid',
  'Delivery / Gig Platform Worker – Unfair Account Blocking',
  'Security Guard – Salary Delayed or Not Paid',
  'Shop / Retail Employee – Wrongful Termination',
  'Contract / Daily-Wage Labour – Bonded / Forced Labour',
  'Sanitation Worker – No Safety Gear (Manual Scavenging Risk)',
];

const PAYMENT_EXEMPT_GROUPS = ['infrastructure', 'women_safety', 'missing'];
const CATEGORY_DEPARTMENT_MAP = {
  infrastructure: 'Social Welfare', women_safety: 'Social Welfare', security: 'Social Welfare',
  health: 'Social Welfare', education: 'Social Welfare', social: 'Social Welfare', missing: 'Social Welfare',
  land_property: 'Others', environment: 'Others', development: 'Politics', feedback: 'Marketing',
  others: 'Others', labour: 'BMS',
};

let mobileCounter = 9000000001;
function nextMobile() { return String(mobileCounter++); }
let aadharCounter = 100000000001;
function nextAadhar() { return String(aadharCounter++); }
let voterCounter = 1000001;
function nextVoterId() { return 'ABC' + String(voterCounter++).padStart(7, '0'); }

async function registerCitizen(request, app, { gender } = {}) {
  const mobile = nextMobile();
  const sendRes = await request(app).post('/api/auth/send-otp').send({ mobile });
  if (sendRes.status !== 200) return { error: `send-otp ${sendRes.status}: ${JSON.stringify(sendRes.body)}` };
  const otp = otpFor(mobile);
  if (!otp) return { error: 'could not capture OTP from console log' };
  const verifyRes = await request(app).post('/api/auth/verify-otp').send({ mobile, otp });
  if (verifyRes.status !== 200 || !verifyRes.body.tempToken) return { error: `verify-otp ${verifyRes.status}: ${JSON.stringify(verifyRes.body)}` };
  const idx = mobileCounter;
  const useAadhar = idx % 2 === 0;
  const regRes = await request(app).post('/api/auth/register').send({
    tempToken: verifyRes.body.tempToken,
    firstName: 'Sim', lastName: `User${idx}`,
    gender: gender || (idx % 2 === 0 ? 'male' : 'female'),
    pincode: '700102', ward: String((idx % 20) + 1), colony: 'Sim Colony',
    aadharNumber: useAadhar ? nextAadhar() : undefined,
    voterIdNumber: useAadhar ? undefined : nextVoterId(),
    password: 'Citizen@Pass1',
  });
  if (regRes.status !== 201) return { error: `register ${regRes.status}: ${JSON.stringify(regRes.body)}` };
  return { mobile, token: regRes.body.accessToken, user: regRes.body.user };
}

async function main() {
  await migrateAll();
  const app = require('../src/app.js');
  const request = require('supertest');
  await new Promise((r) => setTimeout(r, 300));

  origLog('=== SamajSetu full role/category simulation ===');
  origLog(`Citizens per category: ${USERS_PER_CATEGORY} (12 regular categories + BMS/labour = 13 categories, ${13 * USERS_PER_CATEGORY} total citizens)\n`);

  // ---------------------------------------------------------------------------------
  // SETUP: admin login, departments, one leader + one member per department
  // ---------------------------------------------------------------------------------
  const adminLogin = await request(app).post('/api/auth/login').send({ username: process.env.ADMIN_USERNAME, password: ADMIN_PLAINTEXT_PASSWORD });
  record('setup', 'admin login', adminLogin.status === 200 && adminLogin.body.role === 'admin', `status ${adminLogin.status}`);
  const adminToken = adminLogin.body.accessToken;

  const { pool } = dbMockFactory();
  const deptRows = (await pool.query('SELECT id, name FROM departments')).rows;
  const deptByName = {};
  deptRows.forEach((d) => { deptByName[d.name] = d.id; });
  record('setup', 'departments seeded', deptRows.length === 5, `found ${deptRows.length}: ${deptRows.map((d) => d.name).join(', ')}`);

  const leaders = {}; // deptName -> { token, id, username, departmentId }
  const members = {}; // deptName -> { id }
  for (const deptName of Object.keys(deptByName)) {
    const deptId = deptByName[deptName];
    const username = `leader.${deptName.replace(/\s+/g, '').toLowerCase()}`;
    const addLeaderRes = await request(app).post(`/api/departments/${deptId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: `${deptName} Leader`, username, password: 'Leader@Pass1', role: 'leader' });
    record('setup', `create leader for ${deptName}`, addLeaderRes.status === 201, `status ${addLeaderRes.status}: ${JSON.stringify(addLeaderRes.body)}`);

    const leaderLogin = await request(app).post('/api/auth/login').send({ username, password: 'Leader@Pass1' });
    record('setup', `leader login for ${deptName}`, leaderLogin.status === 200 && leaderLogin.body.role === 'leader', `status ${leaderLogin.status}`);
    leaders[deptName] = { token: leaderLogin.body.accessToken, id: leaderLogin.body.member && leaderLogin.body.member.id, username, departmentId: deptId };

    const memberUsername = `member.${deptName.replace(/\s+/g, '').toLowerCase()}`;
    const addMemberRes = await request(app).post('/api/departments/members')
      .set('Authorization', `Bearer ${leaders[deptName].token}`)
      .send({ fullName: `${deptName} Member`, username: memberUsername, password: 'Member@Pass1' });
    record('setup', `leader adds member for ${deptName}`, addMemberRes.status === 201, `status ${addMemberRes.status}: ${JSON.stringify(addMemberRes.body)}`);

    const memberLogin = await request(app).post('/api/auth/login').send({ username: memberUsername, password: 'Member@Pass1' });
    record('setup', `member login for ${deptName}`, memberLogin.status === 200 && memberLogin.body.role === 'member', `status ${memberLogin.status}`);
    members[deptName] = { token: memberLogin.body.accessToken, id: memberLogin.body.member && memberLogin.body.member.id };
  }

  // ---------------------------------------------------------------------------------
  // CITIZENS: 20 per category (+ BMS/labour) submitting real tickets
  // ---------------------------------------------------------------------------------
  const createdTickets = []; // { ticketId, category, subCategory, citizenToken, paymentRequired, deptName }
  const allCategoryKeys = [...Object.keys(CATEGORIES), 'labour'];

  for (const category of allCategoryKeys) {
    const subs = category === 'labour' ? LABOUR_SUBS : CATEGORIES[category];
    const deptName = CATEGORY_DEPARTMENT_MAP[category];
    let categoryOk = 0;
    for (let i = 0; i < USERS_PER_CATEGORY; i++) {
      const gender = category === 'women_safety' ? (i % 2 === 0 ? 'female' : 'male') : undefined;
      const citizen = await registerCitizen(request, app, { gender });
      if (citizen.error) { record('citizen', `${category} user ${i}: register`, false, citizen.error); continue; }
      const subCategory = subs[i % subs.length];

      const body = {
        category, subCategory,
        title: `${subCategory} — sim report ${i}`,
        description: `Simulated citizen report for ${category}/${subCategory}, user #${i}.`,
        locationText: `Ward ${i % 20 + 1}, Sim Town`,
        priority: 'medium',
      };
      if (category === 'labour') {
        body.labourDetails = {
          fullName: `Worker ${i}`,
          organisationName: `Sim Employer ${i}`,
          liveLocation: `22.6${i.toString().padStart(2, '0')}00, 88.4${i.toString().padStart(2, '0')}00`,
          aadharNumber: i % 2 === 0 ? nextAadhar() : undefined,
          voterIdNumber: i % 2 === 0 ? undefined : nextVoterId(),
        };
      }

      const createRes = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizen.token}`).send(body);
      const ok = createRes.status === 201;
      if (!ok) { record('citizen', `${category} user ${i}: create ticket`, false, `status ${createRes.status}: ${JSON.stringify(createRes.body)}`); continue; }
      categoryOk++;

      // Business-rule spot checks
      const expectedExempt = PAYMENT_EXEMPT_GROUPS.includes(category)
        || ['Elder Abuse / Neglect', 'Caste-Based Discrimination', 'Mental Health Crisis'].includes(subCategory)
        || subCategory.includes('Physical or Verbal Abuse by Employer') || subCategory.includes('Bonded / Forced Labour')
        || subCategory.includes('No Safety Gear (Manual Scavenging Risk)');
      const ticket = createRes.body.ticket || createRes.body;
      if (expectedExempt) {
        record('citizen', `${category}/${subCategory}: fee-exempt ticket needs no payment`, ticket.paymentRequired === false, `paymentRequired=${ticket.paymentRequired}`);
      }
      if (subCategory === 'Missing Child' || subCategory === 'Epidemic Alert') {
        record('citizen', `${category}/${subCategory}: auto-critical priority`, ticket.priority === 'critical', `priority=${ticket.priority}`);
      }
      if (category === 'women_safety' && gender === 'female') {
        record('citizen', `women_safety female reporter: auto-critical priority`, ticket.priority === 'critical', `priority=${ticket.priority}`);
      }

      let paymentRequired = ticket.paymentRequired !== false;
      if (paymentRequired) {
        const payRes = await request(app).post('/api/payments/initiate').set('Authorization', `Bearer ${citizen.token}`).send({ ticketId: ticket.ticketId });
        record('citizen', `${category} user ${i}: payment initiate`, payRes.status === 201, `status ${payRes.status}: ${JSON.stringify(payRes.body)}`);
      }
      createdTickets.push({ ticketId: ticket.ticketId, category, subCategory, citizenToken: citizen.token, paymentRequired, deptName });
    }
    origLog(`  citizen phase — ${category}: ${categoryOk}/${USERS_PER_CATEGORY} tickets created`);
  }

  // ---------------------------------------------------------------------------------
  // TEAM LEADERS: confirm payments, assign to member, resolve — per department
  // ---------------------------------------------------------------------------------
  for (const deptName of Object.keys(deptByName)) {
    const leader = leaders[deptName];
    const member = members[deptName];
    const deptTickets = createdTickets.filter((t) => t.deptName === deptName);

    const listRes = await request(app).get('/api/tickets?limit=500').set('Authorization', `Bearer ${leader.token}`);
    record('leader', `${deptName} leader lists tickets`, listRes.status === 200, `status ${listRes.status}`);
    const listedIds = new Set((listRes.body.tickets || []).map((t) => t.id));
    const missingFromList = deptTickets.filter((t) => !listedIds.has(t.ticketId));
    record('leader', `${deptName} leader sees all ${deptTickets.length} of their department's tickets`, missingFromList.length === 0, `missing ${missingFromList.length}`);

    let confirmed = 0, assigned = 0, resolved = 0;
    for (const t of deptTickets) {
      if (t.paymentRequired) {
        const payListRes = await request(app).get('/api/payments?status=pending&limit=500').set('Authorization', `Bearer ${leader.token}`);
        const pay = (payListRes.body.payments || []).find((p) => p.ticket_id === t.ticketId);
        if (pay) {
          const confirmRes = await request(app).post(`/api/payments/${pay.id}/confirm`).set('Authorization', `Bearer ${leader.token}`);
          if (confirmRes.status === 200) confirmed++;
          else record('leader', `${deptName}: confirm payment for ${t.category}/${t.ticketId}`, false, `status ${confirmRes.status}: ${JSON.stringify(confirmRes.body)}`);
        } else {
          record('leader', `${deptName}: find pending payment for ${t.category}/${t.ticketId}`, false, 'not found in pending payments list');
        }
      }

      const assignRes = await request(app).patch(`/api/tickets/${t.ticketId}/assign`).set('Authorization', `Bearer ${leader.token}`).send({ assignedTo: member.id });
      if (assignRes.status === 200) assigned++;
      else record('leader', `${deptName}: assign ${t.category}/${t.ticketId}`, false, `status ${assignRes.status}: ${JSON.stringify(assignRes.body)}`);

      const statusRes = await request(app).patch(`/api/tickets/${t.ticketId}/status`).set('Authorization', `Bearer ${leader.token}`).send({ status: 'resolved', note: 'Resolved by simulated leader.' });
      if (statusRes.status === 200) resolved++;
      else record('leader', `${deptName}: resolve ${t.category}/${t.ticketId}`, false, `status ${statusRes.status}: ${JSON.stringify(statusRes.body)}`);
    }
    origLog(`  leader phase — ${deptName}: ${confirmed} payments confirmed, ${assigned}/${deptTickets.length} assigned, ${resolved}/${deptTickets.length} resolved`);

    // A department task + chat exchange, to exercise teamwork endpoints per role too.
    const taskRes = await request(app).post('/api/teamwork/tasks').set('Authorization', `Bearer ${leader.token}`)
      .send({ title: `${deptName} sim task`, description: 'Simulated follow-up task', assignedTo: member.id, priority: 'medium' });
    record('leader', `${deptName}: leader creates task`, taskRes.status === 201, `status ${taskRes.status}: ${JSON.stringify(taskRes.body)}`);
    if (taskRes.status === 201) {
      const taskId = (taskRes.body.task || taskRes.body).id;
      const memberUpdateRes = await request(app).patch(`/api/teamwork/tasks/${taskId}`).set('Authorization', `Bearer ${member.token}`)
        .send({ status: 'completed', progressNote: 'Done by simulated member.' });
      record('leader', `${deptName}: member completes task`, memberUpdateRes.status === 200, `status ${memberUpdateRes.status}: ${JSON.stringify(memberUpdateRes.body)}`);
    }
    const chatRes = await request(app).post('/api/teamwork/messages').set('Authorization', `Bearer ${leader.token}`).send({ message: `Hello ${deptName} team, from the leader.` });
    record('leader', `${deptName}: leader posts chat message`, chatRes.status === 201, `status ${chatRes.status}: ${JSON.stringify(chatRes.body)}`);
  }

  // ---------------------------------------------------------------------------------
  // ADMIN: cross-department oversight, reassignment, stats, moderation, visits, sub-admin
  // ---------------------------------------------------------------------------------
  const adminTicketsRes = await request(app).get('/api/admin/tickets?limit=1000').set('Authorization', `Bearer ${adminToken}`);
  record('admin', 'admin lists all tickets across departments', adminTicketsRes.status === 200, `status ${adminTicketsRes.status}`);
  const adminSeenIds = new Set((adminTicketsRes.body.tickets || []).map((t) => t.id));
  const notSeenByAdmin = createdTickets.filter((t) => !adminSeenIds.has(t.ticketId));
  record('admin', `admin sees all ${createdTickets.length} tickets created across every category`, notSeenByAdmin.length === 0, `missing ${notSeenByAdmin.length}`);

  // Reassign one ticket per category to a different department, verify it actually moved.
  // PATCH /api/admin/tickets/:id only returns {success, message} — no ticket body — so
  // persistence is verified by re-listing rather than trusting the PATCH response shape.
  for (const category of allCategoryKeys) {
    const t = createdTickets.find((x) => x.category === category);
    if (!t) continue;
    const otherDept = Object.keys(deptByName).find((d) => d !== t.deptName) || t.deptName;
    const reassignRes = await request(app).patch(`/api/admin/tickets/${t.ticketId}`).set('Authorization', `Bearer ${adminToken}`).send({ departmentId: deptByName[otherDept] });
    record('admin', `reassign a ${category} ticket to ${otherDept}`, reassignRes.status === 200, `status ${reassignRes.status}: ${JSON.stringify(reassignRes.body)}`);
    if (reassignRes.status === 200) {
      const relistRes = await request(app).get('/api/admin/tickets?limit=1000').set('Authorization', `Bearer ${adminToken}`);
      const updated = (relistRes.body.tickets || []).find((x) => x.id === t.ticketId);
      record('admin', `reassigned ${category} ticket now shows department_id=${otherDept}`, !!updated && updated.department_id === deptByName[otherDept], `got ${updated && updated.department_id}`);
    }
  }

  const statsRes = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${adminToken}`);
  record('admin', 'admin dashboard stats', statsRes.status === 200, `status ${statsRes.status}`);
  const summaryRes = await request(app).get('/api/teamwork/tasks/summary').set('Authorization', `Bearer ${adminToken}`);
  record('admin', 'admin cross-department task summary', summaryRes.status === 200, `status ${summaryRes.status}`);

  // Community moderation: report + hide a public (non women_safety) ticket.
  const publicTicket = createdTickets.find((t) => t.category === 'infrastructure');
  if (publicTicket) {
    const boardRes = await request(app).get('/api/community/board?limit=500');
    record('admin', 'community board is publicly readable', boardRes.status === 200, `status ${boardRes.status}`);
    const reportRes = await request(app).post(`/api/community/board/${publicTicket.ticketId}/report`)
      .set('Authorization', `Bearer ${publicTicket.citizenToken}`).send({ reason: 'Testing moderation' });
    record('admin', 'citizen reports a community post', reportRes.status === 201 || reportRes.status === 200, `status ${reportRes.status}`);
    const reportsRes = await request(app).get('/api/community/board/reports').set('Authorization', `Bearer ${adminToken}`);
    record('admin', 'admin lists reported posts', reportsRes.status === 200, `status ${reportsRes.status}`);
    const hideRes = await request(app).patch(`/api/community/board/${publicTicket.ticketId}/hide`).set('Authorization', `Bearer ${adminToken}`).send({ hidden: true });
    record('admin', 'admin hides a reported post', hideRes.status === 200, `status ${hideRes.status}`);
  }

  // Office visit: citizen requests, admin schedules.
  const visitCitizen = await registerCitizen(request, app);
  if (!visitCitizen.error) {
    const visitRes = await request(app).post('/api/visits').set('Authorization', `Bearer ${visitCitizen.token}`)
      .send({ visitorName: 'Sim Visitor', contactMobile: visitCitizen.mobile, address: 'Sim Address', reason: 'General enquiry', numberOfPersons: 1 });
    record('admin', 'citizen requests an office visit', visitRes.status === 201, `status ${visitRes.status}: ${JSON.stringify(visitRes.body)}`);
    if (visitRes.status === 201) {
      const visitId = (visitRes.body.visit || visitRes.body).id;
      const scheduleRes = await request(app).patch(`/api/visits/${visitId}/schedule`).set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'scheduled', scheduledTime: '2026-09-01 11:00 AM', adminNote: 'Confirmed by sim admin' });
      record('admin', 'admin schedules the office visit', scheduleRes.status === 200, `status ${scheduleRes.status}: ${JSON.stringify(scheduleRes.body)}`);
    }
  } else {
    record('admin', 'citizen requests an office visit', false, `could not register visitor citizen: ${visitCitizen.error}`);
  }

  // Sub-admin creation + scoping (should be able to manage tickets, NOT the raw DB browser).
  const subAdminRes = await request(app).post('/api/admin/sub-admins').set('Authorization', `Bearer ${adminToken}`)
    .send({ username: 'sim.subadmin', fullName: 'Sim Sub Admin', password: 'SubAdmin@Pass1' });
  record('admin', 'primary admin creates a sub-admin', subAdminRes.status === 201, `status ${subAdminRes.status}: ${JSON.stringify(subAdminRes.body)}`);
  if (subAdminRes.status === 201) {
    const subAdminLogin = await request(app).post('/api/auth/login').send({ username: 'sim.subadmin', password: 'SubAdmin@Pass1' });
    record('admin', 'sub-admin can log in', subAdminLogin.status === 200 && subAdminLogin.body.role === 'admin', `status ${subAdminLogin.status}`);
    const subAdminToken = subAdminLogin.body.accessToken;
    const subAdminTicketsRes = await request(app).get('/api/admin/tickets?limit=10').set('Authorization', `Bearer ${subAdminToken}`);
    record('admin', 'sub-admin can view tickets', subAdminTicketsRes.status === 200, `status ${subAdminTicketsRes.status}`);
    const subAdminDbRes = await request(app).get('/api/admin/db/users').set('Authorization', `Bearer ${subAdminToken}`);
    record('admin', 'sub-admin is BLOCKED from the raw DB browser (primary-admin only)', subAdminDbRes.status === 403, `status ${subAdminDbRes.status}`);
  }

  // Block a citizen, verify they can no longer log in.
  const blockCitizen = await registerCitizen(request, app);
  if (!blockCitizen.error) {
    const blockRes = await request(app).patch(`/api/users/${blockCitizen.user.id}/block`).set('Authorization', `Bearer ${adminToken}`).send({ blocked: true });
    record('admin', 'admin blocks a citizen', blockRes.status === 200, `status ${blockRes.status}: ${JSON.stringify(blockRes.body)}`);
    const blockedLoginRes = await request(app).post('/api/auth/login').send({ mobile: blockCitizen.mobile, password: 'Citizen@Pass1' });
    record('admin', 'blocked citizen cannot log in', blockedLoginRes.status === 401, `status ${blockedLoginRes.status}`);
  } else {
    record('admin', 'admin blocks a citizen', false, `could not register citizen to block: ${blockCitizen.error}`);
  }

  // ---------------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------------
  origLog('\n=== SIMULATION SUMMARY ===');
  const byArea = {};
  for (const r of results) {
    byArea[r.area] = byArea[r.area] || { pass: 0, fail: 0 };
    byArea[r.area][r.ok ? 'pass' : 'fail']++;
  }
  for (const area of Object.keys(byArea)) {
    origLog(`  ${area}: ${byArea[area].pass} passed, ${byArea[area].fail} failed`);
  }
  const failures = results.filter((r) => !r.ok);
  origLog(`\nTotal checks: ${results.length} | Passed: ${results.length - failures.length} | Failed: ${failures.length}`);
  if (failures.length) {
    origLog('\n=== FAILURES (bugs to investigate) ===');
    failures.forEach((f, i) => origLog(`${i + 1}. [${f.area}] ${f.name}\n   ${f.detail}`));
    process.exitCode = 1;
  } else {
    origLog('\nAll checks passed.');
  }
}

main().catch((err) => {
  origLog('FATAL simulation error:', err.stack || err.message);
  process.exitCode = 1;
});
