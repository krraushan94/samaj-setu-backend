const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { adminToken } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

describe('PATCH /api/admin/change-password', () => {
  it('rejects a new password under 8 characters', async () => {
    const res = await request(app).patch('/api/admin/change-password')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ currentPassword: 'whatever', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('rejects an incorrect current password when a DB row exists', async () => {
    const bcrypt = require('bcryptjs');
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: await bcrypt.hash('the-real-one', 10) }] });
    const res = await request(app).patch('/api/admin/change-password')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ currentPassword: 'wrong-guess', newPassword: 'NewSecurePass1' });
    expect(res.status).toBe(401);
  });
});

describe('sub-admin management edge cases', () => {
  it('rejects a sub-admin password reset under 8 characters', async () => {
    const res = await request(app).patch('/api/admin/sub-admins/sub-1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('refuses to delete the primary admin account', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ username: 'Admin_Raushan' }] });
    const res = await request(app).delete('/api/admin/sub-admins/whatever-id')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(403);
  });
});

describe('App Settings CRUD', () => {
  it('lists settings', async () => {
    mockQuery.mockResolvedValue({ rows: [{ key: 'ticket_fee', value: '50' }] });
    const res = await request(app).get('/api/admin/settings').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  it('rejects creating a setting with no key', async () => {
    const res = await request(app).post('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken()}`).send({ value: '50' });
    expect(res.status).toBe(400);
  });

  it('creates a setting', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).post('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken()}`).send({ key: 'new_flag', value: 'true' });
    expect(res.status).toBe(201);
  });

  it('updates a setting by key', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).patch('/api/admin/settings/ticket_fee')
      .set('Authorization', `Bearer ${adminToken()}`).send({ value: '75' });
    expect(res.status).toBe(200);
  });

  it('deletes a setting', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).delete('/api/admin/settings/old_flag')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});

describe('Issue Categories CRUD', () => {
  it('lists categories publicly with nested sub-categories', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ key: 'infrastructure', label: 'Infrastructure' }] })
      .mockResolvedValueOnce({ rows: [{ category_key: 'infrastructure', label: 'Pothole' }] });
    const res = await request(app).get('/api/admin/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories[0].sub_categories).toHaveLength(1);
  });

  it('updates a sub-category', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).patch('/api/admin/categories/sub/sub-1')
      .set('Authorization', `Bearer ${adminToken()}`).send({ label: 'Renamed' });
    expect(res.status).toBe(200);
  });

  it('deactivates a sub-category', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).delete('/api/admin/categories/sub/sub-1')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});

describe('Department CRUD (admin)', () => {
  it('rejects creating a department with no name', async () => {
    const res = await request(app).post('/api/admin/departments')
      .set('Authorization', `Bearer ${adminToken()}`).send({});
    expect(res.status).toBe(400);
  });

  it('creates a department', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).post('/api/admin/departments')
      .set('Authorization', `Bearer ${adminToken()}`).send({ name: 'BMS' });
    expect(res.status).toBe(201);
  });

  it('renames a department', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).patch('/api/admin/departments/dept-uuid-1')
      .set('Authorization', `Bearer ${adminToken()}`).send({ name: 'BMS Renamed' });
    expect(res.status).toBe(200);
  });
});

describe('team-members admin edit', () => {
  it('rejects a password reset under 8 characters', async () => {
    const res = await request(app).patch('/api/admin/team-members/team-1')
      .set('Authorization', `Bearer ${adminToken()}`).send({ newPassword: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('Events CRUD (admin edit/delete)', () => {
  it('updates an event', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).patch('/api/admin/events/evt-1')
      .set('Authorization', `Bearer ${adminToken()}`).send({ title: 'Renamed Event' });
    expect(res.status).toBe(200);
  });

  it('deletes an event', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).delete('/api/admin/events/evt-1')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});
