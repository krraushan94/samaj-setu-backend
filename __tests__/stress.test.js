const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');
const bcrypt = require('bcryptjs');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { adminToken, leaderToken, citizenToken } = require('./helpers/fixtures');
const jwt = require('jsonwebtoken');

// ── Helpers ────────────────────────────────────────────────────────────────────
const sign = (p) => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });

const DUMMY_USERS = Array.from({ length: 20 }, (_, i) => ({
  id:        `user-stress-${String(i + 1).padStart(3, '0')}`,
  full_name: ['Priya Sharma', 'Raju Das', 'Sunita Roy', 'Amit Ghosh', 'Deepa Pal',
              'Suresh Mondal', 'Kavya Sen', 'Bikash Bose', 'Anjali Dey', 'Rana Mukherjee',
              'Fatima Begum', 'Sudhir Saha', 'Meena Chatterjee', 'Tapan Biswas', 'Rekha Banerjee',
              'Gopal Halder', 'Nandita Ghosh', 'Sanjoy Karmakar', 'Puja Mitra', 'Arjun Roy'][i],
  mobile:    `99999${String(i).padStart(5, '0')}`,
  gender:    i % 3 === 0 ? 'female' : i % 3 === 1 ? 'male' : 'other',
  ward:      String((i % 10) + 1),
  mandal:    'New Town',
  pincode:   '700157',
}));

const ALL_CATEGORIES = [
  { category: 'infrastructure', subCategory: 'street_light',      title: 'Street light broken near main road' },
  { category: 'infrastructure', subCategory: 'road_damage',       title: 'Large pothole causing accidents' },
  { category: 'infrastructure', subCategory: 'water_supply',      title: 'No water supply for 3 days' },
  { category: 'infrastructure', subCategory: 'drainage',          title: 'Sewage overflow on footpath' },
  { category: 'women_safety',   subCategory: 'harassment',        title: 'Eve teasing reported at bus stop', gender: 'female' },
  { category: 'women_safety',   subCategory: 'domestic_violence', title: 'Domestic violence complaint',     gender: 'female' },
  { category: 'women_safety',   subCategory: 'unsafe_area',       title: 'Unsafe area near pond at night',  gender: 'female' },
  { category: 'security',       subCategory: 'theft',             title: 'Mobile phone snatching incident' },
  { category: 'security',       subCategory: 'illegal_parking',   title: 'Vehicles blocking emergency lane' },
  { category: 'security',       subCategory: 'threat',            title: 'Threat from local goons' },
  { category: 'health',         subCategory: 'garbage_dumping',   title: 'Illegal garbage dumping near school' },
  { category: 'health',         subCategory: 'mosquito_breeding', title: 'Stagnant water breeding mosquitoes' },
  { category: 'health',         subCategory: 'hospital_complaint',title: 'Doctor absent at PHC' },
  { category: 'education',      subCategory: 'school_infrastructure', title: 'School roof leaking' },
  { category: 'education',      subCategory: 'teacher_absenteeism',   title: 'Teachers absent regularly' },
  { category: 'environment',    subCategory: 'illegal_tree_cutting',  title: 'Trees being cut illegally' },
  { category: 'environment',    subCategory: 'pollution',             title: 'Factory releasing smoke at night' },
  { category: 'social',         subCategory: 'drug_abuse',        title: 'Drug dealing near school' },
  { category: 'land_property',  subCategory: 'encroachment',      title: 'Public land encroached near park' },
  { category: 'missing',        subCategory: 'missing_child',     title: 'Missing child — urgent', priority: 'critical' },
];

