const { mockQuery } = require('./helpers/dbMock');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());
jest.mock('axios');
const axios = require('axios');

const { notifyCitizen, notifyTeamMember, notifyDepartment } = require('../src/utils/notify');

beforeEach(() => {
  mockQuery.mockReset();
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: {} });
});

describe('notifyCitizen', () => {
  it('inserts the in-app notification and pushes when a push_token is on file', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                   // INSERT INTO notifications
      .mockResolvedValueOnce({ rows: [{ push_token: 'ExponentPushToken[c1]' }] }); // SELECT push_token FROM users
    await notifyCitizen('citizen-1', 'Ticket resolved', 'Your issue was fixed', 'status_change', { entityType: 'ticket', entityId: 'ticket-1' });

    const insertCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO notifications'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toEqual(expect.arrayContaining(['citizen-1', 'citizen', 'Ticket resolved', 'Your issue was fixed', 'status_change', 'ticket', 'ticket-1']));

    expect(axios.post).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/send',
      expect.objectContaining({ to: 'ExponentPushToken[c1]', title: 'Ticket resolved', body: 'Your issue was fixed' }),
      expect.any(Object)
    );
  });

  it('does not push when the citizen has no push_token on file', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ push_token: null }] });
    await notifyCitizen('citizen-1', 'Title', 'Body', 'general');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('does not throw when the DB insert fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(notifyCitizen('citizen-1', 'Title', 'Body', 'general')).resolves.toBeUndefined();
  });

  it('does not throw when the push lookup fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('db down'));
    await expect(notifyCitizen('citizen-1', 'Title', 'Body', 'general')).resolves.toBeUndefined();
  });
});

describe('notifyTeamMember', () => {
  it('looks up the token in team_members, not users', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ push_token: 'ExponentPushToken[t1]' }] });
    await notifyTeamMember('member-1', 'New task assigned', 'Fix the pothole', 'task');
    const lookupCall = mockQuery.mock.calls.find((c) => c[0].includes('SELECT push_token'));
    expect(lookupCall[0]).toContain('team_members');
    expect(axios.post).toHaveBeenCalled();
  });
});

describe('notifyDepartment', () => {
  it('notifies every active member of the department', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'member-1' }, { id: 'member-2' }] }) // active members
      .mockResolvedValue({ rows: [] }); // every subsequent insert/lookup call
    await notifyDepartment('dept-1', 'SOS', 'Emergency', 'sos');
    const inserts = mockQuery.mock.calls.filter((c) => c[0].includes('INSERT INTO notifications'));
    expect(inserts).toHaveLength(2);
  });

  it('is a no-op when departmentId is falsy', async () => {
    await notifyDepartment(null, 'Title', 'Body', 'general');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
