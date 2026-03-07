const crypto = require('crypto');

// Secret key for HMAC signing — in production, use env variable
const SECRET_KEY = process.env.QR_SECRET || 'dev-qr-secret-only';

/**
 * Generate a signed QR payload for a voucher
 * Format: voucherId|hashedCode|signature
 */
function generateQRPayload(voucherId, hashedCode) {
  const data = `${voucherId}|${hashedCode}`;
  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(data)
    .digest('hex');
  return `${data}|${signature}`;
}

/**
 * Verify a QR payload's cryptographic signature
 * Returns { valid, voucherId, hashedCode } or { valid: false, error }
 */
function verifyQRPayload(payload) {
  try {
    const parts = payload.split('|');
    if (parts.length !== 3) {
      return { valid: false, error: 'Formato de QR inválido' };
    }

    const [voucherId, hashedCode, providedSignature] = parts;
    const data = `${voucherId}|${hashedCode}`;
    const expectedSignature = crypto
      .createHmac('sha256', SECRET_KEY)
      .update(data)
      .digest('hex');

    if (providedSignature !== expectedSignature) {
      return { valid: false, error: 'Firma criptográfica inválida — QR posiblemente alterado' };
    }

    return { valid: true, voucherId, hashedCode };
  } catch (err) {
    return { valid: false, error: 'Error al procesar QR: ' + err.message };
  }
}

/**
 * Generate a unique hash code for a voucher
 */
function generateHashedCode() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { generateQRPayload, verifyQRPayload, generateHashedCode, SECRET_KEY };
