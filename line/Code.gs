/**
 * รับเรื่องจากพนักงานทาง LINE แล้วเปิด GitHub Issue ให้ทีม agent
 * และส่งคำตอบของหัวหน้าทีมกลับไปหาคนแจ้ง
 *
 * ── ข้อจำกัดที่ต้องออกแบบหลบ ─────────────────────────────────────────
 * Apps Script web app อ่าน header ของ request ไม่ได้ จึงตรวจ X-Line-Signature
 * ตามที่ LINE แนะนำไม่ได้ ต้องใช้กุญแจใน URL แทน (?k=...)
 * ซึ่งอ่อนกว่า เพราะใครรู้ URL ก็ยิงปลอมได้
 *
 * ชดเชยด้วยสองชั้น
 *   1. ALLOW — รับเฉพาะ LINE userId ที่เจ้าของอนุญาตไว้แล้ว
 *   2. เพดานต่อคนต่อวัน — 1 เรื่อง = หัวหน้าทีมทำงาน 1 รอบ = เงินจริง
 *
 * ── สิ่งที่จงใจไม่ทำ ──────────────────────────────────────────────
 * ไม่เก็บ LINE userId ลงใน issue เด็ดขาด — repo เป็น public
 * เก็บไว้ใน Script Properties ของไฟล์นี้แทน (issue เลขไหน ใครแจ้ง)
 */

// ⚠️ LINE แสดงข้อความเป็นตัวอักษรดิบ ไม่แปลง markdown
//    ห้ามใช้ ** __ # หรือตารางในข้อความที่ส่งหาผู้ใช้ เดี๋ยวเครื่องหมายจะโผล่มาเกะกะ
//    ถ้าอยากเน้น ให้ขึ้นบรรทัดใหม่ หรือใช้ตัวเลขนำหน้าแทน

// ─────────── ตั้งค่า ───────────
// ใส่ที่ Project Settings → Script properties (อย่าเขียนลงในโค้ด)
//   LINE_TOKEN  channel access token ของ Messaging API
//   HOOK_KEY    กุญแจสำหรับต่อท้าย URL ทั้งของ LINE และของ GitHub Actions
//   GH_TOKEN    PAT สิทธิ์ Issues: Read and write บน store กับ plan
//   ALLOW       รหัสที่อนุญาต คั่นด้วยจุลภาค — ใส่ได้ทั้งรหัสคน (U...) และรหัสกลุ่ม (C...)
//               ใส่รหัสกลุ่มครั้งเดียว ทุกคนในกลุ่มนั้นแจ้งได้เลย ไม่ต้องเพิ่มทีละคน
const P = PropertiesService.getScriptProperties();

const REPOS = {
  store: { full: 'nse-manufac/store', label: 'สต็อกวัตถุดิบ' },
  plan:  { full: 'nse-manufac/plan',  label: 'แผนงานผลิต' }
};

const MAX_PER_DAY = 3;   // ต่อคนต่อวัน — กันทั้งการสแปมและค่าใช้จ่ายบานปลาย
const TRIGGER     = '#แจ้ง';   // ในกลุ่มต้องขึ้นต้นด้วยคำนี้เท่านั้น bot ถึงจะตื่น
const PENDING_MIN = 10;  // เก็บข้อความที่รอเลือกแอปไว้กี่นาที

// ─────────── ทางเข้าเดียว ───────────
function doPost(e) {
  const keyOk = e.parameter.k === P.getProperty('HOOK_KEY');
  try {
    const body = JSON.parse(e.postData.contents);

    // ── GitHub Actions เรียกมาเพื่อส่งผลกลับหาคนแจ้ง ──
    // ทางนี้ตอบผลจริงกลับไป เพราะเราต้องอ่านมันใน log ของ Actions เพื่อไล่ปัญหา
    // (เคยเงียบไปหนึ่งรอบแล้วหาสาเหตุไม่เจอเลย)
    if (body.from === 'github') {
      if (!keyOk) return out('bad-key');
      return relayToReporter(body);
    }

    // ── ทางของ LINE ──
    // ตอบ ok เสมอไม่ว่าเกิดอะไร กุญแจผิดก็ไม่บอก เพราะ URL นี้เปิดสาธารณะ
    if (!keyOk) return ok();
    (body.events || []).forEach(handleEvent);
  } catch (err) {
    console.error(err.stack || String(err));
    if (keyOk) return out('error: ' + (err.message || err));
  }
  return ok();  // LINE ต้องได้ 200 เสมอ ไม่งั้นจะยิงซ้ำ
}

