// app.js calls process.exit(1) when JWT_SECRET is missing. A spawned child process would
// exercise the real behavior but is invisible to Jest's coverage instrumentation (it runs
// outside this process entirely) — so instead, mock process.exit to throw instead of actually
// terminating anything, then require the module in-process so Istanbul sees it execute.
// dotenv is mocked to a no-op too — otherwise re-requiring app.js re-runs its
// `dotenv.config()` call, which would reload the real backend/.env's JWT_SECRET and
// silently undo the `delete` below before the check ever runs.
jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('app.js boot-time JWT_SECRET check', () => {
  const originalSecret = process.env.JWT_SECRET;
  let exitSpy;
  let errorSpy;

  beforeEach(() => {
    jest.resetModules();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`EXIT_${code}`); });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    jest.resetModules();
  });

  it('refuses to start when JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET;
    expect(() => require('../src/app')).toThrow('EXIT_1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/JWT_SECRET/i));
  });
});
