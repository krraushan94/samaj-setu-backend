// Fast2SMS "Quick SMS" route (route=q on the classic bulkV2 endpoint) — no DLT
// entity/sender/template registration needed, unlike route=otp (retired) or the
// newer /dev/otp/send template flow (needs a DLT-approved OTP template). Quick
// SMS uses a random numeric sender ID, is billed per-SMS regardless of plan,
// and (per Fast2SMS) delivers to DND-registered numbers too, which is what
// actually matters for OTP reliability. We still generate/hash/store the OTP
// ourselves (see auth.controller.js) — this just relays a plain text message
// containing it.
async function sendOtpSms(mobile, otp) {
  if (!process.env.FAST2SMS_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      console.error('FAST2SMS_API_KEY missing in production — OTP was NOT sent.');
    } else {
      console.log(`[DEV] OTP for ${mobile}: ${otp}`);
    }
    return { delivered: false, reason: 'not_configured' };
  }

  let res;
  try {
    res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        authorization: process.env.FAST2SMS_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        route: 'q',
        message: `Your Samaj Setu verification code is ${otp}. Valid for 10 minutes. Do not share this code with anyone.`,
        numbers: mobile,
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