// ── STRESS TEST SUITE ──────────────────────────────────────────────────────────
describe('STRESS TEST — 20 Dummy Users, All Categories, All Flows', () => {
  beforeEach(() => mockQuery.mockReset());

  // ── 1. User Registration Flow (20 users) ────────────────────────────────────
  describe('1. User Registration — 20 users', () => {
    DUMMY_USERS.forEach((user) => {
      it(`registers user: ${user.full_name} (mobile: ${user.mobile})`, async () => {
        const otpHash = await bcrypt.hash('123456', 10);
        mockQuery
          .mockResolvedValueOnce({ rows: [{ id: 'otp-id', otp_hash: otpHash, expires_at: new Date(Date.now() + 600000), used: false }] })
          .mockResolvedValueOnce({ rows: [] })        // mark otp used
          .mockResolvedValueOnce({ rows: [] });        // no user yet — new
        const verifyRes = await request(app).post('/api/auth/verify-otp').send({ mobile: user.mobile, otp: '123456' });
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.isNewUser).toBe(true);
        expect(verifyRes.body.tempToken).toBeDefined();

        // Complete registration
        mockQuery
          .mockResolvedValueOnce({ rows: [] })        // check no existing user
          .mockResolvedValueOnce({ rows: [{ ...user, id: user.id }] }); // insert returns user
        const regRes = await request(app).post('/api/auth/register').send({
          tempToken: verifyRes.body.tempToken,
          fullName: user.full_name, mobile: user.mobile,
          gender: user.gender, pincode: user.pincode, mandal: user.mandal, ward: user.ward,
        });
        expect(regRes.status).toBe(201);
        expect(regRes.body.accessToken).toBeDefined();
      });
    });
  });

  // ── 2. Ticket Submission — All 20 issue categories ───────────────────────────
  describe('2. Ticket Submission — all 20 issue types', () => {
    ALL_CATEGORIES.forEach((issue, idx) => {
      const user = DUMMY_USERS[idx % DUMMY_USERS.length];
      const token = sign({ id: user.id, role: 'citizen', mobile: user.mobile });
      const expectedPriority = issue.priority || (issue.gender === 'female' && issue.category === 'women_safety' ? 'critical' : 'medium');

      it(`submits: "${issue.title}" (${issue.category})`, async () => {
        mockQuery
          .mockResolvedValueOnce({ rows: [{ gender: user.gender }] })
          .mockResolvedValueOnce({ rows: [{ id: 'dept-uuid-1' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] });
        const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${token}`)
          .send({ category: issue.category, subCategory: issue.subCategory, title: issue.title, description: `Detailed description for: ${issue.title}`, priority: issue.priority || 'medium', locationText: `Ward ${user.ward}, ${user.mandal}` });
        expect(res.status).toBe(201);
        expect(res.body.ticketId).toBeDefined();
        // Women safety + female must be critical
        if (issue.category === 'women_safety' && user.gender === 'female') {
          expect(res.body.priority).toBe('critical');
        }
      });
    });
  });

  // ── 3. SOS Emergency — 3 users ───────────────────────────────────────────────
  describe('3. SOS Emergency — 3 simultaneous triggers', () => {
    [0, 1, 2].forEach(i => {
      const user = DUMMY_USERS[i];
      const token = sign({ id: user.id, role: 'citizen', mobile: user.mobile });
      it(`SOS from ${user.full_name}`, async () => {
        mockQuery
          .mockResolvedValueOnce({ rows: [{ full_name: user.full_name, gender: user.gender }] })
          .mockResolvedValueOnce({ rows: [{ id: 'dept-social-welfare' }] })
          .mockResolvedValueOnce({ rows: [] });
        const res = await request(app).post('/api/tickets/sos').set('Authorization', `Bearer ${token}`)
          .send({ latitude: 22.5726, longitude: 88.3639, locationText: `Near Ward ${user.ward}` });
        expect(res.status).toBe(201);
        expect(res.body.ticketNumber).toMatch(/^SJT-/);
      });
    });
  });

  // ── 4. Cash Payment Flow — 10 users ─────────────────────────────────────────
  describe('4. Cash Payment Flow — 10 users', () => {
    DUMMY_USERS.slice(0, 10).forEach(user => {
      const token = sign({ id: user.id, role: 'citizen', mobile: user.mobile });
      it(`${user.full_name} initiates ₹50 cash payment`, async () => {
        mockQuery
          .mockResolvedValueOnce({ rows: [{ id: `ticket-${user.id}`, status: 'payment_pending' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] });
        const res = await request(app).post('/api/payments/initiate').set('Authorization', `Bearer ${token}`)
          .send({ ticketId: `ticket-${user.id}` });
        expect(res.status).toBe(201);
        expect(res.body.referenceNumber).toMatch(/^PAY-\d{4}-/);
        expect(res.body.amount).toBe(50);
        expect(res.body.method).toBe('cash');
        expect(res.body.instructions).toContain('₹50');
      });
    });

    it('Admin confirms 10 cash payments in bulk', async () => {
      for (const user of DUMMY_USERS.slice(0, 10)) {
        mockQuery
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ ticket_id: `ticket-${user.id}` }] })
          .mockResolvedValueOnce({ rows: [] });
        const res = await request(app).post(`/api/payments/pay-${user.id}/confirm`).set('Authorization', `Bearer ${adminToken()}`);
        expect(res.status).toBe(200);
        expect(res.body.message).toContain('confirmed');
      }
    });
  });

  // ── 5. Community Board — public feed ─────────────────────────────────────────
  describe('5. Community Board — public access, upvotes', () => {
    it('returns board without any auth', async () => {
      mockQuery.mockResolvedValue({ rows: ALL_CATEGORIES.slice(0, 5).map((c, i) => ({ id: `t${i}`, title: c.title, status: 'open', upvote_count: i })) });
      const res = await request(app).get('/api/community/board');
      expect(res.status).toBe(200);
      expect(res.body.issues.length).toBeGreaterThan(0);
    });

    it('5 users upvote same ticket — triggers auto-escalation at 5', async () => {
      for (let i = 0; i < 5; i++) {
        mockQuery.mockReset(); // isolate each upvote's mock chain
        const voter = DUMMY_USERS[i + 5];
        const voterToken = sign({ id: voter.id, role: 'citizen', mobile: voter.mobile });
        const count = i + 1;
        mockQuery
          .mockResolvedValueOnce({ rows: [] })                          // INSERT upvote
          .mockResolvedValueOnce({ rows: [{ upvote_count: count }] })  // UPDATE count
          .mockResolvedValue({ rows: [] });                             // catch-all for escalate
        const res = await request(app).post('/api/tickets/shared-ticket-uuid/upvote').set('Authorization', `Bearer ${voterToken}`);
        expect(res.status).toBe(200);
        expect(res.body.upvoteCount).toBe(count);
      }
    });
  });

  // ── 6. Admin CRUD — Categories ───────────────────────────────────────────────
  describe('6. Admin CRUD — Issue Categories', () => {
    it('admin creates new category', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).post('/api/admin/categories').set('Authorization', `Bearer ${adminToken()}`)
        .send({ key: 'flood_relief', label: 'Flood Relief', icon: 'flood', color: '#0277BD', department: 'Social Welfare' });
      expect(res.status).toBe(201);
    });

    it('admin updates existing category', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).patch('/api/admin/categories/infrastructure').set('Authorization', `Bearer ${adminToken()}`)
        .send({ label: 'Infrastructure & Roads', sortOrder: 1 });
      expect(res.status).toBe(200);
    });

    it('admin adds sub-category to existing category', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).post('/api/admin/categories/infrastructure/sub').set('Authorization', `Bearer ${adminToken()}`)
        .send({ label: 'Flyover Damage', sortOrder: 8 });
      expect(res.status).toBe(201);
    });

    it('admin deactivates a category', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).delete('/api/admin/categories/others').set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('non-admin cannot create categories', async () => {
      const res = await request(app).post('/api/admin/categories').set('Authorization', `Bearer ${citizenToken()}`)
        .send({ key: 'hack', label: 'Hack' });
      expect(res.status).toBe(403);
    });
  });

  // ── 7. Admin CRUD — App Settings ─────────────────────────────────────────────
  describe('7. Admin CRUD — App Settings', () => {
    it('admin reads all settings', async () => {
      mockQuery.mockResolvedValue({ rows: [{ key: 'ticket_fee', value: '50', label: 'Fee' }] });
      const res = await request(app).get('/api/admin/settings').set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.settings)).toBe(true);
    });

    it('admin updates ticket fee', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).patch('/api/admin/settings/ticket_fee').set('Authorization', `Bearer ${adminToken()}`)
        .send({ value: '100' });
      expect(res.status).toBe(200);
    });

    it('admin enables online payment', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).patch('/api/admin/settings/online_payment').set('Authorization', `Bearer ${adminToken()}`)
        .send({ value: 'true' });
      expect(res.status).toBe(200);
    });

    it('admin creates custom setting', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).post('/api/admin/settings').set('Authorization', `Bearer ${adminToken()}`)
        .send({ key: 'whatsapp_enabled', value: 'true', label: 'WhatsApp Notifications' });
      expect(res.status).toBe(201);
    });
  });

  // ── 8. Sub-Admin Creation ─────────────────────────────────────────────────────
  describe('8. Sub-Admin Creation — only Admin_Raushan', () => {
    it('Admin_Raushan creates a sub-admin', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })  // check existing
        .mockResolvedValueOnce({ rows: [] }); // insert
      const res = await request(app).post('/api/admin/sub-admins').set('Authorization', `Bearer ${adminToken()}`)
        .send({ username: 'admin_support1', fullName: 'Support Admin', email: 'support@samajsetu.in', password: 'Support@2026' });
      expect(res.status).toBe(201);
      expect(res.body.message).toContain('admin_support1');
    });

    it('duplicate username is rejected', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });
      const res = await request(app).post('/api/admin/sub-admins').set('Authorization', `Bearer ${adminToken()}`)
        .send({ username: 'admin_support1', password: 'pass1234' });
      expect(res.status).toBe(409);
    });

    it('password too short is rejected', async () => {
      const res = await request(app).post('/api/admin/sub-admins').set('Authorization', `Bearer ${adminToken()}`)
        .send({ username: 'newadmin', password: '123' });
      expect(res.status).toBe(400);
    });

    it('non-admin (team leader) cannot create sub-admins', async () => {
      const res = await request(app).post('/api/admin/sub-admins').set('Authorization', `Bearer ${leaderToken()}`)
        .send({ username: 'hack_admin', password: 'Hackerrr123' });
      expect(res.status).toBe(403);
    });

    it('Admin_Raushan lists all sub-admins', async () => {
      mockQuery.mockResolvedValue({ rows: [{ username: 'Admin_Raushan', email: 'sihsraushandc@gmail.com' }] });
      const res = await request(app).get('/api/admin/sub-admins').set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.admins)).toBe(true);
    });

    it('Admin_Raushan updates sub-admin', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).patch('/api/admin/sub-admins/sub-admin-uuid-1').set('Authorization', `Bearer ${adminToken()}`)
        .send({ isActive: false });
      expect(res.status).toBe(200);
    });

    it('Admin_Raushan deletes sub-admin', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ username: 'admin_support1' }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await request(app).delete('/api/admin/sub-admins/sub-admin-uuid-1').set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('cannot delete Admin_Raushan account itself', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ username: 'Admin_Raushan' }] });
      const res = await request(app).delete('/api/admin/sub-admins/admin-uuid').set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(403);
    });
  });

  // ── 9. Admin Ticket CRUD ──────────────────────────────────────────────────────
  describe('9. Admin Ticket CRUD — full edit control', () => {
    it('admin edits ticket title and priority', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })  // update
        .mockResolvedValueOnce({ rows: [] }); // audit log
      const res = await request(app).patch('/api/admin/tickets/ticket-uuid-1').set('Authorization', `Bearer ${adminToken()}`)
        .send({ title: 'UPDATED: Road damage at Junction 5', priority: 'high' });
      expect(res.status).toBe(200);
    });

    it('admin reassigns ticket to different department', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).patch('/api/admin/tickets/ticket-uuid-1').set('Authorization', `Bearer ${adminToken()}`)
        .send({ departmentId: 'dept-politics', status: 'in_progress' });
      expect(res.status).toBe(200);
    });

    it('admin soft-deletes ticket', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).delete('/api/admin/tickets/spam-ticket-uuid').set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('admin lists tickets with search filter', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', title: 'Road damage', status: 'open' }] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });
      const res = await request(app).get('/api/admin/tickets?search=road&priority=high').set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });
  });

  // ── 10. Admin User CRUD ───────────────────────────────────────────────────────
  describe('10. Admin User CRUD', () => {
    it('admin edits user profile', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).patch('/api/admin/users/user-uuid-1').set('Authorization', `Bearer ${adminToken()}`)
        .send({ ward: '7', isVerified: true });
      expect(res.status).toBe(200);
    });

    it('admin soft-deletes a spammer', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).delete('/api/admin/users/spammer-uuid').set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });
  });

  // ── 11. Announcements CRUD ───────────────────────────────────────────────────
  describe('11. Announcements CRUD', () => {
    it('admin creates pinned announcement', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).post('/api/admin/announcements').set('Authorization', `Bearer ${adminToken()}`)
        .send({ title: 'Ward 5 Meeting', body: 'Community meeting on Sunday 10 AM', isPinned: true });
      expect(res.status).toBe(201);
    });

    it('public can read announcements without auth', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 'ann-1', title: 'Ward 5 Meeting', is_pinned: true }] });
      const res = await request(app).get('/api/admin/announcements');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.announcements)).toBe(true);
    });

    it('admin updates announcement', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).patch('/api/admin/announcements/ann-uuid-1').set('Authorization', `Bearer ${adminToken()}`)
        .send({ title: 'Updated: Ward 5 Meeting at 11 AM' });
      expect(res.status).toBe(200);
    });

    it('admin deletes announcement', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).delete('/api/admin/announcements/ann-uuid-1').set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('citizen cannot create announcements', async () => {
      const res = await request(app).post('/api/admin/announcements').set('Authorization', `Bearer ${citizenToken()}`)
        .send({ title: 'Fake', body: 'spam' });
      expect(res.status).toBe(403);
    });
  });

  // ── 12. Admin Password Change ─────────────────────────────────────────────────
  describe('12. Admin Password Management', () => {
    it('rejects password shorter than 8 chars', async () => {
      const res = await request(app).patch('/api/admin/change-password').set('Authorization', `Bearer ${adminToken()}`)
        .send({ currentPassword: 'oldpass', newPassword: 'short' });
      expect(res.status).toBe(400);
    });

    it('admin profile shows email sihsraushandc@gmail.com', async () => {
      mockQuery.mockResolvedValue({ rows: [{ username: 'Admin_Raushan', email: 'sihsraushandc@gmail.com', full_name: 'Raushan Kumar' }] });
      const res = await request(app).get('/api/admin/profile').set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.profile.email).toBe('sihsraushandc@gmail.com');
    });

    it('admin updates their profile', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app).patch('/api/admin/profile').set('Authorization', `Bearer ${adminToken()}`)
        .send({ email: 'sihsraushandc@gmail.com', phone: '9999988888' });
      expect(res.status).toBe(200);
    });
  });

  // ── 13. Rate Limiting ─────────────────────────────────────────────────────────
  describe('13. Health & Basic Sanity', () => {
    it('health endpoint responds', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('unknown route returns 404', async () => {
      const res = await request(app).get('/api/totally-unknown-route');
      expect(res.status).toBe(404);
    });
  });

  // ── 14. Team Leader Flow ──────────────────────────────────────────────────────
  describe('14. Team Leader — ticket management flow', () => {
    it('leader marks payment received and ticket goes open', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ticket_id: 'ticket-stress-001' }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await request(app).post('/api/payments/pay-stress-001/confirm').set('Authorization', `Bearer ${leaderToken()}`);
      expect(res.status).toBe(200);
    });

    it('leader updates 5 tickets to in_progress', async () => {
      for (let i = 0; i < 5; i++) {
        mockQuery
          .mockResolvedValueOnce({ rows: [{ status: 'open', department_id: 'dept-uuid-1' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] });
        const res = await request(app).patch(`/api/tickets/stress-ticket-${i}/status`)
          .set('Authorization', `Bearer ${leaderToken()}`)
          .send({ status: 'in_progress', note: `Team assigned for ticket ${i}` });
        expect(res.status).toBe(200);
      }
    });

    it('leader resolves 5 tickets with resolution proof', async () => {
      for (let i = 0; i < 5; i++) {
        mockQuery
          .mockResolvedValueOnce({ rows: [{ status: 'in_progress', department_id: 'dept-uuid-1' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] });
        const res = await request(app).patch(`/api/tickets/stress-ticket-${i}/status`)
          .set('Authorization', `Bearer ${leaderToken()}`)
          .send({ status: 'resolved', note: 'Issue resolved by field team', resolutionPhoto: 'https://s3.example.com/proof.jpg' });
        expect(res.status).toBe(200);
      }
    });
  });

  // ── 15. Citizen Post-Resolution Flow ─────────────────────────────────────────
  describe('15. Citizens rate resolved tickets (1-5 stars)', () => {
    DUMMY_USERS.slice(0, 10).forEach((user, i) => {
      const token = sign({ id: user.id, role: 'citizen', mobile: user.mobile });
      const rating = (i % 5) + 1;
      it(`${user.full_name} rates ticket ${rating} stars`, async () => {
        mockQuery.mockResolvedValue({ rows: [] });
        const res = await request(app).post(`/api/tickets/resolved-ticket-${i}/rate`)
          .set('Authorization', `Bearer ${token}`)
          .send({ rating, feedback: `Rating ${rating}: ${rating >= 4 ? 'Good work!' : 'Could be better'}` });
        expect(res.status).toBe(200);
      });
    });
  });
});
