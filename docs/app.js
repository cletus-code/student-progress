import { fileIdFor, unlockWithPassword, decryptEnvelopeData, toB64, fromB64 } from "./crypto.js";

const SESSION_KEY = "ielts-session";
const $ = (id) => document.getElementById(id);

// ---------- 通用工具 ----------

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const pct = (v) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Math.round(v * 100) + "%");
const fmtInt = (v) => Math.round(v).toLocaleString("zh-CN");
const toTime = (d) => new Date(d + "T00:00:00").getTime();
const byDate = (a, b) => toTime(a.date) - toTime(b.date);
const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return `${y}年${m}月${day}日`;
}

function shortDate(d) {
  const [, m, day] = d.split("-").map(Number);
  return `${m}/${day}`;
}

function daysUntil(d) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((toTime(d) - today.getTime()) / 86400000);
}

function signed(v, unit = "") {
  if (v === 0) return "持平";
  return (v > 0 ? "+" : "−") + Math.abs(v) + unit;
}

function deltaClass(v) {
  return v > 0 ? "delta-up" : v < 0 ? "delta-down" : "";
}

// 雅思 40 题制的常用换算（估算，仅供参考）。
const LISTENING_BANDS = [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5]];
const READING_BANDS = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5]];

function estimateBand(entry, table) {
  if (entry.total !== 40) return null;
  for (const [min, band] of table) if (entry.correct >= min) return band;
  return null;
}

const fmtBand = (b) => (b === null || b === undefined ? "—" : Number(b).toFixed(1));

// ---------- 图表 ----------

const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function niceScale(min, max, count) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const step = niceStep((max - min) / count);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

function makeTip(container) {
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  container.appendChild(tip);
  return {
    show(html, x, y) {
      tip.innerHTML = html;
      tip.hidden = false;
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const cw = container.clientWidth;
      let left = x + 14;
      if (left + w > cw) left = x - w - 14;
      if (left < 0) left = Math.max(0, Math.min(cw - w, x - w / 2));
      let top = y - h - 12;
      if (top < -8) top = y + 16;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    },
    hide() {
      tip.hidden = true;
    },
  };
}

