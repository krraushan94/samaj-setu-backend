// Manual CJS mock for bad-words v4 (its badwords-list dependency is ESM-only, which
// Jest's module resolution can't require — same class of problem as uuid, see uuid.js).
class Filter {
  isProfane(text) {
    return /\b(badword|profanitytest)\b/i.test(text || '');
  }
}

module.exports = { Filter };
