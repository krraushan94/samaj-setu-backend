const { sendOtpSms } = require('../src/config/sms');

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.FAST2SMS_API_KEY;
  global.fetch = jest.fn();
});
afterEach(() => { process.env = ORIGINAL_ENV; });

describe('sendOtpSms', () => {
  it('falls back to console-logging (dev) when the Fast2SMS API key is missing outside production', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const result = await sendOtpSms('9812345678', '123456');
    expect(result).toEqual({ delivered: false, reason: 'not_configured' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('123456'));
    expect(global.fetch).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('logs loudly (console.error) when the API key is missing in production, instead of silently pretending', async () => {
    process.env.NODE_ENV = 'production';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await sendOtpSms('9812345678', '123456');
    expect(result).toEqual({ delivered: false, reason: 'not_configured' });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('FAST2SMS'));
    errorSpy.mockRestore();
  });

  it('calls the Quick SMS route (route=q, no DLT template needed) with the OTP in the message text', async () => {
    process.env.FAST2SMS_API_KEY = 'test-key';
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ return: true, message: ['Message sent successfully'] }) });

    const result = await sendOtpSms('9812345678', '654321');

    expect(global.fetch).toHaveBeenCalledWith('https://www.fast2sms.com/dev/bulkV2', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'test-key' }),
    }));
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.route).toBe('q');
    expect(body.numbers).toBe('9812345678');
    expect(body.message).toContain('654321');
    expect(result).toEqual({ delivered: true });
  });

  it('reports delivered:false when Fast2SMS returns return:false (e.g. low balance)', async () => {
    process.env.FAST2SMS_API_KEY = 'test-key';
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ return: false, message: 'Low balance' }) });

    const result = await sendOtpSms('9812345678', '654321');
    expect(result).toEqual({ delivered: false, reason: 'provider_error' });
  });

  it('reports delivered:false on a network-level failure without throwing', async () => {
    process.env.FAST2SMS_API_KEY = 'test-key';
    global.fetch.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await sendOtpSms('9812345678', '654321');
    expect(result).toEqual({ delivered: false, reason: 'network_error' });
  });
});
