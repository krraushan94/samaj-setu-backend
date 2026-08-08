const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { citizenToken, leaderToken, adminToken, memberToken } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

// ─── Create Task ────────────────────────────────────────────────────────────────
describe('POST /api/teamwork/tasks', () => {
  it('leader creates an unassigned task in their own department', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'task-1', title: 'Fix drainage', department_id: 'dept-uuid-1' }] });
    const res = await request(app).post('/api/teamwork/tasks')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ title: 'Fix drainage' });
    expect(res.status).toBe(201);
    expect(res.body.task.title).toBe('Fix drainage');
    // department_id came from the token, not the (absent) request body
    expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['dept-uuid-1']));
  });

  it('leader assigns a task to a member in their own department and notifies them', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ full_name: 'Team Member', department_id: 'dept-uuid-1' }] }) // assignee lookup
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', title: 'Fix drainage', assigned_to: 'team-uuid-2' }] }) // insert
      .mockResolvedValueOnce({ rows: [] }); // notification insert
    const res = await request(app).post('/api/teamwork/tasks')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ title: 'Fix drainage', assignedTo: 'team-uuid-2', dueDate: '2026-08-20' });
    expect(res.status).toBe(201);
    const notifyInsert = mockQuery.mock.calls.find(c => c[0].includes('INSERT INTO notifications'));
    expect(notifyInsert[1]).toEqual(expect.arrayContaining(['team-uuid-2', 'team_member']));
  });

  it('rejects assigning to a member in a different department', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ full_name: 'Someone Else', department_id: 'OTHER-DEPT' }] });
    const res = await request(app).post('/api/teamwork/tasks')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ title: 'Fix drainage', assignedTo: 'team-uuid-99' });
    expect(res.status).toBe(400);
  });

  it('admin must specify departmentId', async () => {
    const res = await request(app).post('/api/teamwork/tasks')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ title: 'Cross-team task' });
    expect(res.status).toBe(400);
  });

  it('admin creates a task in a specified department', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'task-1', title: 'Cross-team task', department_id: 'dept-uuid-2' }] });
    const res = await request(app).post('/api/teamwork/tasks')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ title: 'Cross-team task', departmentId: 'dept-uuid-2' });
    expect(res.status).toBe(201);
  });

  it('member cannot create tasks', async () => {
    const res = await request(app).post('/api/teamwork/tasks')
      .set('Authorization', `Bearer ${memberToken()}`)
      .send({ title: 'Should fail' });
    expect(res.status).toBe(403);
  });

  it('rejects a missing title', async () => {
    const res = await request(app).post('/api/teamwork/tasks')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ title: '' });
    expect(res.status).toBe(400);
  });

  it('citizen has no access at all', async () => {
    const res = await request(app).post('/api/teamwork/tasks')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ title: 'x' });
    expect(res.status).toBe(403);
  });
});

// ─── List Tasks ─────────────────────────────────────────────────────────────────
describe('GET /api/teamwork/tasks', () => {
  it("scopes a leader's list to their own department automatically", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/teamwork/tasks').set('Authorization', `Bearer ${leaderToken()}`);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['dept-uuid-1']);
  });

  it('lets admin see every department when no departmentId is given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/teamwork/tasks').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual([]);
  });

  it('lets admin filter to one department via query param', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/teamwork/tasks?departmentId=dept-uuid-2').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['dept-uuid-2']);
  });
});

