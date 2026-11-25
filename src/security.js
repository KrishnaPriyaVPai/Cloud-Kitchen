const crypto = require('node:crypto');

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateOrderNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `CK-${stamp}-${suffix}`;
}

module.exports = { hashPassword, verifyPassword, randomToken, generateOrderNumber };
