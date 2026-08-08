#!/usr/bin/env python3
"""เก็บข้อมูลการทำงานของทีม agent จาก store และ plan แล้วสร้าง index.html

เขียนด้วย Python เพราะรันได้ทั้งบนเครื่องที่พัฒนาและบน runner โดยไม่ต้องลง jq หรือ node
— แปลว่าทดสอบกับข้อมูลจริงได้ก่อน push ซึ่งสำคัญกว่าความสวยของเครื่องมือ

หลักที่ใช้ตัดสินว่าอะไรรวม อะไรแยก:
  รวมได้เฉพาะสิ่งที่แชร์กันจริง — บิลใบเดียวกัน กับคิวความสนใจของเจ้าของ
  ที่เหลือแยกรายทีมทั้งหมด เพราะทุกอย่างที่ลงมือทำกับมันเป็นรายทีม
  (เพดานปรับแยก · key เพิกถอนแยก · prompt แก้แยก)
"""
import io, json, os, re, subprocess, sys, html as H
from datetime import datetime, timezone, timedelta

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

REPOS  = ["store", "plan"]
AGENTS = ["หัวหน้าทีม", "ช่างซ่อม", "ผู้ตรวจ"]
AGENT_RE = re.compile("|".join(AGENTS))
DATA, PAGE = "data.json", "index.html"
TH = timezone(timedelta(hours=7))

APP = {
    "store": ("บันทึกสต็อกวัตถุดิบ + ทะเบียนวัตถุดิบ", "var(--brand)", "tag-s"),
    "plan":  ("ติดตามแผนงาน Production &amp; WIP",      "var(--warn)",  "tag-p"),
}
WHY = {"issues": "ถูกเรียกจาก issue", "workflow_run": "ต่อจากหัวหน้าทีม", "pull_request": "ตรวจ PR"}
WAIT_LABELS = {"ready-to-fix", "needs-owner-decision", "needs-triage", "blocker"}


def gh(*args, allow_fail=False):
    p = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8")
    if p.returncode != 0:
        if allow_fail:
            return ""
        sys.exit(f"gh {' '.join(args)} ล้มเหลว:\n{p.stderr.strip()}")
    return p.stdout


def gh_json(*args, allow_fail=False, default=None):
    out = gh(*args, allow_fail=allow_fail)
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        if allow_fail:
            return default
        raise


# ────────────────────────── เก็บข้อมูล ──────────────────────────

NUM = {
    "cost":     re.compile(r'"total_cost_usd":\s*([0-9.]+)'),
    "turns":    re.compile(r'"num_turns":\s*([0-9]+)'),
    "denials":  re.compile(r'"permission_denials_count":\s*([0-9]+)'),
}

def read_numbers(repo, run_id):
    """ราคาอยู่ใน log ดิบเท่านั้น ต้องโหลดทั้งไฟล์มาหา — ช้า จึงเรียกเฉพาะรอบที่ยังไม่เคยอ่าน
    GitHub เก็บ log ไว้ 90 วัน แต่เพราะ cache ไว้แล้ว ตัวเลขเก่าจึงไม่หายจากแดชบอร์ด"""
    log = gh("run", "view", str(run_id), "-R", f"nse-manufac/{repo}", "--log", allow_fail=True)
    out = {}
    for key, rx in NUM.items():
        m = rx.search(log)
        out[key] = (float(m.group(1)) if key == "cost" else int(m.group(1))) if m else None
    return out