// ─── Update Task ────────────────────────────────────────────────────────────────
describe('PATCH /api/teamwork/tasks/:id', () => {
  it('member can update the status of a task assigned to them', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', department_id: 'dept-uuid-1', assigned_to: 'team-uuid-2', title: 'Fix drainage', created_by: 'team-uuid-1', created_by_role: 'leader' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', status: 'in_progress' }] });
    const res = await request(app).patch('/api/teamwork/tasks/task-1')
      .set('Authorization', `Bearer ${memberToken()}`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.task.status).toBe('in_progress');
  });

  it('notifies the creating leader when a member completes their task', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', department_id: 'dept-uuid-1', assigned_to: 'team-uuid-2', title: 'Fix drainage', created_by: 'team-uuid-1', created_by_role: 'leader' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', status: 'completed', title: 'Fix drainage' }] })
      .mockResolvedValueOnce({ rows: [] }); // notification insert
    const res = await request(app).patch('/api/teamwork/tasks/task-1')
      .set('Authorization', `Bearer ${memberToken()}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    const notifyInsert = mockQuery.mock.calls.find(c => c[0].includes('INSERT INTO notifications'));
    expect(notifyInsert[1]).toEqual(expect.arrayContaining(['team-uuid-1', 'team_member']));
  });

  it('member cannot update a task not assigned to them', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'task-1', department_id: 'dept-uuid-1', assigned_to: 'SOMEONE-ELSE' }] });
    const res = await request(app).patch('/api/teamwork/tasks/task-1')
      .set('Authorization', `Bearer ${memberToken()}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(403);
  });

  it('leader can reassign and edit a task in their own department', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', department_id: 'dept-uuid-1', assigned_to: 'team-uuid-2', title: 'Fix drainage' }] })
      .mockResolvedValueOnce({ rows: [{ full_name: 'New Assignee', department_id: 'dept-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', title: 'Fix drainage urgently', assigned_to: 'team-uuid-3' }] })
      .mockResolvedValueOnce({ rows: [] }); // notification insert
    const res = await request(app).patch('/api/teamwork/tasks/task-1')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ title: 'Fix drainage urgently', assignedTo: 'team-uuid-3' });
    expect(res.status).toBe(200);
    expect(res.body.task.assigned_to).toBe('team-uuid-3');
  });

  it('leader cannot update a task from another department', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'task-1', department_id: 'OTHER-DEPT' }] });
    const res = await request(app).patch('/api/teamwork/tasks/task-1')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent task', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/api/teamwork/tasks/nope')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(404);
  });

  it('admin can update a task in any department', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', department_id: 'dept-uuid-9', title: 'x' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', status: 'in_progress' }] });
    const res = await request(app).patch('/api/teamwork/tasks/task-1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
  });
});

// ─── Task Summary ───────────────────────────────────────────────────────────────
describe('GET /api/teamwork/tasks/summary', () => {
  it('admin gets a cross-department breakdown', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ department_name: 'Social Welfare', status: 'pending', count: '3' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const res = await request(app).get('/api/teamwork/tasks/summary').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.byStatus).toHaveLength(1);
    expect(res.body.overdueCount).toBe(1);
  });

  it('team leader cannot access the cross-department summary', async () => {
    const res = await request(app).get('/api/teamwork/tasks/summary').set('Authorization', `Bearer ${leaderToken()}`);
    expect(res.status).toBe(403);
  });
});

// ─── Chat ───────────────────────────────────────────────────────────────────────
describe('GET /api/teamwork/messages', () => {
  it("lists a leader's own department chat", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'm1', message: 'hello team' }] });
    const res = await request(app).get('/api/teamwork/messages').set('Authorization', `Bearer ${leaderToken()}`);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['dept-uuid-1']);
  });

  it('requires admin to specify a department', async () => {
    const res = await request(app).get('/api/teamwork/messages').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
  });

  it('lets admin read a specific department chat', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/teamwork/messages?departmentId=dept-uuid-2').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  it('citizen has no access', async () => {
    const res = await request(app).get('/api/teamwork/messages').set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/teamwork/messages', () => {
  it('member posts a message to their own department chat', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'm1', message: 'On my way to the site', sender_name: 'team_member1' }] });
    const res = await request(app).post('/api/teamwork/messages')
      .set('Authorization', `Bearer ${memberToken()}`)
      .send({ message: 'On my way to the site' });
    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['dept-uuid-1', 'member']));
  });

  it('rejects an empty message', async () => {
    const res = await request(app).post('/api/teamwork/messages')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ message: '   ' });
    expect(res.status).toBe(400);
  });

  it('admin posts to a specific department chat', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'm1', message: 'Reminder: submit weekly report' }] });
    const res = await request(app).post('/api/teamwork/messages')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ message: 'Reminder: submit weekly report', departmentId: 'dept-uuid-1' });
    expect(res.status).toBe(201);
  });
});
