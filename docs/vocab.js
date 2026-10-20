// 词汇累计：浏览器（显示）和 Node 脚本（保存时写入 known）共用。

// 单词去重用的键：忽略大小写和多余空格（复数 s 在 vocabSeries 里处理）。
export function wordKey(w) {
  return String(w).toLowerCase().replace(/\s+/g, " ").trim();
}

// 每条词汇记录可以是一节课的新词列表（words），也可以是一个词汇量数字（known）。
// 有 words 时累计数由去重后的单词计算，保存时也会写进 known，旧版页面同样能显示。
export function vocabSeries(vocab) {
  const seen = new Set();
  const has = (k) => seen.has(k) || seen.has(k + "s") || (k.endsWith("s") && seen.has(k.slice(0, -1)));
  let total = 0;
  return [...vocab.entries]
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .map((e) => {
      const fresh = [];
      let repeated = 0;
      for (const item of e.words || []) {
        const word = typeof item === "string" ? { w: item } : item;
        const k = wordKey(word.w);
        if (!k) continue;
        if (has(k)) repeated++;
        else {
          seen.add(k);
          fresh.push(word);
        }
      }
      if (Array.isArray(e.words)) total += fresh.length;
      else if (typeof e.known === "number") total = e.known;
      return { ...e, known: total, fresh, repeated };
    });
}
