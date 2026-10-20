# Instructions for AI agents (Claude Code, Codex)

This repo hosts a static, all-Chinese IELTS progress report site (`docs/`, served by GitHub Pages).
Parents log in with a username + password to see **their own child's** report.

The teacher will send you messages like:

> 小明今天做了剑桥18 Test 2 阅读，32/40，判断题错了5个（共13题）。词汇测试 6300。

Your job: turn that into structured data for the right student, re-encrypt it, commit, and push.

## Security model (read this first)

- Student data is **never stored in plaintext in git**. Each student's file in `docs/data/<hash>.json` is
  AES-256-GCM encrypted. The parent's password unlocks it in the browser. The teacher's **admin key**
  (`IELTS_ADMIN_KEY` env var) unlocks it for editing.
- `admin/index.enc.json` (encrypted with the admin key) maps student code → name, parent username/password, data file.
- `work/` holds decrypted plaintext while you edit. It is git-ignored. **Never commit it, never `git add -f` it.**
- Never print, log, or commit `IELTS_ADMIN_KEY`. Don't put student names, scores, or passwords in commit messages.
  Use messages like `Update progress data`.
- If `IELTS_ADMIN_KEY` is not set, stop and ask the teacher for it (or ask them to set it as an environment
  variable). Don't guess or generate a new one: that would lock everyone out of existing data.

## Update workflow

```bash
node scripts/admin.mjs list                 # find the student code (代号)
node scripts/admin.mjs open <code>          # decrypt → work/<code>.json
# … edit work/<code>.json …
node scripts/admin.mjs save <code>          # validate, set updatedAt, re-encrypt
git add docs/data admin && git commit -m "Update progress data" && git push
```

`save` validates the JSON and refuses bad data. Fix what it reports and run it again.
Keep entries in any order; the site sorts by date. Don't delete existing entries unless the teacher asks.
If the teacher gives no date, use today's date. If a student's name is ambiguous, ask.

Other commands:

```bash
node scripts/admin.mjs add <code> --name 张小明 [--username xxx] [--password yyy]   # new student; prints parent login
node scripts/admin.mjs login <code>                     # show parent's username/password to the teacher
node scripts/admin.mjs set-password <code> [--password yyy]
node scripts/admin.mjs remove <code>
node scripts/admin.mjs rotate-admin-key --new <key>
```

Student codes are lowercase letters/digits/hyphens (e.g. `xiaoming`, `li-hua`). If no username is given, the code is
the username. If no password is given, a random one is generated. Show the teacher the printed login so they can
pass it to the parent.

## Data format (`work/<code>.json`)

```jsonc
{
  "schemaVersion": 1,
  "student": {
    "name": "张小明",
    "targetBand": 7,               // 目标总分, 0–9, or null
    "examDate": "2027-03-20",      // YYYY-MM-DD or null; shows a countdown
    "currentLevel": "总分 6.0（2026年9月模考）",   // free text, Chinese
    "teacherNote": "…"             // 老师寄语 shown at top; Chinese; update when the teacher gives an overall comment
  },
  "updatedAt": "2026-10-20",       // set automatically by `save`
  "vocab": {
    "target": null,                // optional goal for the cumulative count, or null
    "entries": [
      // One entry per class: the new words taught that day. The site de-duplicates across all
      // entries (case-insensitive, simple plural s) and charts the running total itself.
      { "date": "2026-10-13", "note": "第 29 课", "words": [ { "w": "regret", "m": "后悔" }, { "w": "attic", "m": "阁楼" }, "glamorous" ] }
      // Alternatively { "date": …, "known": 6120, "note": "词汇量测试" } sets the count directly (e.g. a vocab-size test).
    ]
  },
  "reading": {
    "targetRate": 0.8,             // optional target accuracy (0–1) drawn as a dashed line, or null
    "entries": [
      {
        "date": "2026-10-18",
        "material": "剑桥雅思 17 Test 4",     // what was practised
        "correct": 32, "total": 40,          // 0 ≤ correct ≤ total
        "byType": {                          // optional per-question-type breakdown: [correct, total]
          "判断题 (T/F/NG)": [9, 13], "填空题": [13, 14], "标题匹配": [6, 7], "选择题": [4, 6]
        },
        "note": ""
      }
    ]
  },
  "listening": { "targetRate": 0.8, "entries": [ /* same shape as reading */ ] },
  "writing": {
    "entries": [
      {
        "date": "2026-10-17",
        "task": "Task 2",                    // exactly "Task 1" or "Task 2"
        "topic": "政府是否应资助艺术",
        "wordCount": 286,
        "sentences": 15,
        "paragraphs": 5,
        "avgSentenceLength": 19.1,           // words per sentence
        "complexSentenceRatio": 0.53,        // 0–1, share of sentences with a subordinate/relative clause
        "lexicalDiversity": 0.8,             // 0–1, MATTR (window 50)
        "longWordRatio": 0.25,               // 0–1, words with ≥7 letters
        "band": 6.5,                         // teacher's score, or null
        "comment": "句式明显更丰富，注意冠词错误。"   // teacher's comment in Chinese
      }
    ]
  }
}
```

Vocab: when the teacher shares class notes, add every word/phrase from that class's vocab list (with the teacher's
Chinese meaning in `m` when given; leave `m` out otherwise). Skip speaking questions, essays, quiz sentences and grammar
notes. Repeating an earlier word is fine. The site counts it as review, not new. Two lists on the same date go in one entry.

Question-type names: reuse the names already in that student's data so the breakdown aggregates correctly.
Common ones: 阅读 `判断题 (T/F/NG)`, `填空题`, `选择题`, `标题匹配`, `段落信息匹配`, `人名/观点匹配`, `句子配对`;
听力 `表格/笔记填空`, `单选题`, `多选题`, `配对题`, `地图题`.

The site shows an estimated band only when `total` is 40 (full test). A single passage (e.g. 13 questions) is fine to record.

### Writing metrics: always compute, never estimate

When the teacher sends an essay, save the text to `work/essay.txt` and run:

```bash
node scripts/essay-metrics.mjs work/essay.txt --task "Task 2" --date 2026-10-20 --topic "题目" --band 6.5 --comment "评语"
```

Append the printed JSON object to `writing.entries`. If the teacher gives only a word count (no essay text), record
`wordCount` alone and leave the other metrics out. Don't invent them.

## Site code

- `docs/index.html`, `docs/style.css`, `docs/app.js` are the page (vanilla JS, hand-drawn SVG charts, no external libraries,
  so it loads reliably in mainland China). All UI text must be Simplified Chinese.
- `docs/crypto.js` is shared by the browser and the Node scripts. Changing its format breaks every existing file.
- `docs/vocab.js` holds the word de-duplication logic, shared by the page and `admin.mjs save` (which writes each entry's
  running `known` total so a browser still running cached older page code shows correct numbers).
- After changing anything in `docs/*.js` or `docs/style.css`, run `npm run stamp` (also run by `save`). It versions the
  asset URLs (`app.js?v=…`) so browsers never mix old and new code.
- Preview locally: `npm run serve`, then open http://localhost:8000.
