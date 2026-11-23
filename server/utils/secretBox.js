import crypto from 'node:crypto';

/**
 * AES-256-GCM for small secrets kept in the database (users' AI provider keys).
 * The key comes from SCRIPTS_SECRET_KEY (32 bytes, base64). Without it, one is derived from JWT_SECRET so the
 * feature still works, but rotating JWT_SECRET would then make the stored keys unreadable.
 */
let warned = false;

export function resolveKey(env = process.env) {
  if (env.SCRIPTS_SECRET_KEY) {
    const key = Buffer.from(env.SCRIPTS_SECRET_KEY, 'base64');
    if (key.length !== 32) throw new Error('SCRIPTS_SECRET_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32).');
    return key;
  }
  if (!env.JWT_SECRET) throw new Error('Set SCRIPTS_SECRET_KEY (or JWT_SECRET) to store AI keys.');
  if (!warned) {
    warned = true;
    console.warn('SCRIPTS_SECRET_KEY is not set; deriving the AI key encryption key from JWT_SECRET.');
  }
  return Buffer.from(crypto.hkdfSync('sha256', env.JWT_SECRET, 'cms-scripts', 'ai-provider-keys', 32));
}

export function seal(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

/** Throws when the data was changed or the key is wrong. */
export function open({ ciphertext, iv, tag }, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
