const axios = require('axios');

// Expo's push service — free, no API key or Firebase/APNs setup needed for a managed Expo
// app. A malformed/expired token, or Expo's endpoint being unreachable, must never break the
// in-app notification it rides alongside — this is always best-effort.
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendPushNotification(pushToken, title, body, data = {}) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;
  try {
    await axios.post(EXPO_PUSH_URL, {
      to: pushToken, title, body, data, sound: 'default', priority: 'high',
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
  } catch (err) {
    console.error('sendPushNotification() failed (non-fatal):', err.message);
  }
}

module.exports = { sendPushNotification };
