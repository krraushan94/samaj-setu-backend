const { sendOtpSms } = require('../src/config/sms');

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.FAST2SMS_API_KEY;
  delete process.env.FAST2SMS_OTP_ID;
  global.fetch = jest.fn();
});
afterEach(() => { process.env = ORIGINAL_ENV; });

describe('sendOtpSms', () => {
  it('falls back to console-logging (dev) when Fast2SMS credentials are missing outside production', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const result = await sendOtpSms('9812345678', '123456');
    expect(result).toEqual({ delivered: false, reason: 'not_configured' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('123456'));
    expect(global.fetch).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('logs loudly (console.error) when credentials are missing in production, instead of silently pretending', async () => {
    process.env.NODE_ENV = 'production';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await sendOtpSms('9812345678', '123456');
    expect(result).toEqual({ delivered: false, reason: 'not_configured' });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('FAST2SMS'));
    errorSpy.mockRestore();
  });

  it('calls the current Fast2SMS OTP endpoint with the right params and reports delivered:true on success', async () => {
    process.env.FAST2SMS_API_KEY = 'test-key';
    process.env.FAST2SMS_OTP_ID = 'test-otp-id';
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ return: true, message: 'OTP sent successfully' }) });

    const result = await sendOtpSms('9812345678', '654321');

    expect(global.fetch).toHaveBeenCalledWith('https://www.fast2sms.com/dev/otp/send', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'test-key' }),
    }));
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ otp_id: 'test-otp-id', mobile: '9812345678', otp: '654321' });
    expect(result).toEqual({ delivered: true });
  });

  it('reports delivered:false when Fast2SMS returns return:false (e.g. low balance, bad otp_id)', async () => {
    process.env.FAST2SMS_API_KEY = 'test-key';
    process.env.FAST2SMS_OTP_ID = 'test-otp-id';
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ return: false, message: 'Low balance' }) });

    const result = await sendOtpSms('9812345678', '654321');
    expect(result).toEqual({ delivered: false, reason: 'provider_error' });
  });

  it('reports delivered:false on a network-level failure without throwing', async () => {
    process.env.FAST2SMS_API_KEY = 'test-key';
    process.env.FAST2SMS_OTP_ID = 'test-otp-id';
    global.fetch.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await sendOtpSms('9812345678', '654321');
    expect(result).toEqual({ delivered: false, reason: 'network_error' });
  });
});
