// 加密工具：浏览器（家长登录）和 Node 脚本（老师更新数据）共用同一份代码。
//
// 每个学生的数据用一把随机生成的“数据密钥”(AES-256-GCM) 加密。
// 这把数据密钥再被包裹两次：
//   - 一次用家长密码派生的密钥（家长登录时解开）
//   - 一次用老师的管理密钥派生的密钥（老师 / Claude / Codex 更新数据时解开）
// 仓库里只保存密文，没有密码的人即使下载了文件也看不到内容。

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITERATIONS = 310000;

export function toB64(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function normalizeUsername(username) {
  return String(username).trim().toLowerCase();
}

// 数据文件名由用户名哈希得到，文件名本身不暴露学生信息。
export async function fileIdFor(username) {
  const digest = await subtle.digest("SHA-256", enc.encode("ielts-progress:" + normalizeUsername(username)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function deriveKey(secret, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function importDataKey(raw) {
  return subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptBytes(key, box) {
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv) }, key, fromB64(box.ct));
  return new Uint8Array(pt);
}

export async function encryptJson(key, value) {
  return encryptBytes(key, enc.encode(JSON.stringify(value)));
}

export async function decryptJson(key, box) {
  return JSON.parse(dec.decode(await decryptBytes(key, box)));
}

// 家长登录：用密码解开数据密钥，再解密学生数据。密码错误时抛出异常。
export async function unlockWithPassword(envelope, password) {
  const kek = await deriveKey(password, fromB64(envelope.parent.salt), envelope.parent.iterations);
  const rawKey = await decryptBytes(kek, envelope.parent);
  return rawKey;
}

export async function decryptEnvelopeData(envelope, rawKey) {
  return decryptJson(await importDataKey(rawKey), envelope.data);
}
