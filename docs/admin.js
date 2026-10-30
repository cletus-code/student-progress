// 老师后台：用管理密钥在浏览器里解密学生数据，编辑课表，重新加密后通过 GitHub API 提交到仓库。
// 管理密钥只留在内存里；GitHub 令牌（只允许修改本仓库）可选择记在这台设备上。

import { deriveKey, fromB64, decryptBytes, decryptJson, encryptJson, importDataKey } from "./crypto.js?v=f2f942ec75";
import { validateStudentData } from "./schema.js?v=a157718551";
import { renderCalendar } from "./calendar.js?v=12a87b2523";

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "ielts-gh-token";
const INDEX_PATH = "admin/index.enc.json";

// 部署在 <owner>.github.io/<repo>/ 时从网址推出仓库；本地预览时用默认值。
const REPO = location.hostname.endsWith(".github.io")
  ? { owner: location.hostname.split(".")[0], name: location.pathname.split("/")[1] }
  : { owner: "cletus-code", name: "student-progress" };

let token = "";
let kek = null; // 由管理密钥派生，不可导出
let index = null; // { students: { slug: { name, username, password, fileId } } }
let cur = null; // 当前学生 { slug, path, sha, envelope, rawKey, data, saved }

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

// ---------- GitHub ----------

class GhError extends Error {}

