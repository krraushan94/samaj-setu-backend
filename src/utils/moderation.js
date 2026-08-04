const Filter = require('bad-words');
const { query } = require('../config/db');

const filter = new Filter();

// Flags ticket text for admin review — doesn't block submission, just surfaces it.
// English profanity/slur detection uses the `bad-words` library. Hindi/Bengali terms are
// admin-configurable (app_settings key "flagged_terms_hi_bn", comma-separated) rather than
// a hardcoded list, since an accurate multilingual list needs native-speaker judgment.
async function needsModerationReview(text) {
  if (!text) return false;
  if (filter.isProfane(text)) return true;

  try {
    const result = await query("SELECT value FROM app_settings WHERE key='flagged_terms_hi_bn'");
    const terms = (result.rows[0]?.value || '').split(',').map((t) => t.trim()).filter(Boolean);
    const lower = text.toLowerCase();
    return terms.some((term) => term && lower.includes(term.toLowerCase()));
  } catch {
    return false;
  }
}

module.exports = { needsModerationReview };
