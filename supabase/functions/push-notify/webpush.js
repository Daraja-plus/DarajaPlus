/* Web Push (RFC 8291 chiffrement « aes128gcm » + RFC 8292 VAPID) avec WebCrypto seul.
   Fichier en JavaScript simple : il fonctionne dans Deno (Edge Function) et dans Node (tests). */

const enc = new TextEncoder();

export function b64uToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function bytesToB64u(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/* Chiffre le message pour un abonnement (p256dh + auth, en base64url).
   `ephemeral` et `salt` sont facultatifs : ils servent uniquement aux tests. */
export async function encryptPayload(plaintext, p256dh, authSecret, ephemeral, salt) {
  const uaPublic = b64uToBytes(p256dh);
  const authBytes = b64uToBytes(authSecret);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const as = ephemeral || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authBytes, ecdhSecret, keyInfo, 32);
  const saltBytes = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(saltBytes, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(saltBytes, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concat(plaintext, new Uint8Array([2])); // 0x02 = dernier enregistrement
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));
  const recordSize = new Uint8Array([0, 0, 16, 0]); // 4096 octets, en big-endian
  return concat(saltBytes, recordSize, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/* Autorisation VAPID : jeton ES256 signé avec la clé privée du serveur. */
export async function vapidAuthorization(endpoint, publicKey, privateKey, subject, nowSeconds) {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const exp = (nowSeconds || Math.floor(Date.now() / 1000)) + 12 * 3600;
  const body = bytesToB64u(enc.encode(JSON.stringify({ aud, exp, sub: subject })));
  const pub = b64uToBytes(publicKey);
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", ext: true,
    x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)), d: privateKey
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(header + "." + body)));
  return "vapid t=" + header + "." + body + "." + bytesToB64u(sig) + ", k=" + publicKey;
}