async function gh(path, opts = {}) {
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${path}`, {
      ...opts,
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...opts.headers },
    });
  } catch {
    throw new GhError("连不上 GitHub，请检查网络。");
  }
  if (res.ok) return res.json();
  if (res.status === 401) throw new GhError("GitHub 令牌无效或已过期，请重新生成。");
  if (res.status === 403 || res.status === 404) throw new GhError("GitHub 令牌没有这个仓库的权限：请确认选了本仓库，且 Contents 为 Read and write。");
  if (res.status === 409 || res.status === 422) throw new GhError("数据刚被别处（例如 Claude/Codex）修改过。请刷新页面重新登录后再改。");
  throw new GhError(`GitHub 返回错误 ${res.status}`);
}

async function readRepoFile(path) {
  const r = await gh(`${path}?ref=main`);
  const bin = atob(r.content.replace(/\n/g, ""));
  const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  return { sha: r.sha, json: JSON.parse(text) };
}

async function writeRepoFile(path, text, sha) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const r = await gh(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Update progress data", content: btoa(bin), sha, branch: "main" }),
  });
  return r.content.sha;
}

// ---------- 登录 ----------

function showError(msg) {
  $("login-error").textContent = msg;
  $("login-error").hidden = !msg;
}

try {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) $("gh-token").value = saved;
} catch {}

$("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  showError("");
  const btn = $("login-btn");
  btn.disabled = true;
  btn.textContent = "正在验证…";
  try {
    token = $("gh-token").value.trim();
    const { json: file } = await readRepoFile(INDEX_PATH);
    kek = await deriveKey($("admin-key").value, fromB64(file.salt), file.iterations);
    try {
      index = await decryptJson(kek, file);
    } catch {
      throw new GhError("管理密钥不正确。");
    }
    try {
      if ($("remember").checked) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
    $("admin-key").value = "";
    const slugs = Object.keys(index.students);
    $("student-select").innerHTML = slugs.map((s) => `<option value="${esc(s)}">${esc(index.students[s].name)}</option>`).join("");
    $("login-view").hidden = true;
    $("app-view").hidden = false;
    if (slugs.length) await loadStudent(slugs[0]);
    else $("editor").innerHTML = `<div class="empty">还没有学生</div>`;
  } catch (e) {
    showError(e instanceof GhError ? e.message : "出错了：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "登录";
  }
});

$("logout-btn").addEventListener("click", () => {
  if (isDirty() && !confirm("有未保存的修改，确定退出吗？")) return;
  location.reload();
});

$("student-select").addEventListener("change", async (ev) => {
  if (isDirty() && !confirm("有未保存的修改，切换学生会丢失这些修改。继续吗？")) {
    ev.target.value = cur.slug;
    return;
  }
  await loadStudent(ev.target.value);
});

window.addEventListener("beforeunload", (ev) => {
  if (isDirty()) ev.preventDefault();
});

async function loadStudent(slug) {
  const s = index.students[slug];
  const path = `docs/data/${s.fileId}.json`;
  $("editor").innerHTML = `<div class="loading">正在加载…</div>`;
  const { sha, json: envelope } = await readRepoFile(path);
  const rawKey = await decryptBytes(kek, envelope.admin);
  const data = await decryptJson(await importDataKey(rawKey), envelope.data);
  data.schedule ??= [];
  cur = { slug, path, sha, envelope, rawKey, data, saved: JSON.stringify(data) };
  render();
}

// ---------- 编辑 ----------

const isDirty = () => cur && JSON.stringify(cur.data) !== cur.saved;

function sortSchedule() {
  cur.data.schedule.sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
}

function effectiveStatus(e) {
  return e.status || (e.date < today() ? "done" : "planned");
}

// 上课状态改成/改离“已上课”时，同步调整“已上节数”。
function setStatus(e, status) {
  const before = effectiveStatus(e);
  e.status = status;
  const s = cur.data.student;
  if (typeof s.lessonsDone === "number") {
    if (before !== "done" && status === "done") s.lessonsDone++;
    if (before === "done" && status !== "done") s.lessonsDone = Math.max(0, s.lessonsDone - 1);
  }
}

function nextLessonNumber() {
  const nums = cur.data.schedule.map((e) => e.lesson).filter((n) => Number.isInteger(n));
  return nums.length ? Math.max(...nums) + 1 : (cur.data.student.lessonsDone || 0) + 1;
}

function rowHtml(e, i) {
  const st = effectiveStatus(e);
  return `<div class="ed-row ${st}" data-i="${i}">
    <input type="date" data-f="date" value="${esc(e.date)}" aria-label="日期">
    <span class="ed-time"><input type="time" data-f="start" value="${esc(e.start || "")}" aria-label="开始时间">–<input type="time" data-f="end" value="${esc(e.end || "")}" aria-label="结束时间"></span>
    <label class="ed-lesson">第<input type="number" min="1" data-f="lesson" value="${e.lesson ?? ""}" aria-label="第几课">课</label>
    <input type="text" data-f="note" value="${esc(e.note || "")}" placeholder="备注（家长可见）" aria-label="备注">
    <select data-f="status" aria-label="状态">
      <option value="planned"${st === "planned" ? " selected" : ""}>待上课</option>
      <option value="done"${st === "done" ? " selected" : ""}>已上课</option>
      <option value="cancelled"${st === "cancelled" ? " selected" : ""}>已取消</option>
    </select>
    <button type="button" class="btn-ghost ed-del" data-del="${i}" aria-label="删除">删除</button>
  </div>`;
}

function render() {
  sortSchedule();
  const d = cur.data;
  const s = d.student;
  const t = today();
  const rows = d.schedule.map((e, i) => ({ e, i }));
  const upcoming = rows.filter(({ e }) => e.date >= t || effectiveStatus(e) === "planned");
  const past = rows.filter(({ e }) => !(e.date >= t || effectiveStatus(e) === "planned")).reverse();
  const nextNum = nextLessonNumber();

  $("editor").innerHTML = `
    <section class="hero"><div>
      <h1>${esc(s.name)} 的课表</h1>
      <p class="meta"><span>修改后点底部“保存并发布”，家长页面约 1 分钟内更新。</span></p>
    </div></section>

    <section class="section">
      <div class="section-head"><h2>课时</h2></div>
      <div class="ed-lessons">
        <label>已上 <input type="number" min="0" id="lessons-done" value="${s.lessonsDone ?? ""}"> 节</label>
        <label>课程包共 <input type="number" min="1" id="lessons-total" value="${s.lessonsTotal ?? ""}"> 节</label>
        <span class="hint">把课改成“已上课”时，已上节数会自动 +1</span>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>添加课程</h2></div>
      <form id="add-form" class="ed-add">
        <label>日期<input type="date" name="date" required value="${addDays(t, 1)}"></label>
        <label>开始<input type="time" name="start" value="${esc(d.schedule.filter((e) => e.start).at(-1)?.start || "16:00")}"></label>
        <label>结束<input type="time" name="end" value="${esc(d.schedule.filter((e) => e.end).at(-1)?.end || "17:30")}"></label>
        <label>第几课<input type="number" name="lesson" min="1" value="${nextNum}"></label>
        <label>每周重复<select name="repeat">${[1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20].map((n) => `<option value="${n}">${n === 1 ? "不重复" : `共 ${n} 次`}</option>`).join("")}</select></label>
        <label class="wide">备注<input type="text" name="note" placeholder="可不填，例如：听力模考"></label>
        <button class="btn-primary" type="submit">添加</button>
      </form>
    </section>

    <section class="section">
      <div class="section-head"><h2>即将上课</h2><span class="hint">取消的课建议改成“已取消”而不是删除，家长能看到变动</span></div>
      ${upcoming.length ? `<div class="ed-list">${upcoming.map(({ e, i }) => rowHtml(e, i)).join("")}</div>` : `<div class="empty">还没有排课，在上面添加</div>`}
    </section>

    <section class="section">
      <details class="records">
        <summary>过去的课（${past.length} 节）</summary>
        <div class="ed-list">${past.map(({ e, i }) => rowHtml(e, i)).join("")}</div>
      </details>
    </section>

    <div class="sub-h">家长看到的效果（预览）</div>
    <div id="preview" class="preview"></div>`;

  renderCalendar($("preview"), d);
  updateSaveBar();

  $("lessons-done").addEventListener("input", (ev) => {
    s.lessonsDone = ev.target.value === "" ? undefined : Number(ev.target.value);
    changed(false);
  });
  $("lessons-total").addEventListener("input", (ev) => {
    s.lessonsTotal = ev.target.value === "" ? undefined : Number(ev.target.value);
    changed(false);
  });

  $("add-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const n = Number(f.get("repeat"));
    let lesson = f.get("lesson") ? Number(f.get("lesson")) : null;
    for (let k = 0; k < n; k++) {
      const e = { date: addDays(f.get("date"), 7 * k), status: "planned" };
      if (f.get("start")) e.start = f.get("start");
      if (f.get("end")) e.end = f.get("end");
      if (lesson) e.lesson = lesson++;
      if (f.get("note")) e.note = f.get("note").trim();
      d.schedule.push(e);
    }
    changed(true);
  });

  $("editor").querySelectorAll(".ed-row").forEach((row) => {
    const e = d.schedule[Number(row.dataset.i)];
    row.querySelectorAll("[data-f]").forEach((input) =>
      input.addEventListener("change", () => {
        const f = input.dataset.f;
        const v = input.value.trim();
        if (f === "status") setStatus(e, v);
        else if (f === "lesson") v ? (e.lesson = Number(v)) : delete e.lesson;
        else if (v) e[f] = v;
        else if (f !== "date") delete e[f];
        changed(f === "date" || f === "status");
      })
    );
  });
  $("editor").querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      const e = d.schedule[Number(b.dataset.del)];
      if (!confirm(`删除 ${e.date} 的课？（如果只是不上了，建议改成“已取消”）`)) return;
      if (effectiveStatus(e) === "done" && typeof s.lessonsDone === "number") s.lessonsDone = Math.max(0, s.lessonsDone - 1);
      d.schedule.splice(Number(b.dataset.del), 1);
      changed(true);
    })
  );
}

// structural = 需要整页重画（顺序或状态变了）；否则只刷新预览和保存栏，保留输入框焦点。
function changed(structural) {
  if (structural) render();
  else {
    renderCalendar($("preview"), cur.data);
    updateSaveBar();
  }
}

function updateSaveBar(msg) {
  const dirty = isDirty();
  $("save-bar").hidden = !dirty && !msg;
  $("save-msg").textContent = msg || "有未保存的修改";
  $("save-btn").hidden = !dirty;
  $("discard-btn").hidden = !dirty;
}

$("discard-btn").addEventListener("click", () => {
  if (!confirm("放弃所有未保存的修改？")) return;
  cur.data = JSON.parse(cur.saved);
  render();
});

$("save-btn").addEventListener("click", async () => {
  sortSchedule();
  const problems = validateStudentData(cur.data);
  if (problems.length) {
    alert("数据有问题，未保存：\n" + problems.join("\n"));
    return;
  }
  const btn = $("save-btn");
  btn.disabled = true;
  btn.textContent = "正在保存…";
  try {
    cur.data.updatedAt = today();
    const envelope = { ...cur.envelope, data: await encryptJson(await importDataKey(cur.rawKey), cur.data) };
    cur.sha = await writeRepoFile(cur.path, JSON.stringify(envelope, null, 2) + "\n", cur.sha);
    cur.envelope = envelope;
    cur.saved = JSON.stringify(cur.data);
    updateSaveBar("已保存 ✓ 家长页面约 1 分钟内更新");
    setTimeout(() => !isDirty() && updateSaveBar(), 6000);
  } catch (e) {
    alert(e instanceof GhError ? e.message : "保存失败：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "保存并发布";
  }
});