// 随时间变化的折线图。points: [{ t, y, tip }]
function lineChart(container, o) {
  container.innerHTML = "";
  const W = Math.max(container.clientWidth, 260);
  const H = o.height || 220;
  const compact = o.compact;
  const m = { l: compact ? 38 : 48, r: compact ? 14 : 24, t: compact ? 18 : 20, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const pts = o.points;

  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const span = t1 - t0;
  const x = (t) => (span ? m.l + ((t - t0) / span) * iw : m.l + iw / 2);

  let lo, hi, ticks;
  if (o.yDomain) {
    [lo, hi] = o.yDomain;
    ticks = o.yTicks;
  } else {
    const vals = pts.map((p) => p.y);
    if (o.target !== undefined && o.target !== null) vals.push(o.target);
    ({ lo, hi, ticks } = niceScale(Math.min(...vals), Math.max(...vals), compact ? 3 : 4));
  }
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  const fmt = o.yFormat || ((v) => v);

  const svg = svgEl("svg", { width: W, height: H, role: "img", "aria-label": o.label || "" });

  for (const tv of ticks) {
    svg.appendChild(svgEl("line", { class: "grid", x1: m.l, x2: m.l + iw, y1: y(tv), y2: y(tv) }));
    svg.appendChild(svgEl("text", { x: m.l - 8, y: y(tv) + 4, "text-anchor": "end" }, fmt(tv)));
  }

  // 横轴日期刻度
  const maxTicks = Math.max(2, Math.floor(iw / 72));
  const xTicks = [];
  if (!span) xTicks.push(t0);
  else {
    const n = Math.min(maxTicks, pts.length);
    for (let i = 0; i < n; i++) xTicks.push(t0 + (span * i) / (n - 1));
  }
  for (const tv of xTicks) {
    const d = new Date(tv);
    const label = span > 330 * 86400000 ? `${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}` : `${d.getMonth() + 1}/${d.getDate()}`;
    const anchor = xTicks.length > 1 && tv === t0 ? "start" : xTicks.length > 1 && tv === t1 ? "end" : "middle";
    svg.appendChild(svgEl("text", { x: x(tv), y: H - 6, "text-anchor": anchor }, label));
  }

  if (o.target !== undefined && o.target !== null) {
    const ty = y(o.target);
    svg.appendChild(svgEl("line", { class: "target", x1: m.l, x2: m.l + iw, y1: ty, y2: ty }));
    svg.appendChild(svgEl("text", { x: m.l + 4, y: ty - 6, "text-anchor": "start" }, o.targetLabel));
  }

  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  if (pts.length > 1 && o.area) {
    svg.appendChild(svgEl("path", { class: "area", d: `${d}L${x(t1)},${m.t + ih}L${x(t0)},${m.t + ih}Z` }));
  }
  if (pts.length > 1) svg.appendChild(svgEl("path", { class: "line", d }));

  const showDots = pts.length <= 40;
  const dots = pts.map((p) => {
    const c = svgEl("circle", { class: "dot", cx: x(p.t), cy: y(p.y), r: showDots ? 4 : 0 });
    svg.appendChild(c);
    return c;
  });

  // 只标注最新一个点的数值
  const last = pts[pts.length - 1];
  const ly = y(last.y);
  svg.appendChild(svgEl("text", {
    class: "label-strong",
    x: x(last.t),
    y: ly - 10 < m.t - 4 ? ly + 20 : ly - 10,
    "text-anchor": pts.length > 1 ? "end" : "middle",
  }, (o.lastFormat || fmt)(last.y)));

  const cross = svgEl("line", { class: "crosshair", y1: m.t, y2: m.t + ih, visibility: "hidden" });
  svg.appendChild(cross);

  const hit = svgEl("rect", { class: "hit", x: m.l - 10, y: 0, width: iw + 20, height: H });
  svg.appendChild(hit);
  container.appendChild(svg);

  const tip = makeTip(container);
  let active = -1;
  const onMove = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(pts[i].t) - px) < Math.abs(x(pts[best].t) - px)) best = i;
    if (active !== -1) dots[active].setAttribute("r", showDots ? 4 : 0);
    active = best;
    const p = pts[best];
    dots[best].setAttribute("r", 6);
    cross.setAttribute("x1", x(p.t));
    cross.setAttribute("x2", x(p.t));
    cross.setAttribute("visibility", "visible");
    tip.show(p.tip, x(p.t), y(p.y));
  };
  const onLeave = () => {
    if (active !== -1) dots[active].setAttribute("r", showDots ? 4 : 0);
    active = -1;
    cross.setAttribute("visibility", "hidden");
    tip.hide();
  };
  hit.addEventListener("pointermove", onMove);
  hit.addEventListener("pointerdown", onMove);
  hit.addEventListener("pointerleave", onLeave);
}

