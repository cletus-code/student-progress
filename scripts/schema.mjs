// 学生数据的结构说明与校验。字段说明见 AGENTS.md。

export function emptyStudentData(name) {
  return {
    schemaVersion: 1,
    student: {
      name,
      targetBand: null,
      examDate: null,
      currentLevel: "",
      teacherNote: "",
    },
    updatedAt: new Date().toISOString().slice(0, 10),
    vocab: { target: null, entries: [] },
    reading: { targetRate: null, entries: [] },
    listening: { targetRate: null, entries: [] },
    writing: { entries: [] },
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function checkDate(problems, where, v, { optional = false } = {}) {
  if (optional && (v === null || v === undefined || v === "")) return;
  if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
    problems.push(`${where}：日期必须是 YYYY-MM-DD 格式，现在是 ${JSON.stringify(v)}`);
  }
}

function checkRate(problems, where, v) {
  if (v === null || v === undefined) return;
  if (!isNum(v) || v < 0 || v > 1) problems.push(`${where}：必须是 0 到 1 之间的小数（例如 0.8 表示 80%）`);
}

function checkPractice(problems, section, block) {
  if (!block || !Array.isArray(block.entries)) {
    problems.push(`${section}.entries 必须是数组`);
    return;
  }
  checkRate(problems, `${section}.targetRate`, block.targetRate);
  block.entries.forEach((e, i) => {
    const w = `${section}.entries[${i}]`;
    checkDate(problems, w + ".date", e.date);
    if (!isNum(e.correct) || !isNum(e.total) || e.total <= 0 || e.correct < 0 || e.correct > e.total) {
      problems.push(`${w}：correct 和 total 必须是数字，且 0 ≤ correct ≤ total，total > 0`);
    }
    if (e.byType !== undefined) {
      if (typeof e.byType !== "object" || e.byType === null || Array.isArray(e.byType)) {
        problems.push(`${w}.byType 必须是对象，例如 {"判断题": [7, 10]}`);
      } else {
        for (const [t, pair] of Object.entries(e.byType)) {
          if (!Array.isArray(pair) || pair.length !== 2 || !isNum(pair[0]) || !isNum(pair[1]) || pair[1] <= 0 || pair[0] < 0 || pair[0] > pair[1]) {
            problems.push(`${w}.byType["${t}"] 必须是 [答对数, 总题数]`);
          }
        }
      }
    }
  });
}

export function validateStudentData(d) {
  const problems = [];
  if (!d || typeof d !== "object") return ["数据必须是一个 JSON 对象"];
  if (!d.student || typeof d.student.name !== "string" || !d.student.name) problems.push("student.name 不能为空");
  if (d.student) {
    const tb = d.student.targetBand;
    if (tb !== null && tb !== undefined && (!isNum(tb) || tb < 0 || tb > 9)) problems.push("student.targetBand 必须是 0–9 的数字");
    checkDate(problems, "student.examDate", d.student.examDate, { optional: true });
    const { lessonsDone, lessonsTotal } = d.student;
    if (lessonsDone !== undefined && lessonsDone !== null && (!Number.isInteger(lessonsDone) || lessonsDone < 0)) problems.push("student.lessonsDone 必须是非负整数");
    if (lessonsTotal !== undefined && lessonsTotal !== null && (!Number.isInteger(lessonsTotal) || lessonsTotal <= 0)) problems.push("student.lessonsTotal 必须是正整数");
  }

  if (!d.vocab || !Array.isArray(d.vocab.entries)) problems.push("vocab.entries 必须是数组");
  else {
    if (d.vocab.target !== null && d.vocab.target !== undefined && (!isNum(d.vocab.target) || d.vocab.target <= 0)) problems.push("vocab.target 必须是正数");
    d.vocab.entries.forEach((e, i) => {
      const w = `vocab.entries[${i}]`;
      checkDate(problems, w + ".date", e.date);
      if (e.words === undefined && e.known === undefined) problems.push(`${w} 需要 words（单词列表）或 known（词汇量）`);
      if (e.known !== undefined && (!isNum(e.known) || e.known < 0)) problems.push(`${w}.known 必须是非负数字`);
      if (e.words !== undefined) {
        if (!Array.isArray(e.words)) problems.push(`${w}.words 必须是数组`);
        else e.words.forEach((x, j) => {
          const word = typeof x === "string" ? x : x && x.w;
          if (typeof word !== "string" || !word.trim()) problems.push(`${w}.words[${j}] 必须是字符串或 {"w": "单词", "m": "释义"}`);
        });
      }
    });
  }

  checkPractice(problems, "reading", d.reading);
  checkPractice(problems, "listening", d.listening);

  if (!d.writing || !Array.isArray(d.writing.entries)) problems.push("writing.entries 必须是数组");
  else {
    d.writing.entries.forEach((e, i) => {
      const w = `writing.entries[${i}]`;
      checkDate(problems, w + ".date", e.date);
      if (e.task !== "Task 1" && e.task !== "Task 2") problems.push(`${w}.task 必须是 "Task 1" 或 "Task 2"`);
      if (!isNum(e.wordCount) || e.wordCount < 0) problems.push(`${w}.wordCount 必须是非负数字`);
      for (const k of ["avgSentenceLength", "complexSentenceRatio", "lexicalDiversity", "band"]) {
        if (e[k] !== undefined && e[k] !== null && !isNum(e[k])) problems.push(`${w}.${k} 必须是数字`);
      }
      checkRate(problems, w + ".complexSentenceRatio", e.complexSentenceRatio);
      checkRate(problems, w + ".lexicalDiversity", e.lexicalDiversity);
    });
  }
  return problems;
}
