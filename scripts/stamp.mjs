#!/usr/bin/env node
// 给页面引用的 JS/CSS 加上内容版本号（?v=…），浏览器就不会把新旧文件混在一起用。
// 修改 docs/ 下的代码后运行：npm run stamp（admin.mjs save 也会自动运行）。

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");

// 被其他模块 import、自身不 import 本地文件的模块。
const LEAVES = ["crypto.js", "vocab.js", "calendar.js", "schema.js"];
// 入口模块，以及引用它们的页面。
const ENTRIES = { "app.js": "index.html", "admin.js": "admin.html" };

async function version(file) {
  const body = await readFile(path.join(DOCS, file), "utf8");
  return createHash("sha256").update(body).digest("hex").slice(0, 10);
}

async function rewrite(file, refs) {
  const p = path.join(DOCS, file);
  const before = await readFile(p, "utf8");
  let after = before;
  for (const [name, v] of Object.entries(refs)) {
    const re = new RegExp(`(["'(]\\.?/?)${name.replace(".", "\\.")}(\\?v=[0-9a-f]+)?(["')])`, "g");
    after = after.replace(re, `$1${name}?v=${v}$3`);
  }
  if (after !== before) await writeFile(p, after);
}

export async function stampAssets() {
  // 先给叶子模块定版本，写进入口模块，再计算入口模块的版本写进页面。
  const leaves = {};
  for (const f of LEAVES) leaves[f] = await version(f);
  const css = await version("style.css");
  for (const [entry, page] of Object.entries(ENTRIES)) {
    await rewrite(entry, leaves);
    await rewrite(page, { [entry]: await version(entry), "style.css": css });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await stampAssets();
