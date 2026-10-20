#!/usr/bin/env node
// 老师用的管理脚本：添加学生、解密数据以便编辑、重新加密保存、重置家长密码。
// 所有命令都需要环境变量 IELTS_ADMIN_KEY（老师的管理密钥）。
//
//   node scripts/admin.mjs list
//   node scripts/admin.mjs add <学生代号> --name 张小明 [--username xxx] [--password yyy]
//   node scripts/admin.mjs open [学生代号]        # 解密到 work/<代号>.json（不进 git）
//   node scripts/admin.mjs save [学生代号]        # 校验并重新加密 work/<代号>.json
//   node scripts/admin.mjs login <学生代号>       # 查看家长的用户名和密码
//   node scripts/admin.mjs set-password <学生代号> [--password yyy]
//   node scripts/admin.mjs remove <学生代号>
//   node scripts/admin.mjs rotate-admin-key --new <新管理密钥>

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PBKDF2_ITERATIONS, toB64, fromB64, randomBytes, normalizeUsername, fileIdFor,
  deriveKey, importDataKey, encryptBytes, decryptBytes, encryptJson, decryptJson,
} from "../docs/crypto.js";
import { validateStudentData, emptyStudentData } from "./schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "docs", "data");
const WORK_DIR = path.join(ROOT, "work");
const INDEX_FILE = path.join(ROOT, "admin", "index.enc.json");

function die(msg) {
  console.error("错误：" + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else { flags[key] = next; i++; }
    } else positional.push(a);
  }
  return { positional, flags };
}

function generatePassword() {
  // 例如 k7tq-m3xa-9fwe：约 62 位随机性，方便家长输入，足以抵抗离线暴力破解。
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) {
    s += alphabet[bytes[i] % alphabet.length];
    if (i === 3 || i === 7) s += "-";
  }
  return s;
}

function adminKeyFromEnv() {
  const key = process.env.IELTS_ADMIN_KEY;
  if (!key) die("没有设置环境变量 IELTS_ADMIN_KEY（老师的管理密钥）。");
  return key;
}

// ---------- 管理索引（学生代号 → 姓名、登录信息、数据文件），用管理密钥加密 ----------

async function loadIndex(adminKey, { allowCreate = false } = {}) {
  if (!existsSync(INDEX_FILE)) {
    if (!allowCreate) die("还没有任何学生。先用 add 命令添加一个。");
    const salt = randomBytes(16);
    const kek = await deriveKey(adminKey, salt);
    return { salt, kek, index: { students: {} } };
  }
  const file = JSON.parse(await readFile(INDEX_FILE, "utf8"));
  const salt = fromB64(file.salt);
  const kek = await deriveKey(adminKey, salt, file.iterations);
  try {
    return { salt, kek, index: await decryptJson(kek, file) };
  } catch {
    die("管理密钥不正确，无法解密 admin/index.enc.json。");
  }
}

async function saveIndex({ salt, kek, index }) {
  const box = await encryptJson(kek, index);
  await mkdir(path.dirname(INDEX_FILE), { recursive: true });
  await writeFile(INDEX_FILE, JSON.stringify({ v: 1, salt: toB64(salt), iterations: PBKDF2_ITERATIONS, ...box }, null, 2) + "\n");
}

function getStudent(index, slug) {
  const s = index.students[slug];
  if (!s) die(`找不到学生代号 “${slug}”。现有：${Object.keys(index.students).join("、") || "（无）"}`);
  return s;
}

// ---------- 学生数据文件 ----------

function envelopePath(fileId) {
  return path.join(DATA_DIR, fileId + ".json");
}

async function readEnvelope(fileId) {
  return JSON.parse(await readFile(envelopePath(fileId), "utf8"));
}

async function writeEnvelope(fileId, envelope) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(envelopePath(fileId), JSON.stringify(envelope, null, 2) + "\n");
}

async function wrapForParent(rawKey, password) {
  const salt = randomBytes(16);
  const kek = await deriveKey(password, salt);
  return { salt: toB64(salt), iterations: PBKDF2_ITERATIONS, ...(await encryptBytes(kek, rawKey)) };
}

async function unwrapForAdmin(envelope, adminKek) {
  try {
    return await decryptBytes(adminKek, envelope.admin);
  } catch {
    die("管理密钥无法解开该学生的数据文件。");
  }
}

async function writeStudentData(fileId, rawKey, parentWrap, adminKek, data) {
  const envelope = {
    v: 1,
    parent: parentWrap,
    admin: await encryptBytes(adminKek, rawKey),
    data: await encryptJson(await importDataKey(rawKey), data),
  };
  await writeEnvelope(fileId, envelope);
}

function workPath(slug) {
  return path.join(WORK_DIR, slug + ".json");
}

// ---------- 命令 ----------

async function cmdList() {
  const { index } = await loadIndex(adminKeyFromEnv());
  const rows = Object.entries(index.students).map(([slug, s]) => ({ 代号: slug, 姓名: s.name, 用户名: s.username }));
  if (!rows.length) console.log("（还没有学生）");
  else console.table(rows);
}

