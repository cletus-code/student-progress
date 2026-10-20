# 雅思备考进度报告 · IELTS progress reports

A small website where parents log in and see their child's IELTS preparation progress, in Chinese:

- **词汇** (vocabulary): vocabulary size over time, progress toward a target
- **阅读** (reading) and **听力** (listening): accuracy over time, estimated band for full tests, accuracy by question type with weak spots flagged
- **写作** (writing): word count per essay against the 150/250 minimums, plus sentence length, complex-sentence ratio, and vocabulary diversity

## How privacy works

The site is plain static files on GitHub Pages. Each student's data is **encrypted**. The repo only holds
unreadable ciphertext, and the parent's password is what decrypts it in the browser. Someone who finds the
site, or even downloads the whole repo, sees nothing without a password.

You, the teacher, hold one **admin key** that can open every student's file for editing.
Keep it somewhere safe (a password manager). If it's lost, existing data can't be edited any more.

## Updating progress (via Claude or Codex)

1. Give the agent your admin key once: set an environment variable `IELTS_ADMIN_KEY` in your
   Claude Code / Codex environment settings, or paste it when the agent asks.
2. Message the agent in plain language, for example:
   - "小明 vocab test today: 6300"
   - "小红 listening 剑桥18 Test 1: 31/40, lost 4 on 地图题 (out of 5)"
   - "Add this Task 2 essay for 小明, band 6.5, comment: 结构清晰…" followed by the essay
   - "Add new student 王小美, exam date 2027-05-10, target 6.5"
3. The agent follows [`AGENTS.md`](AGENTS.md): decrypt → edit → re-encrypt → commit → push. GitHub Pages updates in about a minute.

## Doing it by hand

```bash
export IELTS_ADMIN_KEY='your-admin-key'
node scripts/admin.mjs add xiaoming --name 张小明      # prints the parent's username + password
node scripts/admin.mjs open xiaoming                  # → work/xiaoming.json (never committed)
# edit work/xiaoming.json
node scripts/admin.mjs save xiaoming
git add docs/data admin && git commit -m "Update progress data" && git push
```

Other commands: `list`, `login <code>` (show a parent's login), `set-password <code>`, `remove <code>`,
`rotate-admin-key --new <key>`. To measure an essay: `node scripts/essay-metrics.mjs essay.txt --task "Task 2"`.

## Demo account

Username `demo`, password `demo-ielts-2026`. It contains made-up data so you can see the layout.
Remove it before sharing the site with parents: `node scripts/admin.mjs remove demo`.

## Hosting

Settings → Pages → Source: *Deploy from a branch*, Branch `main`, folder `/docs`.
The site uses no external fonts or scripts. Note that `github.io` can be slow or unreliable from some
networks in mainland China. If parents have trouble, the `docs/` folder can be served from any static host as is.

## Password strength

Because the encrypted files are public, anyone could try guessing passwords offline. Generated passwords
(like `k7tq-m3xa-9fwe`) are strong enough. Don't hand out short or guessable passwords such as phone numbers or birthdays.
