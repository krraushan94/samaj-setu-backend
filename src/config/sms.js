// Fast2SMS OTP route — no DLT template registration needed, fixed message
// "Your OTP: {otp}". FAST2SMS_API_KEY must be set in Render's environment
// variables — never commit the real key to this file or to .env in git.
async function sendOtpSms(mobile, otp) {
  if (!process.env.FAST2SMS_API_KEY) {
    console.log(`[DEV] OTP for ${mobile}: ${otp}`);
    return { delivered: false };
  }

  const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
    method: 'POST',
    headers: {
      authorization: process.env.FAST2SMS_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      route: 'otp',
      variables_values: otp,
      numbers: mobile,
    }),
  });
  const data = await res.json();
  if (!data.return) {
    console.error('Fast2SMS OTP send failed:', data.message || data);
    return { delivered: false };
  }
  return { delivered: true };
}

module.exports = { sendOtpSms };
