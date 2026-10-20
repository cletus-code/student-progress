#!/usr/bin/env node
// 给页面引用的 JS/CSS 加上内容版本号（?v=…），浏览器就不会把新旧文件混在一起用。
// 修改 docs/ 下的代码后运行：npm run stamp（admin.mjs save 也会自动运行）。

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");

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
  // app.js 引用 crypto.js / vocab.js，所以先给它们定版本，再计算 app.js 的版本。
  await rewrite("app.js", { "crypto.js": await version("crypto.js"), "vocab.js": await version("vocab.js") });
  await rewrite("index.html", { "app.js": await version("app.js"), "style.css": await version("style.css") });
}

if (import.meta.url === `file://${process.argv[1]}`) await stampAssets();
