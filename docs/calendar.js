// 课表：月历 + 即将上课列表 + 上课记录，可导出 .ics 加入手机日历。
// 数据来自 data.schedule（老师维护）和 data.student.examDate。家长只能查看。

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const KIND_LABEL = { done: "已上课", planned: "待上课", cancelled: "已取消", exam: "考试" };

let shown = null; // 当前显示的月份 { y, m }，m 为 0–11

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const weekday = (s) => "周" + WEEKDAYS[(parse(s).getDay() + 6) % 7];
const cnDate = (s) => {
  const d = parse(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};
const timeRange = (e) => (e.start ? (e.end ? `${e.start}–${e.end}` : e.start) : "");

// 把 schedule 和考试日期整理成按日期排序的事件列表。未写 status 的课：今天之前算已上，之后算待上。
function events(data) {
  const today = ymd(new Date());
  const list = (data.schedule || []).map((e) => ({
    ...e,
    kind: e.status === "cancelled" ? "cancelled" : e.status === "done" || (!e.status && e.date < today) ? "done" : "planned",
  }));
  if (data.student.examDate) list.push({ date: data.student.examDate, kind: "exam", note: "雅思考试" });
  return list.sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
}

function chipText(e) {
  if (e.kind === "exam") return "考试";
  if (e.kind === "cancelled") return "取消";
  return e.start || (e.lesson ? `第${e.lesson}课` : "上课");
}

// 手机上格子很窄，只放得下两个字或一个时间。
function chipShort(e) {
  if (e.kind === "exam") return "考试";
  if (e.kind === "cancelled") return "取消";
  return e.start || "上课";
}

function monthHtml(evs) {
  const { y, m } = shown;
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7; // 周一开头
  const days = new Date(y, m + 1, 0).getDate();
  const today = ymd(new Date());
  const byDate = new Map();
  for (const e of evs) byDate.set(e.date, [...(byDate.get(e.date) || []), e]);

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(`<div class="cal-cell empty"></div>`);
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${pad(m + 1)}-${pad(d)}`;
    const dayEvents = byDate.get(key) || [];
    const title = dayEvents
      .map((e) => `${KIND_LABEL[e.kind]}${e.lesson ? ` 第${e.lesson}课` : ""}${timeRange(e) ? ` ${timeRange(e)}` : ""}${e.note && e.kind !== "exam" ? ` · ${e.note}` : ""}`)
      .join("\n");
    cells.push(`<div class="cal-cell${key === today ? " today" : ""}${dayEvents.length ? " has" : ""}"${title ? ` title="${esc(title)}"` : ""}>
      <span class="cal-day num">${d}</span>
      ${dayEvents.map((e) => `<span class="cal-chip ${e.kind}"><span class="full">${esc(chipText(e))}</span><span class="short">${esc(chipShort(e))}</span></span>`).join("")}
    </div>`);
  }
  return `
    <div class="cal-head">
      <button class="btn-ghost cal-nav" data-step="-1" type="button" aria-label="上个月">‹</button>
      <b class="cal-month num">${y}年${m + 1}月</b>
      <button class="btn-ghost cal-nav" data-step="1" type="button" aria-label="下个月">›</button>
      <button class="btn-ghost cal-today" type="button">本月</button>
    </div>
    <div class="cal-grid">
      ${WEEKDAYS.map((w) => `<div class="cal-wd">${w}</div>`).join("")}
      ${cells.join("")}
    </div>
    <div class="legend cal-legend">
      <span><i class="cal-key done"></i>已上课</span>
      <span><i class="cal-key planned"></i>待上课</span>
      <span><i class="cal-key exam"></i>考试</span>
      <span><i class="cal-key cancelled"></i>已取消</span>
    </div>`;
}

function rowHtml(e) {
  return `<div class="cal-row ${e.kind}">
    <div class="cal-row-date"><b class="num">${esc(cnDate(e.date))}</b> <span>${weekday(e.date)}</span></div>
    <div class="cal-row-main">
      <span class="cal-chip ${e.kind}">${KIND_LABEL[e.kind]}</span>
      ${e.lesson ? `<span>第${e.lesson}课</span>` : ""}
      ${timeRange(e) ? `<span class="num">${esc(timeRange(e))}</span>` : ""}
      ${e.note && e.kind !== "exam" ? `<span class="muted">${esc(e.note)}</span>` : ""}
    </div>
  </div>`;
}

// 生成 .ics（时间按上课地的当地时间，不带时区）。
function icsFor(evs, name) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const compact = (s) => s.replace(/-/g, "");
  const nextDay = (s) => ymd(new Date(parse(s).getTime() + 86400000));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ielts-progress//CN", "CALSCALE:GREGORIAN"];
  for (const e of evs) {
    const summary = e.kind === "exam" ? `${name} 雅思考试` : `${name} 雅思课${e.lesson ? ` 第${e.lesson}课` : ""}`;
    lines.push("BEGIN:VEVENT", `UID:${compact(e.date)}-${(e.start || "allday").replace(":", "")}-${e.kind}@ielts-progress`, `DTSTAMP:${stamp}`);
    if (e.start) {
      const t = (hm) => hm.replace(":", "") + "00";
      lines.push(`DTSTART:${compact(e.date)}T${t(e.start)}`, `DTEND:${compact(e.date)}T${t(e.end || e.start)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(nextDay(e.date))}`);
    }
    lines.push(`SUMMARY:${summary}`);
    if (e.note && e.kind !== "exam") lines.push(`DESCRIPTION:${e.note.replace(/[,;\\]/g, (c) => "\\" + c)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function renderCalendar(el, data) {
  const evs = events(data);
  const s = data.student;
  if (!shown) {
    const now = new Date();
    shown = { y: now.getFullYear(), m: now.getMonth() };
  }
  const upcoming = evs.filter((e) => e.kind === "planned" || (e.kind === "exam" && e.date >= ymd(new Date())));
  const nextClass = upcoming.find((e) => e.kind === "planned");
  const done = evs.filter((e) => e.kind === "done");
  const left = typeof s.lessonsTotal === "number" && typeof s.lessonsDone === "number" ? Math.max(0, s.lessonsTotal - s.lessonsDone) : null;
  const plannedCount = upcoming.filter((e) => e.kind === "planned").length;
  const unscheduled = left === null ? 0 : Math.max(0, left - plannedCount);

  el.innerHTML = `
    <section class="hero">
      <div>
        <h1>${esc(s.name)} 的课表</h1>
        <p class="meta">
          ${typeof s.lessonsDone === "number" ? `<span>已上 <b class="num">${s.lessonsDone}</b> 节</span>` : ""}
          ${left !== null ? `<span>剩余 <b class="num">${left}</b> 节</span>` : ""}
          <span>下次上课：<b>${nextClass ? `${esc(cnDate(nextClass.date))} ${weekday(nextClass.date)}${timeRange(nextClass) ? " " + esc(timeRange(nextClass)) : ""}` : "待老师安排"}</b></span>
        </p>
      </div>
    </section>
    <section class="section">${monthHtml(evs)}</section>
    <section class="section">
      <div class="section-head"><h2>即将上课</h2>
        ${upcoming.length ? `<button class="btn-ghost" id="ics-btn" type="button">添加到手机日历</button>` : ""}
      </div>
      ${upcoming.length ? `<div class="cal-list">${upcoming.map(rowHtml).join("")}</div>` : `<div class="empty">暂时没有排好的课</div>`}
      ${unscheduled ? `<p class="cal-note">还有 <b class="num">${unscheduled}</b> 节课待安排时间，老师排好后会更新在这里。</p>` : ""}
    </section>
    ${done.length ? `<section class="section">
      <details class="records">
        <summary>上课记录（${done.length} 次）</summary>
        <div class="cal-list">${[...done].reverse().map(rowHtml).join("")}</div>
      </details>
    </section>` : ""}
    <footer>课表由老师更新 · 如需调课请直接联系老师</footer>`;

  el.querySelectorAll(".cal-nav").forEach((b) =>
    b.addEventListener("click", () => {
      const d = new Date(shown.y, shown.m + Number(b.dataset.step), 1);
      shown = { y: d.getFullYear(), m: d.getMonth() };
      renderCalendar(el, data);
    })
  );
  el.querySelector(".cal-today").addEventListener("click", () => {
    shown = null;
    renderCalendar(el, data);
  });
  const ics = el.querySelector("#ics-btn");
  if (ics) {
    ics.addEventListener("click", () => {
      const blob = new Blob([icsFor(upcoming, s.name)], { type: "text/calendar;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ielts-classes.ics"; // 用英文文件名：部分浏览器会丢掉中文文件名，变成没有扩展名的 "download"
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    });
  }
}