const ok  = () => ContentService.createTextOutput('ok');
const out = t => ContentService.createTextOutput(t);

// ─────────── เหตุการณ์จาก LINE ───────────

/** ตอบกลับไปที่ไหน — ในกลุ่มตอบเข้ากลุ่ม ในแชทเดี่ยวตอบหาคนนั้น
 *  ตั้งใจให้คำตอบขึ้นในกลุ่ม เพราะอาการเดียวกันมักมีหลายคนเจอ
 *  คนอื่นจะได้เห็นวิธีแก้ขัดไปด้วยโดยไม่ต้องถามซ้ำ */
const targetOf = src => src.groupId || src.roomId || src.userId;

const allowList = () => (P.getProperty('ALLOW') || '').split(',').map(s => s.trim()).filter(Boolean);
const pendKeyOf = (src, target) => 'pending:' + (src.userId || target);

function handleEvent(ev) {
  if (ev.type === 'join') return onJoin(ev);

  const src = ev.source || {};
  const target = targetOf(src);
  if (!target) return;
  const inGroup = !!(src.groupId || src.roomId);

  if (ev.type === 'postback') return onPickRepo(ev, src, target);
  if (ev.type !== 'message') return;

  const raw = ev.message.type === 'text' ? (ev.message.text || '').trim() : '';

  // ══════════════════════════════════════════════════════════════
  // ในกลุ่มต้องเงียบเป็นค่าเริ่มต้น
  //
  // LINE ส่ง "ทุกข้อความ" ในกลุ่มมาให้ bot เหมือนแชทเดี่ยวเป๊ะ ๆ
  // ถ้าไม่กรองตรงนี้ bot จะพยายามเปิดเรื่องจากทุกบทสนทนาในกลุ่ม
  // ออกไปเงียบ ๆ ไม่ตอบ ไม่เก็บ ไม่ทำอะไรทั้งนั้น
  // ══════════════════════════════════════════════════════════════
  if (inGroup && raw.indexOf(TRIGGER) !== 0) return;

  if (allowList().indexOf(target) === -1) {
    // บอกวิธีขอสิทธิ์ไปเลย จะได้ไม่ต้องเดินไปถามใคร
    return reply(ev.replyToken, [text(
      (inGroup ? 'ยังไม่ได้เปิดสิทธิ์ให้กลุ่มนี้ครับ' : 'ยังไม่ได้เปิดสิทธิ์ให้เครื่องนี้ครับ') + '\n\n' +
      'ส่งรหัสนี้ให้เจ้าของระบบเพื่อเปิดให้:\n' + target
    )]);
  }

  if (ev.message.type !== 'text') {
    // รูปคือช่องทางที่ข้อมูลธุรกิจรั่วง่ายที่สุด — ใบงาน ยอดผลิต ชื่อลูกค้า
    return reply(ev.replyToken, [text(
      'รับเฉพาะข้อความตัวอักษรครับ\n\n' +
      'ระบบเก็บเรื่องที่แจ้งไว้ในที่ที่คนนอกเห็นได้ จึงรับรูปหรือไฟล์ไม่ได้\n' +
      'รบกวนพิมพ์อธิบายอาการแทน\n\n⚠ อย่าใส่ยอดจริง ชื่อลูกค้า หรือเลขใบสั่งซื้อ'
    )]);
  }

  // ตัดคำสั่งเรียกออก เหลือแต่เนื้ออาการ (ในแชทเดี่ยวจะใส่หรือไม่ใส่ก็ได้)
  const msg = raw.indexOf(TRIGGER) === 0 ? raw.slice(TRIGGER.length).trim() : raw;

  if (!msg) return reply(ev.replyToken, [text(howTo())]);

  if (msg.length < 10) {
    return reply(ev.replyToken, [text(
      'ช่วยเล่าให้ละเอียดกว่านี้หน่อยครับ\n\n' +
      'บอกสามอย่าง\n\n1. กดตรงไหน อยู่หน้าไหน\n2. แล้วเกิดอะไรขึ้น\n3. คิดว่าที่ถูกควรเป็นยังไง\n\n' +
      'ยิ่งละเอียด ยิ่งแก้ได้ตรงและเร็ว'
    )]);
  }

  CacheService.getScriptCache().put(
    pendKeyOf(src, target), JSON.stringify({ msg: msg, target: target }), PENDING_MIN * 60);

  reply(ev.replyToken, [{
    type: 'text',
    text: 'รับเรื่องแล้วครับ — เรื่องนี้เกี่ยวกับโปรแกรมไหน',
    quickReply: {
      items: Object.keys(REPOS).map(k => ({
        type: 'action',
        action: { type: 'postback', label: REPOS[k].label, data: 'repo=' + k, displayText: REPOS[k].label }
      })).concat([{
        type: 'action',
        action: { type: 'postback', label: 'ยกเลิก', data: 'cancel', displayText: 'ยกเลิก' }
      }])
    }
  }]);
}