// 写作字数柱状图：每篇作文一根柱子，虚线标出该任务的最低字数要求。
function wordCountChart(container, entries) {
  container.innerHTML = "";
  const W = Math.max(container.clientWidth, 260);
  const H = 240;
  const m = { l: 48, r: 12, t: 16, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const minFor = (e) => (e.task === "Task 1" ? 150 : 250);
  const { hi, ticks } = niceScale(0, Math.max(...entries.map((e) => Math.max(e.wordCount, minFor(e)))), 4);
  const y = (v) => m.t + ih - (v / hi) * ih;
  const band = iw / entries.length;
  const bw = Math.max(6, Math.min(36, band - 2));

  const svg = svgEl("svg", { width: W, height: H, role: "img", "aria-label": "每篇作文字数" });
  for (const tv of ticks) {
    svg.appendChild(svgEl("line", { class: "grid", x1: m.l, x2: m.l + iw, y1: y(tv), y2: y(tv) }));
    svg.appendChild(svgEl("text", { x: m.l - 8, y: y(tv) + 4, "text-anchor": "end" }, tv));
  }
  svg.appendChild(svgEl("line", { class: "axis", x1: m.l, x2: m.l + iw, y1: y(0), y2: y(0) }));

  const labelEvery = Math.ceil(entries.length / Math.max(1, Math.floor(iw / 44)));
  const bars = [];
  entries.forEach((e, i) => {
    const cx = m.l + band * i + band / 2;
    const top = y(e.wordCount);
    const bottom = y(0);
    const r = Math.min(4, bw / 2, bottom - top);
    const x0 = cx - bw / 2;
    const x1 = cx + bw / 2;
    const path = `M${x0},${bottom}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${bottom}Z`;
    const bar = svgEl("path", { class: "bar " + (e.task === "Task 1" ? "bar-t1" : "bar-t2"), d: path });
    svg.appendChild(bar);
    bars.push(bar);
    const my = y(minFor(e));
    svg.appendChild(svgEl("line", { class: "min-tick", x1: cx - bw / 2 - 4, x2: cx + bw / 2 + 4, y1: my, y2: my }));
    if (i % labelEvery === 0) svg.appendChild(svgEl("text", { x: cx, y: H - 6, "text-anchor": "middle" }, shortDate(e.date)));
  });
  container.appendChild(svg);

  const tip = makeTip(container);
  entries.forEach((e, i) => {
    const cx = m.l + band * i + band / 2;
    const hitRect = svgEl("rect", { class: "hit", x: m.l + band * i, y: m.t, width: band, height: ih });
    const ok = e.wordCount >= minFor(e);
    const html =
      `<b>${esc(fmtDate(e.date))} · ${esc(e.task)}</b><br>` +
      (e.topic ? `<span class="muted">${esc(e.topic)}</span><br>` : "") +
      `字数 <b>${e.wordCount}</b>（要求至少 ${minFor(e)}）<br>${ok ? "✓ 达到字数要求" : "✗ 未达到字数要求"}`;
    const on = () => {
      bars.forEach((b, j) => b.classList.toggle("dim", j !== i));
      tip.show(html, cx, y(e.wordCount));
    };
    hitRect.addEventListener("pointerenter", on);
    hitRect.addEventListener("pointerdown", on);
    hitRect.addEventListener("pointerleave", () => {
      bars.forEach((b) => b.classList.remove("dim"));
      tip.hide();
    });
    svg.appendChild(hitRect);
  });
}

// ---------- 报告各板块 ----------

const chartJobs = [];

function chartSlot(render) {
  const id = "chart-" + chartJobs.length;
  chartJobs.push({ id, render });
  return `<div class="chart" id="${id}"></div>`;
}

function renderCharts() {
  for (const job of chartJobs) {
    const el = document.getElementById(job.id);
    if (el) job.render(el);
  }
}

function emptyBox(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

function heroHtml(data) {
  const s = data.student;
  const meta = [];
  if (s.targetBand) meta.push(`目标总分 <b>${fmtBand(s.targetBand)}</b>`);
  if (s.currentLevel) meta.push(`当前水平：${esc(s.currentLevel)}`);
  let countdown = "";
  if (s.examDate) {
    const days = daysUntil(s.examDate);
    countdown = `
      <div class="countdown">
        <div><div class="k">考试日期</div><div class="v num" style="font-size:17px;line-height:1.6">${esc(fmtDate(s.examDate))}</div></div>
        <div><div class="k">${days >= 0 ? "距离考试" : "考试已过去"}</div><div class="v num">${Math.abs(days)}<small>天</small></div></div>
      </div>`;
  }
  return `
    <section class="hero">
      <div>
        <h1>${esc(s.name)} 的雅思备考进度</h1>
        <p class="meta">${meta.map((x) => `<span>${x}</span>`).join("")}</p>
        <p class="meta updated">最近更新：${esc(fmtDate(data.updatedAt))}</p>
      </div>
      ${countdown}
    </section>
    ${s.teacherNote ? `<div class="note-card"><span class="label">老师寄语</span><p>${esc(s.teacherNote)}</p></div>` : ""}`;
}

function groupByDate(sortedEntries) {
  const groups = [];
  for (const e of sortedEntries) {
    const last = groups[groups.length - 1];
    if (last && last[0].date === e.date) last.push(e);
    else groups.push([e]);
  }
  return groups;
}

function practiceRate(entries) {
  return entries.map((e) => e.correct / e.total);
}

// 最近 n 次的平均，与再往前 n 次比较。
function recentVsPrevious(values, n = 5) {
  const recent = avg(values.slice(-n));
  const prev = values.length > n ? avg(values.slice(-2 * n, -n)) : null;
  return { recent, prev };
}

function tilesHtml(data) {
  const tiles = [];

  const vocab = [...data.vocab.entries].sort(byDate);
  if (vocab.length) {
    const latest = vocab[vocab.length - 1];
    const cutoff = toTime(latest.date) - 30 * 86400000;
    const base = [...vocab].reverse().find((e) => toTime(e.date) <= cutoff) || vocab[0];
    const gain = latest.known - base.known;
    tiles.push(`<a class="tile" href="#vocab"><div class="k">词汇量</div><div class="v num">${fmtInt(latest.known)}<small>词</small></div>
      <div class="d">${base === latest ? "首次记录" : `<span class="${deltaClass(gain)}">${signed(gain, " 词")}</span>（近 30 天）`}</div></a>`);
  } else tiles.push(`<a class="tile" href="#vocab"><div class="k">词汇量</div><div class="v">—</div><div class="d">暂无记录</div></a>`);

  for (const [key, name] of [["reading", "阅读正确率"], ["listening", "听力正确率"]]) {
    const entries = [...data[key].entries].sort(byDate);
    if (!entries.length) {
      tiles.push(`<a class="tile" href="#${key}"><div class="k">${name}</div><div class="v">—</div><div class="d">暂无记录</div></a>`);
      continue;
    }
    const { recent, prev } = recentVsPrevious(practiceRate(entries));
    const n = Math.min(5, entries.length);
    const diff = prev === null ? null : Math.round((recent - prev) * 100);
    tiles.push(`<a class="tile" href="#${key}"><div class="k">${name}<span style="color:var(--text-3)">（近 ${n} 次平均）</span></div>
      <div class="v num">${pct(recent)}</div>
      <div class="d">${diff === null ? `共 ${entries.length} 次练习` : `<span class="${deltaClass(diff)}">${signed(diff, " 个百分点")}</span>（与之前 ${n} 次相比）`}</div></a>`);
  }

  const essays = [...data.writing.entries].sort(byDate);
  if (essays.length) {
    const last = essays[essays.length - 1];
    const prevSame = essays.slice(0, -1).reverse().find((e) => e.task === last.task);
    const diff = prevSame ? last.wordCount - prevSame.wordCount : null;
    tiles.push(`<a class="tile" href="#writing"><div class="k">最近一篇作文（${esc(last.task)}）</div><div class="v num">${last.wordCount}<small>词</small></div>
      <div class="d">${diff === null ? `共 ${essays.length} 篇` : `<span class="${deltaClass(diff)}">${signed(diff, " 词")}</span>（与上一篇 ${esc(last.task)} 相比）`}</div></a>`);
  } else tiles.push(`<a class="tile" href="#writing"><div class="k">写作</div><div class="v">—</div><div class="d">暂无记录</div></a>`);

  return `<div class="tiles">${tiles.join("")}</div>`;
}

function vocabHtml(vocab) {
  const entries = [...vocab.entries].sort(byDate);
  let body;
  if (!entries.length) body = emptyBox("还没有词汇量记录");
  else {
    const latest = entries[entries.length - 1];
    const first = entries[0];
    const target = vocab.target;
    const progress = target ? Math.min(1, latest.known / target) : null;
    body = `
      <div class="summary-row">
        <span>当前词汇量 <b class="num">${fmtInt(latest.known)}</b> 词</span>
        ${target ? `<span>目标 <b class="num">${fmtInt(target)}</b> 词</span>` : ""}
        ${entries.length > 1 ? `<span>自 ${esc(fmtDate(first.date))} 起累计 <b class="num">${signed(latest.known - first.known, " 词")}</b></span>` : ""}
      </div>
      ${target ? `<div class="progress" role="progressbar" aria-valuenow="${Math.round(progress * 100)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${(progress * 100).toFixed(1)}%"></div></div>
      <div class="progress-label"><span>已完成目标的 ${pct(progress)}</span><span>${latest.known >= target ? "已达成目标" : `还差 ${fmtInt(target - latest.known)} 词`}</span></div>` : ""}
      <div class="sub-h">词汇量变化</div>
      ${chartSlot((el) =>
        lineChart(el, {
          label: "词汇量变化",
          area: true,
          target: target || null,
          targetLabel: target ? `目标 ${fmtInt(target)}` : "",
          yFormat: (v) => fmtInt(v),
          points: entries.map((e) => ({
            t: toTime(e.date),
            y: e.known,
            tip: `<b>${esc(fmtDate(e.date))}</b><br>词汇量 <b>${fmtInt(e.known)}</b> 词${e.note ? `<br><span class="muted">${esc(e.note)}</span>` : ""}`,
          })),
        })
      )}
      <details class="records">
        <summary>查看全部词汇记录（${entries.length} 条）</summary>
        <div class="table-wrap"><table>
          <thead><tr><th>日期</th><th class="r">词汇量</th><th class="r">变化</th><th>备注</th></tr></thead>
          <tbody>${entries
            .map((e, i) => ({ e, diff: i ? e.known - entries[i - 1].known : null }))
            .reverse()
            .map(({ e, diff }) => `<tr><td class="nowrap">${esc(fmtDate(e.date))}</td><td class="r">${fmtInt(e.known)}</td>
              <td class="r ${diff === null ? "" : deltaClass(diff)}">${diff === null ? "—" : signed(diff)}</td><td class="comment">${esc(e.note || "")}</td></tr>`)
            .join("")}</tbody>
        </table></div>
      </details>`;
  }
  return `<section class="section" id="vocab">
    <div class="section-head"><h2>词汇</h2><span class="hint">词汇量测试结果</span></div>
    ${body}
  </section>`;
}

function typeBreakdownHtml(entries) {
  const totals = {};
  for (const e of entries) {
    for (const [type, [c, t]] of Object.entries(e.byType || {})) {
      totals[type] ??= [0, 0];
      totals[type][0] += c;
      totals[type][1] += t;
    }
  }
  const rows = Object.entries(totals).map(([type, [c, t]]) => ({ type, c, t, rate: c / t }));
  if (!rows.length) return "";
  rows.sort((a, b) => a.rate - b.rate);
  return `
    <div class="sub-h">各题型正确率<span class="hint">所有练习累计，从低到高排列</span></div>
    <div class="types">${rows
      .map(
        (r) => `<div class="type-row">
          <span class="name" title="${esc(r.type)}">${esc(r.type)}${r.rate < 0.6 && r.t >= 5 ? '<span class="weak-flag">需加强</span>' : ""}</span>
          <div class="track"><div class="fill" style="width:${(r.rate * 100).toFixed(1)}%"></div></div>
          <span class="val num">${pct(r.rate)}<small>${r.c}/${r.t}</small></span>
        </div>`
      )
      .join("")}</div>`;
}

function practiceHtml(key, title, block, bandTable) {
  const entries = [...block.entries].sort(byDate);
  let body;
  if (!entries.length) body = emptyBox(`还没有${title}练习记录`);
  else {
    const rates = practiceRate(entries);
    const latest = entries[entries.length - 1];
    const { recent } = recentVsPrevious(rates);
    const best = Math.max(...rates);
    const latestBand = estimateBand(latest, bandTable);
    body = `
      <div class="summary-row">
        <span>共练习 <b class="num">${entries.length}</b> 次</span>
        <span>最近一次 <b class="num">${pct(rates[rates.length - 1])}</b>（${latest.correct}/${latest.total}${latestBand ? `，估算 ${fmtBand(latestBand)} 分` : ""}）</span>
        <span>近 ${Math.min(5, entries.length)} 次平均 <b class="num">${pct(recent)}</b></span>
        <span>最高 <b class="num">${pct(best)}</b></span>
      </div>
      <div class="sub-h">正确率变化</div>
      ${chartSlot((el) =>
        lineChart(el, {
          label: `${title}正确率变化`,
          yDomain: [0, 1],
          yTicks: [0, 0.25, 0.5, 0.75, 1],
          yFormat: pct,
          target: block.targetRate ?? null,
          targetLabel: block.targetRate ? `目标 ${pct(block.targetRate)}` : "",
          points: groupByDate(entries).map((day) => {
            if (day.length === 1) {
              const e = day[0];
              const b = estimateBand(e, bandTable);
              return {
                t: toTime(e.date),
                y: e.correct / e.total,
                tip: `<b>${esc(fmtDate(e.date))}</b><br>${e.material ? `${esc(e.material)}<br>` : ""}正确率 <b>${pct(e.correct / e.total)}</b>（${e.correct}/${e.total}）${b ? `<br>估算分数 ${fmtBand(b)}` : ""}`,
              };
            }
            // 同一天多次练习合并为一个点，按题数加权。
            const correct = day.reduce((s, e) => s + e.correct, 0);
            const total = day.reduce((s, e) => s + e.total, 0);
            return {
              t: toTime(day[0].date),
              y: correct / total,
              tip: `<b>${esc(fmtDate(day[0].date))}</b> · ${day.length} 次练习<br>合计正确率 <b>${pct(correct / total)}</b>（${correct}/${total}）<br>` +
                day.map((e) => `<span class="muted">${esc(e.material || "练习")}：${e.correct}/${e.total}</span>`).join("<br>"),
            };
          }),
        })
      )}
      ${typeBreakdownHtml(entries)}
      <details class="records">
        <summary>查看全部${title}记录（${entries.length} 条）</summary>
        <div class="table-wrap"><table>
          <thead><tr><th>日期</th><th>练习材料</th><th class="r">答对/总数</th><th class="r">正确率</th><th class="r">估算分数</th><th>备注</th></tr></thead>
          <tbody>${[...entries]
            .reverse()
            .map((e) => `<tr><td class="nowrap">${esc(fmtDate(e.date))}</td><td>${esc(e.material || "")}</td>
              <td class="r">${e.correct}/${e.total}</td><td class="r">${pct(e.correct / e.total)}</td>
              <td class="r">${fmtBand(estimateBand(e, bandTable))}</td><td class="comment">${esc(e.note || "")}</td></tr>`)
            .join("")}</tbody>
        </table></div>
      </details>`;
  }
  return `<section class="section" id="${key}">
    <div class="section-head"><h2>${title}</h2><span class="hint">估算分数仅适用于 40 题整套练习，仅供参考</span></div>
    ${body}
  </section>`;
}

function writingHtml(writing) {
  const entries = [...writing.entries].sort(byDate);
  let body;
  if (!entries.length) body = emptyBox("还没有写作记录");
  else {
    const t1 = entries.filter((e) => e.task === "Task 1");
    const t2 = entries.filter((e) => e.task === "Task 2");
    const meets = entries.filter((e) => e.wordCount >= (e.task === "Task 1" ? 150 : 250)).length;
    const scored = entries.filter((e) => typeof e.band === "number");
    const avgLine = (list) => (list.length ? `<b class="num">${Math.round(avg(list.map((e) => e.wordCount)))}</b> 词` : "—");

    const metric = (k, label, explain, format) => {
      const pts = entries.filter((e) => typeof e[k] === "number");
      if (!pts.length) return "";
      const last = pts[pts.length - 1];
      return `<div class="mini">
        <div class="k">${label}</div>
        <div class="v num">${format(last[k])}</div>
        <div class="explain">${explain}</div>
        ${chartSlot((el) =>
          lineChart(el, {
            compact: true,
            height: 130,
            label,
            yFormat: format,
            points: pts.map((e) => ({
              t: toTime(e.date),
              y: e[k],
              tip: `<b>${esc(fmtDate(e.date))} · ${esc(e.task)}</b><br>${label} <b>${format(e[k])}</b>`,
            })),
          })
        )}
      </div>`;
    };

    const metrics = [
      metric("avgSentenceLength", "平均句长", "每句平均词数。句子更长通常说明句式更丰富。", (v) => (Math.round(v * 10) / 10).toString()),
      metric("complexSentenceRatio", "复杂句占比", "含有从句（because、although、which 等）的句子比例。", pct),
      metric("lexicalDiversity", "词汇多样性", "每 50 个词中不重复词的比例，越高说明用词越丰富。", (v) => (Math.round(v * 100) / 100).toFixed(2)),
    ].join("");

    body = `
      <div class="summary-row">
        <span>共 <b class="num">${entries.length}</b> 篇</span>
        <span>Task 1 平均 ${avgLine(t1)}</span>
        <span>Task 2 平均 ${avgLine(t2)}</span>
        <span>达到字数要求 <b class="num">${meets}/${entries.length}</b> 篇</span>
        ${scored.length ? `<span>最近一次老师评分 <b class="num">${fmtBand(scored[scored.length - 1].band)}</b></span>` : ""}
      </div>
      <div class="sub-h">每篇作文字数</div>
      <div class="legend">
        ${t2.length ? '<span><i style="background:var(--series-1)"></i>Task 2（大作文，至少 250 词）</span>' : ""}
        ${t1.length ? '<span><i style="background:var(--series-2)"></i>Task 1（小作文，至少 150 词）</span>' : ""}
        <span><i class="dash"></i>最低字数要求</span>
      </div>
      ${chartSlot((el) => wordCountChart(el, entries))}
      ${metrics ? `<div class="sub-h">句子与用词复杂度<span class="hint">由程序统一计算，便于前后对比</span></div><div class="mini-grid">${metrics}</div>` : ""}
      <details class="records">
        <summary>查看全部作文记录（${entries.length} 篇）</summary>
        <div class="table-wrap"><table>
          <thead><tr><th>日期</th><th>任务</th><th>题目</th><th class="r">字数</th><th class="r">平均句长</th><th class="r">复杂句</th><th class="r">多样性</th><th class="r">评分</th><th>老师评语</th></tr></thead>
          <tbody>${[...entries]
            .reverse()
            .map((e) => `<tr><td class="nowrap">${esc(fmtDate(e.date))}</td><td class="nowrap">${esc(e.task)}</td><td>${esc(e.topic || "")}</td>
              <td class="r">${e.wordCount}</td>
              <td class="r">${typeof e.avgSentenceLength === "number" ? e.avgSentenceLength : "—"}</td>
              <td class="r">${typeof e.complexSentenceRatio === "number" ? pct(e.complexSentenceRatio) : "—"}</td>
              <td class="r">${typeof e.lexicalDiversity === "number" ? e.lexicalDiversity.toFixed(2) : "—"}</td>
              <td class="r">${fmtBand(e.band)}</td><td class="comment">${esc(e.comment || "")}</td></tr>`)
            .join("")}</tbody>
        </table></div>
      </details>`;
  }
  return `<section class="section" id="writing">
    <div class="section-head"><h2>写作</h2><span class="hint">作文长度与复杂度</span></div>
    ${body}
  </section>`;
}

function renderReport(data) {
  chartJobs.length = 0;
  document.title = `${data.student.name} · 雅思备考进度`;
  $("report").innerHTML = [
    heroHtml(data),
    tilesHtml(data),
    vocabHtml(data.vocab),
    practiceHtml("reading", "阅读", data.reading, READING_BANDS),
    practiceHtml("listening", "听力", data.listening, LISTENING_BANDS),
    writingHtml(data.writing),
    `<footer>本页面数据由老师定期更新 · 如有疑问请联系老师</footer>`,
  ].join("");
  renderCharts();
}

let resizeTimer;
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderCharts, 120);
});

