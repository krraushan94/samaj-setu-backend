// Fast2SMS retired the old bulkV2 route=otp API this now used to call — it's
// undocumented/unsupported and was silently failing. The current OTP API is a
// dedicated endpoint that needs a pre-created "OTP ID" template (Fast2SMS
// dashboard → Smart OTP → Add OTP Template) supplied as FAST2SMS_OTP_ID. We
// still generate/hash/store the OTP ourselves (see auth.controller.js) and
// just ask Fast2SMS to relay that exact value — passing our own `otp` value
// keeps our own verification logic unchanged.
async function sendOtpSms(mobile, otp) {
  if (!process.env.FAST2SMS_API_KEY || !process.env.FAST2SMS_OTP_ID) {
    if (process.env.NODE_ENV === 'production') {
      console.error('FAST2SMS_API_KEY and/or FAST2SMS_OTP_ID missing in production — OTP was NOT sent.');
    } else {
      console.log(`[DEV] OTP for ${mobile}: ${otp}`);
    }
    return { delivered: false, reason: 'not_configured' };
  }

  let res;
  try {
    res = await fetch('https://www.fast2sms.com/dev/otp/send', {
      method: 'POST',
      headers: {
        authorization: process.env.FAST2SMS_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        otp_id: process.env.FAST2SMS_OTP_ID,
        mobile,
        otp,
      }),
    });
  } catch (err) {
    console.error('Fast2SMS OTP send request failed:', err.message);
    return { delivered: false, reason: 'network_error' };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.return) {
    console.error('Fast2SMS OTP send failed:', res.status, data.message || data);
    return { delivered: false, reason: 'provider_error' };
  }
  return { delivered: true };
}

module.exports = { sendOtpSms };