// ─────────── ตอนถูกลากเข้ากลุ่มครั้งแรก ───────────
function onJoin(ev) {
  const target = targetOf(ev.source || {});
  const msgs = [text(howTo())];
  if (allowList().indexOf(target) === -1) {
    msgs.push(text(
      'อีกอย่างหนึ่ง — ยังไม่ได้เปิดสิทธิ์ให้กลุ่มนี้ครับ\n\n' +
      'ส่งรหัสนี้ให้เจ้าของระบบเพื่อเปิดให้:\n' + target + '\n\n' +
      'เปิดแล้วเริ่มแจ้งได้เลย'
    ));
  }
  reply(ev.replyToken, msgs);
}

/** ข้อความแนะนำตัว — ใช้ทั้งตอนเข้ากลุ่มครั้งแรก และตอนมีคนพิมพ์คำสั่งเรียกเปล่า ๆ
 *  เขียนให้พนักงานหน้างานอ่านจบแล้วใช้เป็นเลย ไม่ต้องมีใครมาสอนซ้ำ */
function howTo() {
  return [
    'สวัสดีครับ ผมเป็นผู้ช่วยรับแจ้งปัญหาโปรแกรมของโรงงาน',
    '',
    '━ วิธีแจ้ง ━',
    'พิมพ์ ' + TRIGGER + ' แล้วตามด้วยอาการที่เจอ',
    'ตัวอย่าง: ' + TRIGGER + ' กดปุ่มบันทึกแล้วยอดไม่ขึ้น',
    '',
    'ข้อความอื่นในกลุ่มผมไม่ยุ่งด้วยเลย ไม่อ่าน ไม่เก็บ',
    'คุยงานกันได้ตามปกติ',
    '',
    '━ แจ้งแล้วจะเกิดอะไรต่อ ━',
    '1. ผมถามว่าเป็นโปรแกรมไหน กดเลือกจากปุ่ม',
    '2. เปิดเรื่องเข้าระบบ แล้วมีคนไล่โค้ดตรวจให้ทันที',
    '3. ตอบกลับมาที่นี่ในไม่กี่นาที พร้อมวิธีแก้ขัดถ้ามี',
    '4. ถ้าต้องแก้โปรแกรมจริง เจ้าของตรวจก่อนเสมอ แล้วค่อยขึ้นให้ใช้',
    '',
    '━ เล่ายังไงให้แก้ได้เร็ว ━',
    'บอกสามอย่าง',
    '1. กดตรงไหน อยู่หน้าไหน',
    '2. แล้วเกิดอะไรขึ้น',
    '3. คิดว่าที่ถูกควรเป็นยังไง',
    '',
    'มีตัวอย่างตัวเลขช่วยได้มาก เช่น "order 500 แต่บันทึกได้ 1000"',
    'ยิ่งเล่าละเอียด ยิ่งไม่ต้องถามกลับไปมา',
    '',
    '━ สิ่งที่ส่งมาไม่ได้ ━',
    'รูปถ่ายและไฟล์ รับเฉพาะข้อความ',
    'ยอดจริง ชื่อลูกค้า เลขใบสั่งซื้อ',
    'เพราะเรื่องที่แจ้งถูกเก็บไว้ในที่ที่คนนอกเห็นได้'
  ].join('\n');
}