// ---------- 登录与会话 ----------

async function fetchEnvelope(fileId) {
  const res = await fetch(`data/${fileId}.json`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("network");
  return res.json();
}

function saveSession(fileId, rawKey) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ fileId, key: toB64(rawKey) }));
  } catch {}
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}

function show(view) {
  $("loading-view").hidden = view !== "loading";
  $("login-view").hidden = view !== "login";
  $("app-view").hidden = view !== "app";
}

function showLoginError(msg) {
  const el = $("login-error");
  el.textContent = msg;
  el.hidden = !msg;
}

async function openReport(envelope, rawKey) {
  const data = await decryptEnvelopeData(envelope, rawKey);
  show("app");
  renderReport(data);
}

$("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const username = $("username").value;
  const password = $("password").value;
  const btn = $("login-btn");
  showLoginError("");
  btn.disabled = true;
  btn.textContent = "正在验证…";
  try {
    const fileId = await fileIdFor(username);
    const envelope = await fetchEnvelope(fileId);
    if (!envelope) throw new Error("auth");
    let rawKey;
    try {
      rawKey = await unlockWithPassword(envelope, password);
    } catch {
      throw new Error("auth");
    }
    saveSession(fileId, rawKey);
    $("password").value = "";
    await openReport(envelope, rawKey);
  } catch (e) {
    showLoginError(e.message === "auth" ? "用户名或密码错误，请重新输入。" : "网络连接失败，请检查网络后重试。");
  } finally {
    btn.disabled = false;
    btn.textContent = "登录";
  }
});

$("logout-btn").addEventListener("click", () => {
  clearSession();
  $("report").innerHTML = "";
  document.title = "雅思备考进度";
  show("login");
  $("username").focus();
});

async function boot() {
  const session = readSession();
  if (session) {
    try {
      const envelope = await fetchEnvelope(session.fileId);
      if (envelope) {
        await openReport(envelope, fromB64(session.key));
        return;
      }
    } catch {}
    clearSession();
  }
  show("login");
}

boot();
