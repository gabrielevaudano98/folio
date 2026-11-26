// Folio Sheets — protection, encryption and signatures (area 26), with node-forge. Runs in the data engine.
//
//   protect   a password check for "Unprotect sheet": PBKDF2-SHA256, 210 000 iterations, 16-byte salt. Protection stops
//             accidental edits in Folio; it is not secrecy (the file is Markdown). Encryption is the secret part.
//   encrypt   cells of a range → AES-256-GCM with a key from PBKDF2(password); the cells are blanked in the table and the
//             ciphertext is kept in the sheet's meta. Only someone with the password can put them back.
//   sign      RSA-2048 PKCS#1 v1.5 over SHA-256 of the workbook text without its signature line. The public key and its
//             fingerprint travel in the file, so anyone can verify; the private key stays on this computer.
import forge from 'node-forge';

const ITER = 210000;
const b64 = (bytes) => forge.util.encode64(bytes), unb64 = (s) => forge.util.decode64(s);

export function hashPassword(password, { salt = forge.random.getBytesSync(16), iterations = ITER } = {}) {
  const key = forge.pkcs5.pbkdf2(String(password), salt, iterations, 32, forge.md.sha256.create());
  return { alg: 'pbkdf2-sha256', iterations, salt: b64(salt), hash: b64(key) };
}
export function checkPassword(password, rec) {
  if (!rec?.hash) return true;
  const key = forge.pkcs5.pbkdf2(String(password), unb64(rec.salt), rec.iterations || ITER, 32, forge.md.sha256.create());
  // constant-time compare
  const a = b64(key), b = rec.hash; let d = a.length ^ b.length; for (let i = 0; i < Math.min(a.length, b.length); i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** any JSON value → { alg, iterations, salt, iv, tag, data } */
export function encrypt(value, password) {
  const salt = forge.random.getBytesSync(16), iv = forge.random.getBytesSync(12);
  const key = forge.pkcs5.pbkdf2(String(password), salt, ITER, 32, forge.md.sha256.create());
  const c = forge.cipher.createCipher('AES-GCM', key);
  c.start({ iv, tagLength: 128 }); c.update(forge.util.createBuffer(forge.util.encodeUtf8(JSON.stringify(value)))); c.finish();
  return { alg: 'aes-256-gcm', kdf: 'pbkdf2-sha256', iterations: ITER, salt: b64(salt), iv: b64(iv), tag: b64(c.mode.tag.getBytes()), data: b64(c.output.getBytes()) };
}
export function decrypt(box, password) {
  const key = forge.pkcs5.pbkdf2(String(password), unb64(box.salt), box.iterations || ITER, 32, forge.md.sha256.create());
  const d = forge.cipher.createDecipher('AES-GCM', key);
  d.start({ iv: unb64(box.iv), tagLength: 128, tag: forge.util.createBuffer(unb64(box.tag)) });
  d.update(forge.util.createBuffer(unb64(box.data)));
  if (!d.finish()) throw new Error('Wrong password, or the encrypted cells were changed.');
  return JSON.parse(forge.util.decodeUtf8(d.output.getBytes()));
}

/* ---------- signatures ---------- */
const SIG_LINE = /^<!--\s*signature:[\s\S]*?-->\s*\n?/m;
/** the text a signature covers: the file without its signature line, line endings normalised */
export const signedText = (text) => String(text).replace(SIG_LINE, '').replace(/\r\n/g, '\n').replace(/\n+$/, '\n');
export function newKeyPair() {
  const kp = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  return { privatePem: forge.pki.privateKeyToPem(kp.privateKey), publicPem: forge.pki.publicKeyToPem(kp.publicKey) };
}
export const fingerprint = (publicPem) => forge.md.sha256.create().update(forge.asn1.toDer(forge.pki.publicKeyToAsn1(forge.pki.publicKeyFromPem(publicPem))).getBytes()).digest().toHex().match(/../g).slice(0, 16).join(':');
export function sign(text, { privatePem, publicPem }, { signer = '', date = new Date().toISOString() } = {}) {
  const md = forge.md.sha256.create(); md.update(forge.util.encodeUtf8(`${signer}\n${date}\n${signedText(text)}`));
  const sig = forge.pki.privateKeyFromPem(privatePem).sign(md);
  return { alg: 'rsa-sha256', signer, date, key: publicPem.replace(/-----[^-]+-----|\s/g, ''), fingerprint: fingerprint(publicPem), sig: b64(sig) };
}
/** → { valid, signer, date, fingerprint, mine } */
export function verify(text, s, { myPublicPem = null } = {}) {
  if (!s?.sig) return { valid: false, reason: 'This workbook is not signed.' };
  try {
    const pem = `-----BEGIN PUBLIC KEY-----\n${s.key.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
    const md = forge.md.sha256.create(); md.update(forge.util.encodeUtf8(`${s.signer}\n${s.date}\n${signedText(text)}`));
    const valid = forge.pki.publicKeyFromPem(pem).verify(md.digest().bytes(), unb64(s.sig));
    const fp = fingerprint(pem);
    return { valid, signer: s.signer, date: s.date, fingerprint: fp, mine: !!myPublicPem && fingerprint(myPublicPem) === fp, reason: valid ? '' : 'The workbook changed after it was signed.' };
  } catch (e) { return { valid: false, reason: `The signature cannot be read: ${e.message}` }; }
}
export const signatureLine = (s) => `<!-- signature: ${JSON.stringify(s)} -->`;
export const readSignature = (text) => { const m = /^<!--\s*signature:\s*([\s\S]*?)\s*-->/m.exec(text); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } };
/** put the signature line at the end of the file (replacing an old one) */
export const withSignature = (text, s) => `${signedText(text).replace(/\n+$/, '')}\n\n${signatureLine(s)}\n`;
