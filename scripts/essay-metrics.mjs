#!/usr/bin/env node
// 计算一篇英文作文的长度与复杂度指标，输出可直接放进 writing.entries 的 JSON。
// 保证每次分析口径一致，不依赖 AI 的主观估计。
//
//   node scripts/essay-metrics.mjs essay.txt --task "Task 2" --date 2026-10-20 --topic "..."
//   cat essay.txt | node scripts/essay-metrics.mjs --task "Task 1"

import { readFile } from "node:fs/promises";

// 引导从句 / 关系从句的标志词。出现任一即视为复杂句（估算值）。
const SUBORDINATORS = [
  "although", "though", "even though", "because", "since", "while", "whereas", "unless",
  "if", "whether", "when", "whenever", "whereby", "once", "until", "as long as", "provided that",
  "so that", "such that", "in order that", "which", "who", "whom", "whose", "where",
  "despite the fact that", "given that", "now that",
];

const MATTR_WINDOW = 50;

export function analyzeEssay(text) {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  const words = clean.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,]\d+)*%?/g) || [];
  const sentences = clean
    .split(/(?<=[.!?])["”’)]?\s+(?=["“(]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]/.test(s));
  const paragraphs = clean.split(/\n\s*\n/).filter((p) => p.trim()).length;

  const complex = sentences.filter((s) => {
    const lower = " " + s.toLowerCase().replace(/[^a-z' ]+/g, " ") + " ";
    return SUBORDINATORS.some((m) => lower.includes(" " + m + " "));
  }).length;

  const lower = words.map((w) => w.toLowerCase());
  let lexicalDiversity;
  if (lower.length <= MATTR_WINDOW) {
    lexicalDiversity = lower.length ? new Set(lower).size / lower.length : 0;
  } else {
    // MATTR：滑动窗口的平均类符/形符比，不受文章长度影响，方便前后比较。
    let sum = 0;
    const n = lower.length - MATTR_WINDOW + 1;
    for (let i = 0; i < n; i++) sum += new Set(lower.slice(i, i + MATTR_WINDOW)).size / MATTR_WINDOW;
    lexicalDiversity = sum / n;
  }

  const longWords = words.filter((w) => w.replace(/[^A-Za-z]/g, "").length >= 7).length;
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    wordCount: words.length,
    sentences: sentences.length,
    paragraphs,
    avgSentenceLength: sentences.length ? round(words.length / sentences.length, 1) : 0,
    complexSentenceRatio: sentences.length ? round(complex / sentences.length, 2) : 0,
    lexicalDiversity: round(lexicalDiversity, 2),
    longWordRatio: words.length ? round(longWords / words.length, 2) : 0,
  };
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const flags = {};
  let file;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[++i];
    else file = args[i];
  }
  const text = file ? await readFile(file, "utf8") : await readStdin();
  if (!text.trim()) {
    console.error("错误：没有读到作文内容。");
    process.exit(1);
  }
  const entry = {
    date: flags.date || new Date().toISOString().slice(0, 10),
    task: flags.task || "Task 2",
    topic: flags.topic || "",
    ...analyzeEssay(text),
    band: flags.band ? Number(flags.band) : null,
    comment: flags.comment || "",
  };
  console.log(JSON.stringify(entry, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