async function cmdAdd(slug, flags) {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) die("学生代号只能用小写字母、数字和连字符，例如 xiaoming。");
  if (!flags.name || flags.name === true) die("请用 --name 指定学生姓名。");
  const ctx = await loadIndex(adminKeyFromEnv(), { allowCreate: true });
  if (ctx.index.students[slug]) die(`学生代号 “${slug}” 已存在。`);
  const username = normalizeUsername(typeof flags.username === "string" ? flags.username : slug);
  if (Object.values(ctx.index.students).some((s) => s.username === username)) die(`用户名 “${username}” 已被使用。`);
  const password = typeof flags.password === "string" ? flags.password : generatePassword();
  if (password.length < 8) die("密码至少 8 位。");

  const fileId = await fileIdFor(username);
  const rawKey = randomBytes(32);
  const data = emptyStudentData(flags.name);
  await writeStudentData(fileId, rawKey, await wrapForParent(rawKey, password), ctx.kek, data);
  ctx.index.students[slug] = { name: flags.name, username, password, fileId };
  await saveIndex(ctx);
  console.log(`已添加学生 ${flags.name}（代号 ${slug}）`);
  console.log(`家长登录用户名：${username}`);
  console.log(`家长登录密码：  ${password}`);
}

async function openOne(index, kek, slug) {
  const s = getStudent(index, slug);
  const envelope = await readEnvelope(s.fileId);
  const rawKey = await unwrapForAdmin(envelope, kek);
  const data = await decryptJson(await importDataKey(rawKey), envelope.data);
  await mkdir(WORK_DIR, { recursive: true });
  await writeFile(workPath(slug), JSON.stringify(data, null, 2) + "\n");
  console.log(`已解密到 ${path.relative(process.cwd(), workPath(slug))}`);
}

async function cmdOpen(slug) {
  const { index, kek } = await loadIndex(adminKeyFromEnv());
  const slugs = slug ? [slug] : Object.keys(index.students);
  for (const s of slugs) await openOne(index, kek, s);
}

async function saveOne(index, kek, slug) {
  const s = getStudent(index, slug);
  if (!existsSync(workPath(slug))) die(`找不到 ${path.relative(process.cwd(), workPath(slug))}，请先运行 open。`);
  let data;
  try {
    data = JSON.parse(await readFile(workPath(slug), "utf8"));
  } catch (e) {
    die(`${slug}.json 不是合法的 JSON：${e.message}`);
  }
  const problems = validateStudentData(data);
  if (problems.length) die(`${slug}.json 数据有问题：\n  - ` + problems.join("\n  - "));
  data.updatedAt = new Date().toISOString().slice(0, 10);
  await writeFile(workPath(slug), JSON.stringify(data, null, 2) + "\n");

  const envelope = await readEnvelope(s.fileId);
  const rawKey = await unwrapForAdmin(envelope, kek);
  await writeStudentData(s.fileId, rawKey, envelope.parent, kek, data);
  console.log(`已加密保存 ${s.name}（${slug}）`);
}

async function cmdSave(slug) {
  const { index, kek } = await loadIndex(adminKeyFromEnv());
  const slugs = slug
    ? [slug]
    : Object.keys(index.students).filter((s) => existsSync(workPath(s)));
  if (!slugs.length) die("work/ 目录里没有可保存的文件。");
  for (const s of slugs) await saveOne(index, kek, s);
}

async function cmdLogin(slug) {
  const { index } = await loadIndex(adminKeyFromEnv());
  const s = getStudent(index, slug);
  console.log(`${s.name}  用户名：${s.username}  密码：${s.password}`);
}

async function cmdSetPassword(slug, flags) {
  const ctx = await loadIndex(adminKeyFromEnv());
  const s = getStudent(ctx.index, slug);
  const password = typeof flags.password === "string" ? flags.password : generatePassword();
  if (password.length < 8) die("密码至少 8 位。");
  const envelope = await readEnvelope(s.fileId);
  const rawKey = await unwrapForAdmin(envelope, ctx.kek);
  envelope.parent = await wrapForParent(rawKey, password);
  await writeEnvelope(s.fileId, envelope);
  s.password = password;
  await saveIndex(ctx);
  console.log(`${s.name} 的新密码：${password}`);
}

async function cmdRemove(slug) {
  const ctx = await loadIndex(adminKeyFromEnv());
  const s = getStudent(ctx.index, slug);
  await rm(envelopePath(s.fileId), { force: true });
  await rm(workPath(slug), { force: true });
  delete ctx.index.students[slug];
  await saveIndex(ctx);
  console.log(`已删除 ${s.name}（${slug}）`);
}

async function cmdRotate(flags) {
  const newKey = flags.new;
  if (typeof newKey !== "string" || newKey.length < 12) die("请用 --new 提供至少 12 位的新管理密钥。");
  const old = await loadIndex(adminKeyFromEnv());
  const salt = randomBytes(16);
  const kek = await deriveKey(newKey, salt);
  for (const s of Object.values(old.index.students)) {
    const envelope = await readEnvelope(s.fileId);
    const rawKey = await unwrapForAdmin(envelope, old.kek);
    envelope.admin = await encryptBytes(kek, rawKey);
    await writeEnvelope(s.fileId, envelope);
  }
  await saveIndex({ salt, kek, index: old.index });
  console.log("管理密钥已更换。以后请使用新的 IELTS_ADMIN_KEY。");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  switch (cmd) {
    case "list": return cmdList();
    case "add": return cmdAdd(positional[0], flags);
    case "open": return cmdOpen(positional[0]);
    case "save": return cmdSave(positional[0]);
    case "login": return cmdLogin(positional[0]);
    case "set-password": return cmdSetPassword(positional[0], flags);
    case "remove": return cmdRemove(positional[0]);
    case "rotate-admin-key": return cmdRotate(flags);
    default: {
      const src = await readFile(fileURLToPath(import.meta.url), "utf8");
      console.log(src.split("\n").filter((l) => l.startsWith("//")).slice(1, 13).map((l) => l.slice(3)).join("\n"));
      if (cmd) process.exit(1);
    }
  }
}

main();