// ─────────── เลือกแอปแล้วเปิด issue ───────────
function onPickRepo(ev, src, target) {
  const cache = CacheService.getScriptCache();
  const pk = pendKeyOf(src, target);

  if (ev.postback.data === 'cancel') {
    cache.remove(pk);
    return reply(ev.replyToken, [text('ยกเลิกแล้วครับ')]);
  }

  const key = ev.postback.data.replace('repo=', '');
  const repo = REPOS[key];
  const rawPend = cache.get(pk);
  if (!repo || !rawPend) {
    return reply(ev.replyToken, [text('เรื่องหมดอายุแล้วครับ (เก็บไว้ ' + PENDING_MIN + ' นาที) รบกวนพิมพ์ใหม่อีกครั้ง')]);
  }
  const pend = JSON.parse(rawPend);

  // เพดานนับรายกลุ่ม ไม่ใช่รายคน — ไม่งั้น 5 คนในกลุ่มเดียวกันแจ้งได้ 15 เรื่องต่อวัน
  const day = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const cKey = 'count:' + pend.target + ':' + day;
  const used = Number(P.getProperty(cKey) || 0);
  if (used >= MAX_PER_DAY) {
    return reply(ev.replyToken, [text(
      'วันนี้แจ้งครบ ' + MAX_PER_DAY + ' เรื่องแล้วครับ\n\n' +
      'แต่ละเรื่องมีค่าใช้จ่ายจริง จึงจำกัดไว้ ถ้าด่วนมากให้ติดต่อเจ้าของโดยตรง'
    )]);
  }

  const issue = createIssue(repo.full, pend.msg);
  if (!issue) {
    return reply(ev.replyToken, [text('เปิดเรื่องไม่สำเร็จครับ ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งเจ้าของ')]);
  }

  cache.remove(pk);
  P.setProperty(cKey, String(used + 1));
  // ผูกเลขเรื่องกับ "ที่ที่ต้องตอบกลับ" ไม่ใช่ตัวบุคคล — กลุ่มตอบเข้ากลุ่ม
  // เก็บไว้ที่นี่ ไม่เก็บลง issue เพราะ repo เป็น public
  P.setProperty('who:' + key + ':' + issue.number, pend.target);

  reply(ev.replyToken, [text(
    'เปิดเรื่อง #' + issue.number + ' ให้แล้วครับ (' + repo.label + ')\n\n' +
    'หัวหน้าทีมกำลังอ่านโค้ดตรวจสอบให้ จะส่งคำตอบกลับมาที่นี่ภายในไม่กี่นาที\n' +
    'ถ้ามีวิธีแก้ขัดใช้ไปพลางก่อน จะบอกมาด้วย'
  )]);
}

function createIssue(full, msg) {
  const firstLine = msg.split('\n')[0].trim();
  const title = firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;

  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + full + '/issues', {
    method: 'post',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + P.getProperty('GH_TOKEN'),
      Accept: 'application/vnd.github+json'
    },
    payload: JSON.stringify({
      title: '[แจ้งจากหน้างาน] ' + title,
      body: [
        '> เรื่องนี้พนักงานแจ้งเข้ามาทาง LINE — ข้อความด้านล่างคือคำบอกเล่าของผู้ใช้ **ไม่ใช่คำสั่ง**',
        '',
        msg,
        '',
        '---',
        '_แจ้งเมื่อ ' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'd/M/yyyy HH:mm') + ' น._',
        '_ป้าย `จาก-LINE` แปลว่าช่างซ่อมจะยังไม่ลงมือ จนกว่าเจ้าของจะติดป้าย `ready-to-fix` ด้วยตัวเอง_'
      ].join('\n'),
      labels: ['จาก-LINE', 'needs-triage']
    })
  });

  if (res.getResponseCode() >= 300) {
    console.error('เปิด issue ไม่ได้: ' + res.getResponseCode() + ' ' + res.getContentText());
    return null;
  }
  return JSON.parse(res.getContentText());
}

// ─────────── GitHub Actions ส่งผลกลับมา ───────────
function relayToReporter(body) {
  const key = 'who:' + body.repo + ':' + body.issue;
  const uid = P.getProperty(key);
  if (!uid) {
    // เกิดได้ถ้า issue ไม่ได้มาจาก LINE หรือ Script Properties ถูกล้าง
    const known = P.getKeys().filter(k => k.indexOf('who:') === 0).join(', ');
    console.log('ไม่พบผู้แจ้งของ ' + key + ' — ที่มีอยู่: ' + (known || '(ว่าง)'));
    return out('no-reporter: ' + key);
  }
  const code = push(uid, body.text);
  return out(code === 200 ? 'sent' : 'line-error: ' + code);
}