def collect():
    cached = {}
    if os.path.exists(DATA):
        old = json.load(open(DATA, encoding="utf-8"))
        for r in REPOS:
            for run in old.get("repos", {}).get(r, {}).get("runs", []):
                if run.get("settled"):
                    cached[run["id"]] = run

    data = {"generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "repos": {}}

    for repo in REPOS:
        full = f"nse-manufac/{repo}"
        raw = gh_json("run", "list", "-R", full, "-L", "60",
                      "--json", "databaseId,name,createdAt,conclusion,status,event,url")
        runs, fetched = [], 0
        for m in raw:
            if not AGENT_RE.match(m["name"]):
                continue
            rid = m["databaseId"]
            done = m["status"] == "completed"
            if rid in cached:
                runs.append(cached[rid])
                continue
            nums = read_numbers(repo, rid) if done else {"cost": None, "turns": None, "denials": None}
            if done:
                fetched += 1
            runs.append({
                "id": rid, "repo": repo, "agent": m["name"].split(" —")[0],
                "at": m["createdAt"], "conclusion": m["conclusion"] or "running",
                "event": m["event"], "url": m["url"], "settled": done, **nums,
            })

        issues = [{"number": i["number"], "title": i["title"], "url": i["url"],
                   "labels": [l["name"] for l in i["labels"]]}
                  for i in gh_json("issue", "list", "-R", full, "--state", "open", "-L", "30",
                                   "--json", "number,title,labels,url")]
        prs = [{"number": p["number"], "title": p["title"], "url": p["url"],
                "author": p["author"]["login"]}
               for p in gh_json("pr", "list", "-R", full, "--state", "open", "-L", "30",
                                "--json", "number,title,author,url")]
        cap = gh("api", f"repos/{full}/actions/variables/AGENT_MAX_RUNS_PER_DAY",
                 "--jq", ".value", allow_fail=True).strip()

        data["repos"][repo] = {"runs": runs, "issues": issues, "prs": prs,
                               "cap": int(cap) if cap.isdigit() else 6}
        print(f"── {full}: {len(runs)} รอบ (โหลด log ใหม่ {fetched})")

    # ── ไม่มีอะไรเปลี่ยน ก็อย่าให้เวลาเปลี่ยน ──
    # ถ้าปล่อยให้ generatedAt ขยับทุกรอบ git จะเห็นว่าไฟล์ต่างเสมอ
    # แล้วเราจะได้ commit เปล่า ๆ วันละ 48 ครั้งไปตลอด
    #
    # แต่ยังต้องเต้นให้เห็นบ้าง — ถ้าหน้าค้างเวลาเดิมเป็นวัน จะแยกไม่ออกว่า
    # "ไม่มีงานเข้า" กับ "ระบบพัง" จึงบังคับอัปเดตวันละครั้งเป็นชีพจร
    if os.path.exists(DATA):
        old = json.load(open(DATA, encoding="utf-8"))
        if old.get("repos") == data["repos"]:
            age = datetime.now(timezone.utc) - datetime.strptime(
                old["generatedAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            if age < timedelta(hours=20):
                data["generatedAt"] = old["generatedAt"]
                print("ไม่มีอะไรเปลี่ยน — คงเวลาเดิมไว้ จะได้ไม่ commit เปล่า")

    json.dump(data, open(DATA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return data


# ────────────────────────── คำนวณ ──────────────────────────

billed = lambda r: r.get("cost") is not None
esc    = lambda s: H.escape(str(s), quote=True)
money  = lambda n: f"${n:.2f}"

def th_time(iso):
    d = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).astimezone(TH)
    return f"{d.day}/{d.month}", d.strftime("%H:%M")


def stats(data, repo):
    runs = data["repos"][repo]["runs"]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    per = []
    for a in AGENTS:
        rs = [r for r in runs if r["agent"] == a and billed(r)]
        n = len(rs)
        s = lambda k: sum(r.get(k) or 0 for r in rs)
        per.append({"agent": a, "n": n, "cost": s("cost"),
                    "turns": round(s("turns") / n) if n else 0,
                    "denials": s("denials") / n if n else 0,
                    "avg": s("cost") / n if n else 0})
    fix = [r for r in runs if r["agent"] == "ช่างซ่อม" and billed(r)]
    return {"per": per, "total": sum(p["cost"] for p in per), "jobs": len(fix),
            "capUsed": sum(1 for r in fix if r["at"][:10] == today),
            "cap": data["repos"][repo]["cap"]}


# ────────────────────────── สร้างหน้า ──────────────────────────

CSS = """
:root{--brand:#1f4e79;--brand-soft:#e8f0f8;--ok:#1a7f4b;--warn:#b06d00;--bad:#c02626;
--ink:#131b24;--muted:#5d6b7c;--faint:#8494a5;--bg:#eef1f5;--panel:#fff;--line:#d7dfe8;
--line-soft:#e6ecf2;--grid:#f2f5f8;
--mono:ui-monospace,"Cascadia Mono","SFMono-Regular",Consolas,monospace;
--ui:"Segoe UI","Noto Sans Thai","Leelawadee UI",Tahoma,system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--brand:#7db3e8;--brand-soft:#16283c;--ok:#4ec98a;
--warn:#e0a53c;--bad:#f0716b;--ink:#e8edf3;--muted:#9aa9ba;--faint:#6b7b8d;--bg:#0d1319;
--panel:#151d26;--line:#26323f;--line-soft:#1e2934;--grid:#111922}}
:root[data-theme="dark"]{--brand:#7db3e8;--brand-soft:#16283c;--ok:#4ec98a;--warn:#e0a53c;
--bad:#f0716b;--ink:#e8edf3;--muted:#9aa9ba;--faint:#6b7b8d;--bg:#0d1319;--panel:#151d26;
--line:#26323f;--line-soft:#1e2934;--grid:#111922}
:root[data-theme="light"]{--brand:#1f4e79;--brand-soft:#e8f0f8;--ok:#1a7f4b;--warn:#b06d00;
--bad:#c02626;--ink:#131b24;--muted:#5d6b7c;--faint:#8494a5;--bg:#eef1f5;--panel:#fff;
--line:#d7dfe8;--line-soft:#e6ecf2;--grid:#f2f5f8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--ui);font-size:15px;
line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:1120px;margin:0 auto;padding:28px 18px 64px;display:flex;flex-direction:column;gap:26px}
.head{display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px 20px;padding-bottom:18px;border-bottom:2px solid var(--line)}
h1{margin:0;font-size:24px;font-weight:650;letter-spacing:-.01em}
.head .when{margin-left:auto;font-family:var(--mono);font-size:12.5px;color:var(--faint);text-align:right;line-height:1.5}
.head .sub{width:100%;margin:0;color:var(--muted);font-size:13.5px}
.attention{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--warn);
border-radius:4px;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.attention h2{margin:0;font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--warn)}
.todo{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.todo li{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:baseline;padding-bottom:10px;border-bottom:1px dashed var(--line-soft)}
.todo li:last-child{border-bottom:0;padding-bottom:0}
.todo .ref{font-family:var(--mono);font-size:13px;font-weight:600;color:var(--brand);text-decoration:none;white-space:nowrap}
.todo .ref:hover,.todo .ref:focus-visible{text-decoration:underline}
.todo .what{flex:1;min-width:210px;font-size:14px}
.todo .note{font-size:12.5px;color:var(--muted)}
.clear{color:var(--muted);font-size:14px;margin:0}
.teams{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:16px}
.team{background:var(--panel);border:1px solid var(--line);border-radius:4px;overflow:hidden;display:flex;flex-direction:column}
.team-top{padding:15px 17px 13px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:3px;border-top:3px solid var(--tint)}
.team-top .name{font-family:var(--mono);font-size:16px;font-weight:650;color:var(--tint);text-decoration:none}
.team-top .name:hover,.team-top .name:focus-visible{text-decoration:underline}
.team-top .app{font-size:12.5px;color:var(--muted)}
.team-nums{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:13px 17px;border-bottom:1px solid var(--line-soft)}
.tn .n{font-family:var(--mono);font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.25}
.tn .k{font-size:11.5px;color:var(--faint)}
.team-tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.team-tbl th{text-align:left;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
color:var(--faint);padding:10px 8px 8px;border-bottom:1px solid var(--line-soft)}
.team-tbl th:first-child,.team-tbl td:first-child{padding-left:17px}
.team-tbl th:last-child,.team-tbl td:last-child{padding-right:17px}
.team-tbl td{padding:9px 8px;border-bottom:1px solid var(--line-soft)}
.team-tbl tr:last-child td{border-bottom:0}
.team-tbl .agent{font-weight:600;white-space:nowrap}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.num.hot{color:var(--warn);font-weight:600}
.team-foot{padding:12px 17px 14px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;
font-size:12.5px;color:var(--muted);border-top:1px solid var(--line-soft)}
.pips{display:inline-flex;gap:4px;vertical-align:-3px}
.pip{width:14px;height:14px;border-radius:2px;border:1px solid var(--line)}
.pip.on{background:var(--tint);border-color:var(--tint)}
.compare{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:17px 18px;display:flex;flex-direction:column;gap:14px}
.compare h2,.log h2{margin:0;font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.cmp-rows{display:flex;flex-direction:column;gap:9px}
.cmp{display:grid;grid-template-columns:88px 1fr auto;gap:12px;align-items:center;font-size:13.5px}
.cmp .lbl{font-weight:600;white-space:nowrap}
.pair{display:flex;gap:3px;height:22px}
.pair span{display:block;border-radius:2px;min-width:2px}
.pair .s{background:var(--brand)}
.pair .p{background:var(--warn)}
.cmp .delta{font-family:var(--mono);font-size:13px;font-variant-numeric:tabular-nums;color:var(--muted);white-space:nowrap}
.legend{display:flex;gap:16px;font-size:12.5px;color:var(--muted);padding-top:12px;border-top:1px solid var(--line-soft);flex-wrap:wrap}
.legend i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.log{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:17px 0 6px;display:flex;flex-direction:column;gap:13px}
.log h2{padding:0 18px}
.scroll{overflow-x:auto}
.act{border-collapse:collapse;width:100%;min-width:660px;font-size:13.5px}
.act th{text-align:left;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
color:var(--faint);padding:0 12px 9px;border-bottom:1px solid var(--line)}
.act th:first-child,.act td:first-child{padding-left:18px}
.act th:last-child,.act td:last-child{padding-right:18px}
.act td{padding:9px 12px;border-bottom:1px solid var(--line-soft);vertical-align:baseline}
.act tbody tr:last-child td{border-bottom:0}
.t-time{font-family:var(--mono);font-size:12.5px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.t-what{color:var(--muted);font-size:13px}
.tag{font-family:var(--mono);font-size:11.5px;font-weight:650;padding:2px 7px;border-radius:3px;white-space:nowrap;text-decoration:none}
.tag-s{background:var(--brand-soft);color:var(--brand)}
.tag-p{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
.dim td{opacity:.5}
.pill{display:inline-block;font-size:11.5px;font-weight:650;padding:2px 8px;border-radius:10px;white-space:nowrap}
.p-ok{background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok)}
.p-bad{background:color-mix(in srgb,var(--bad) 15%,transparent);color:var(--bad)}
.foot{font-size:12.5px;color:var(--faint);line-height:1.75;margin:0}
.foot code{font-family:var(--mono);font-size:12px;background:var(--grid);padding:1px 5px;border-radius:3px}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
@media (max-width:560px){.wrap{padding:20px 13px 48px}h1{font-size:20px}
.head .when{margin-left:0;text-align:left;width:100%}.tn .n{font-size:16px}
.cmp{grid-template-columns:74px 1fr auto;gap:9px}}
"""


def team_card(repo, st):
    app, tint, _ = APP[repo]
    pips = "".join(f'<span class="pip{" on" if i < st["capUsed"] else ""}"></span>'
                   for i in range(st["cap"]))
    rows = "".join(
        f'<tr><td class="agent">{p["agent"]}</td><td class="num">{p["n"]}</td>'
        f'<td class="num">{p["turns"] if p["n"] else "—"}</td>'
        f'<td class="num">{money(p["cost"]) if p["n"] else "—"}</td>'
        f'<td class="num{" hot" if p["denials"] >= 5 else ""}">'
        f'{f"{p['denials']:.1f}" if p["n"] else "—"}</td></tr>' for p in st["per"])
    per_job = money(st["total"] / st["jobs"]) if st["jobs"] else "—"
    return f"""
    <article class="team" style="--tint:{tint}">
      <div class="team-top">
        <a class="name" href="https://github.com/nse-manufac/{repo}">nse-manufac/{repo}</a>
        <span class="app">{app}</span>
      </div>
      <div class="team-nums">
        <div class="tn"><div class="n">{money(st["total"])}</div><div class="k">ใช้ไปแล้ว</div></div>
        <div class="tn"><div class="n">{st["jobs"]}</div><div class="k">งานที่ลงมือ</div></div>
        <div class="tn"><div class="n">{per_job}</div><div class="k">ต่องาน</div></div>
      </div>
      <table class="team-tbl">
        <thead><tr><th>agent</th><th class="num">งาน</th><th class="num">เทิร์น</th>
        <th class="num">ราคา</th><th class="num">ถูกปฏิเสธ</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
      <div class="team-foot"><span>เพดานช่างซ่อมวันนี้</span>
      <span class="pips">{pips}</span><span>{st["capUsed"]}/{st["cap"]}</span></div>
    </article>"""


def render(data):
    S = {r: stats(data, r) for r in REPOS}
    grand = sum(S[r]["total"] for r in REPOS)
    jobs  = sum(S[r]["jobs"] for r in REPOS)
    wasted = sum(r["cost"] for repo in REPOS for r in data["repos"][repo]["runs"]
                 if r["conclusion"] == "failure" and billed(r))

    waiting = []
    for repo in REPOS:
        for p in data["repos"][repo]["prs"]:
            note = "ช่างซ่อมเปิดเอง — รอ merge" if "github-actions" in p["author"] else "รอ merge"
            waiting.append((f"{repo} #{p['number']}", p["url"], p["title"], note))
        for i in data["repos"][repo]["issues"]:
            hit = [l for l in i["labels"] if l in WAIT_LABELS]
            if hit:
                waiting.append((f"{repo} #{i['number']}", i["url"], i["title"], " · ".join(hit)))

    if waiting:
        todo = '<ul class="todo">' + "".join(
            f'<li><a class="ref" href="{esc(u)}">{esc(r)}</a>'
            f'<span class="what">{esc(t)}</span><span class="note">{esc(n)}</span></li>'
            for r, u, t, n in waiting) + "</ul>"
    else:
        todo = '<p class="clear">ไม่มีอะไรค้าง — issue ปิดหมด PR merge หมด ทั้งสองทีม</p>'

    cmp_rows = ""
    for a in AGENTS:
        s = next(p for p in S["store"]["per"] if p["agent"] == a)
        p = next(q for q in S["plan"]["per"] if q["agent"] == a)
        if not (s["n"] and p["n"]):
            continue
        mx = max(s["avg"], p["avg"]) or 1
        pct = round((p["avg"] / s["avg"] - 1) * 100) if s["avg"] else 0
        cmp_rows += (f'<div class="cmp"><span class="lbl">{a}</span><span class="pair">'
                     f'<span class="s" style="width:{s["avg"]/mx*100:.1f}%"></span>'
                     f'<span class="p" style="width:{p["avg"]/mx*100:.1f}%"></span></span>'
                     f'<span class="delta">{money(s["avg"])} → {money(p["avg"])} · '
                     f'{"+" if pct >= 0 else ""}{pct}%</span></div>')

    compare = f"""
  <section class="compare">
    <h2>ราคาเฉลี่ยต่อ 1 รอบ — เทียบสองทีม</h2>
    <div class="cmp-rows">{cmp_rows}</div>
    <div class="legend"><span><i style="background:var(--brand)"></i>store</span>
    <span><i style="background:var(--warn)"></i>plan</span>
    <span style="color:var(--faint)">ไฟล์ของ plan ใหญ่กว่า 4 เท่า — ดูว่าตำแหน่งไหนรับผลจากขนาดไฟล์มากที่สุด</span></div>
  </section>""" if cmp_rows else ""

    acts = sorted((r for repo in REPOS for r in data["repos"][repo]["runs"]
                   if billed(r) or r["conclusion"] == "failure"),
                  key=lambda r: r["at"], reverse=True)[:25]
    act_rows = ""
    for r in acts:
        day, hm = th_time(r["at"])
        fail = r["conclusion"] == "failure"
        act_rows += (
            f'<tr{" class=\"dim\"" if fail else ""}><td class="t-time">{day} {hm}</td>'
            f'<td><a class="tag {APP[r["repo"]][2]}" href="https://github.com/nse-manufac/{r["repo"]}">{r["repo"]}</a></td>'
            f'<td>{r["agent"]}</td><td class="t-what"><a href="{esc(r["url"])}" '
            f'style="color:inherit;text-decoration:none">{WHY.get(r["event"], r["event"])}</a></td>'
            f'<td class="num">{r["turns"] if r["turns"] is not None else "—"}</td>'
            f'<td class="num">{money(r["cost"]) if billed(r) else "$0.00"}</td>'
            f'<td><span class="pill {"p-bad" if fail else "p-ok"}">{"ล้ม" if fail else "สำเร็จ"}</span></td></tr>')

    gd, gh_ = th_time(data["generatedAt"])
    page = f"""<title>ทีม agent — สรุปการทำงาน</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>{CSS}</style>
<div class="wrap">
  <header class="head">
    <h1>ทีม agent — สรุปการทำงาน</h1>
    <div class="when">อัปเดตล่าสุด {gd} · {gh_} น.<br>สองทีมแยกขาดจากกัน คนละ repo คนละ key</div>
    <p class="sub">อัปเดตเองทุก 30 นาที</p>
  </header>
  <section class="attention"><h2>รอคุณอยู่</h2>{todo}</section>
  <section class="teams">{team_card("store", S["store"])}{team_card("plan", S["plan"])}</section>
  {compare}
  <section class="log">
    <h2>กิจกรรมล่าสุด — ทั้งสองทีม เรียงตามเวลา</h2>
    <div class="scroll"><table class="act">
      <thead><tr><th>เวลา</th><th>ทีม</th><th>agent</th><th>ทำอะไร</th>
      <th style="text-align:right">เทิร์น</th><th style="text-align:right">ราคา</th><th>ผล</th></tr></thead>
      <tbody>{act_rows}</tbody>
    </table></div>
  </section>
  <p class="foot">
    <b>รวมทั้งสองทีม {money(grand)} · {jobs} งาน · เสียเปล่า {money(wasted)}</b> —
    ยอดรวมมีความหมายเพราะบิลใบเดียวกัน ที่เหลือแยกทีมทั้งหมด<br>
    เวลาแสดงเป็นเวลาไทย · ราคาคือ <code>total_cost_usd</code> ที่ claude-code-action รายงานเมื่อจบงาน<br>
    “ถูกปฏิเสธ” = จำนวนครั้งเฉลี่ยที่ agent สั่งคำสั่งนอกรายการอนุญาต เสียเทิร์นฟรีทุกครั้ง<br>
    เพดานเป็นของใครของมัน รวมกันแล้วช่างซ่อมรันได้
    <b>{S["store"]["cap"] + S["plan"]["cap"]} รอบ/วัน</b> —
    ปรับที่ <code>AGENT_MAX_RUNS_PER_DAY</code> ของแต่ละ repo
  </p>
</div>
"""
    open(PAGE, "w", encoding="utf-8").write(page)
    print(f"เขียน {PAGE} แล้ว — {len(acts)} แถว · รวม {money(grand)}")


if __name__ == "__main__":
    render(collect() if "--render-only" not in sys.argv
           else json.load(open(DATA, encoding="utf-8")))
