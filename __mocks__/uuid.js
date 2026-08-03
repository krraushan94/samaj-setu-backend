// Manual CJS mock for uuid v9 (which is ESM-only)
let counter = 0;
const v4 = () => `test-uuid-${++counter}-${Date.now()}`;
const v1 = () => `test-uuid-v1-${++counter}`;

module.exports = { v4, v1 };
module.exports.default = module.exports;