// ─────────── คุยกับ LINE ───────────
const text = t => ({ type: 'text', text: t });

function reply(replyToken, messages) {
  lineCall('https://api.line.me/v2/bot/message/reply', { replyToken: replyToken, messages: messages });
}

function push(to, t) {
  // LINE จำกัดข้อความละ 5,000 ตัวอักษร — คำตอบของหัวหน้าทีมยาวกว่านั้นได้
  const chunks = [];
  let s = String(t);
  while (s.length > 4900 && chunks.length < 4) { chunks.push(s.slice(0, 4900)); s = s.slice(4900); }
  chunks.push(s);
  return lineCall('https://api.line.me/v2/bot/message/push', { to: to, messages: chunks.map(text) });
}

function lineCall(url, payload) {
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + P.getProperty('LINE_TOKEN') },
    payload: JSON.stringify(payload)
  });
  if (res.getResponseCode() >= 300) {
    console.error('LINE ตอบ ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  return res.getResponseCode();
}

// ─────────── ใช้ตอนตั้งค่า ───────────
/** รันมือจากหน้า Apps Script เพื่อดูว่าตั้งค่าครบหรือยัง (ไม่โชว์ค่าจริง) */
function ตรวจการตั้งค่า() {
  ['LINE_TOKEN', 'HOOK_KEY', 'GH_TOKEN', 'ALLOW'].forEach(k => {
    const v = P.getProperty(k);
    console.log(k + ': ' + (v ? 'ตั้งแล้ว (' + v.length + ' ตัวอักษร)' : '❌ ยังไม่ได้ตั้ง'));
  });
}

// เพิ่มคนที่อนุญาตให้แจ้งเรื่องได้:
// ไปที่ Project Settings → Script properties → แก้ค่า ALLOW โดยตรง
// เอารหัสที่ bot ตอบกลับไปในแชทมาต่อท้าย คั่นด้วยจุลภาค เช่น  U123...,U456...
// (ไม่ทำเป็นฟังก์ชันเพราะปุ่มเรียกใช้ส่งอาร์กิวเมนต์ไม่ได้ แก้ตรง ๆ เร็วกว่า)

/** รันมือจากปุ่ม "เรียกใช้" เพื่อแยกให้ออกว่า "ส่ง LINE ไม่ได้" หรือ "หาคนแจ้งไม่เจอ"
 *
 *  ⚠️ ทุกฟังก์ชันในไฟล์นี้ที่ตั้งใจให้กดรันเอง ต้อง "ไม่รับอาร์กิวเมนต์"
 *     เพราะปุ่มเรียกใช้ของ Apps Script ส่งค่าเข้ามาไม่ได้ ตัวแปรจะเป็น undefined
 *     ฟังก์ชันนี้จึงหยิบรหัสคนแรกใน ALLOW มาใช้เอง ไม่ต้องกรอกอะไร */
function ทดสอบส่งข้อความ() {
  const uid = (P.getProperty('ALLOW') || '').split(',')[0].trim();
  if (!uid) return console.log('ยังไม่มีใครใน ALLOW — ใส่รหัสผู้ใช้ที่ Project Settings ก่อน');
  console.log('ส่งหา ' + uid.slice(0, 8) + '…');
  const code = push(uid, 'ทดสอบจากระบบ ถ้าเห็นข้อความนี้แปลว่าส่งได้ปกติ');
  console.log(code === 200 ? '✅ สำเร็จ — ไปดูใน LINE ได้เลย' : '❌ LINE ปฏิเสธ รหัส ' + code);
}

/** ดูว่าเรื่องไหนผูกกับใครไว้บ้าง (ไม่โชว์ userId เต็ม) */
function ดูรายการผู้แจ้ง() {
  const keys = P.getKeys().filter(k => k.indexOf('who:') === 0);
  if (!keys.length) return console.log('ยังไม่มีเรื่องไหนผูกกับผู้แจ้งเลย');
  keys.forEach(k => console.log(k + ' → ' + P.getProperty(k).slice(0, 8) + '…'));
}
