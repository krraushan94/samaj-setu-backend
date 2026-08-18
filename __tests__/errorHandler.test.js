const { errorHandler, asyncHandler } = require('../src/middleware/errorHandler');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('errorHandler', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = originalEnv; });
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => console.error.mockRestore());

  it('translates a Postgres unique-violation into a clean 409', () => {
    const res = mockRes();
    errorHandler({ code: '23505', message: 'duplicate key value violates unique constraint "users_mobile_key"' }, {}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'That value is already in use.' });
  });

  it('translates a Postgres foreign-key-violation into a clean 400', () => {
    const res = mockRes();
    errorHandler({ code: '23503', message: 'insert or update on table violates foreign key constraint' }, {}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid request — a referenced record was not found.' });
  });

  it('shows the real message and stack only when NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development';
    const res = mockRes();
    errorHandler(new Error('raw internal DB driver failure'), {}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('raw internal DB driver failure');
    expect(body.stack).toBeDefined();
  });

  it('hides the real message and stack when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    const res = mockRes();
    errorHandler(new Error('raw internal DB driver failure'), {}, res, jest.fn());
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    expect(body.stack).toBeUndefined();
  });

  it('hides the real message even when NODE_ENV is unset or something other than "development" (safe-by-default)', () => {
    delete process.env.NODE_ENV;
    const res = mockRes();
    errorHandler(new Error('raw internal DB driver failure'), {}, res, jest.fn());
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    expect(body.stack).toBeUndefined();

    process.env.NODE_ENV = 'staging';
    const res2 = mockRes();
    errorHandler(new Error('another raw failure'), {}, res2, jest.fn());
    expect(res2.json.mock.calls[0][0].message).toBe('Internal server error');
  });

  it('still surfaces the message for an error with an explicit .status outside development', () => {
    process.env.NODE_ENV = 'production';
    const res = mockRes();
    const err = new Error('a deliberate, safe-to-show message');
    err.status = 418;
    errorHandler(err, {}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(418);
    expect(res.json.mock.calls[0][0].message).toBe('a deliberate, safe-to-show message');
  });
});

describe('asyncHandler', () => {
  it('forwards a rejected promise to next()', async () => {
    const err = new Error('boom');
    const handler = asyncHandler(async () => { throw err; });
    const next = jest.fn();
    await handler({}, {}, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('does not call next() when the handler resolves normally', async () => {
    const handler = asyncHandler(async (_req, res) => { res.sent = true; });
    const next = jest.fn();
    const res = {};
    await handler({}, res, next);
    expect(res.sent).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });
});
