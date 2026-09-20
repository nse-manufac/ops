// รันตรรกะจริงของ Code.gs โดยสวมของปลอมให้ Apps Script
// เป้าหมายคือกันเคสที่พังแล้วเงียบ — รูปหาย รูปหลุด หรือ bot พูดในกลุ่มโดยไม่มีใครเรียก
const fs = require('fs');
const path = process.argv[2] || require('path').join(__dirname, 'Code.gs');

let ok = true;
const check = (n, c, e = '') => { console.log((c ? '  ผ่าน  ' : '  ตก    ') + n + (e ? '  → ' + e : '')); if (!c) ok = false; };

// ── ของปลอม ──
const props = { LINE_TOKEN:'LT', HOOK_KEY:'K', GH_TOKEN:'GT', INTAKE_TOKEN:'IT', ALLOW:'Cgroup1,Usolo1' };
const cache = {};
let sent = [];       // ข้อความที่ยิงกลับ LINE
let puts = [];       // ไฟล์ที่อัปเข้า intake
let issues = [];     // issue ที่เปิด
let comments = [];   // คอมเมนต์ที่ต่อเข้าเรื่องเดิม

global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in props ? props[k] : null),
  setProperty: (k, v) => { props[k] = v; },
  getKeys: () => Object.keys(props) }) };

global.CacheService = { getScriptCache: () => ({
  get: k => (k in cache ? cache[k] : null),
  put: (k, v) => { cache[k] = v; },
  remove: k => { delete cache[k]; } }) };

global.Utilities = {
  formatDate: () => '20260811',
  getUuid: () => 'abcd1234-0000-0000-0000-000000000000',
  base64Encode: b => 'BASE64(' + b.length + ')'
};
global.ContentService = { createTextOutput: t => ({ t }) };

let uuidN = 0;
global.UrlFetchApp = { fetch: (url, opt) => {
  if (url.indexOf('api-data.line.me') >= 0) {
    const id = url.split('/message/')[1].split('/')[0];
    if (id === 'BAD') return { getResponseCode: () => 404, getContentText: () => 'no' };
    return { getResponseCode: () => 200, getBlob: () => ({ getBytes: () => 'IMG:' + id }) };
  }
  if (url.indexOf('/contents/') >= 0) {
    puts.push({ path: url.split('/contents/')[1], body: JSON.parse(opt.payload) });
    return { getResponseCode: () => 201, getContentText: () => '{}' };
  }
  if (url.indexOf('/comments') >= 0) {
    comments.push({ url, body: JSON.parse(opt.payload).body });
    return { getResponseCode: () => 201, getContentText: () => '{}' };
  }
  if (url.indexOf('/issues') >= 0) {
    const b = JSON.parse(opt.payload);
    issues.push({ url, body: b.body, title: b.title, labels: b.labels });
    return { getResponseCode: () => 201, getContentText: () => JSON.stringify({ number: 99 }) };
  }
  if (url.indexOf('api.line.me') >= 0) { sent.push(JSON.parse(opt.payload)); return { getResponseCode: () => 200, getContentText: () => '{}' }; }
  throw new Error('ไม่รู้จัก url: ' + url);
} };

eval(fs.readFileSync(path, 'utf8').replace(/^const P = /m, 'var P = '));

const reset = () => { sent = []; puts = []; issues = []; comments = [];
  for (const k in cache) delete cache[k];
  Object.keys(props).forEach(k => { if (/^(last|rcount|who|count):/.test(k)) delete props[k]; }); };
const msgText = (t, src) => ({ type:'message', replyToken:'r', source:src, message:{ type:'text', id:'m1', text:t } });
const msgImg  = (id, src) => ({ type:'message', replyToken:'r', source:src, message:{ type:'image', id:id } });
const GROUP = { type:'group', groupId:'Cgroup1', userId:'Uworker' };
const SOLO  = { type:'user', userId:'Usolo1' };

console.log('=== A. ในกลุ่มต้องเงียบเป็นค่าเริ่มต้น ===');
reset(); handleEvent(msgText('พรุ่งนี้ประชุมกี่โมง', GROUP));
check('ข้อความคุยกันธรรมดา ไม่ตอบ ไม่เก็บ', sent.length === 0 && Object.keys(cache).length === 0);

reset(); handleEvent(msgImg('IMG1', GROUP));
check('รูปลอย ๆ ในกลุ่ม ไม่ตอบ ไม่เก็บ', sent.length === 0 && Object.keys(cache).length === 0,
      JSON.stringify(Object.keys(cache)));

console.log('\n=== B. แจ้งเรื่องแล้วแนบรูป ===');
reset();
handleEvent(msgText('#แจ้ง กดบันทึกแล้วยอดวัตถุดิบขึ้นซ้ำสองบรรทัด', GROUP));
check('มีเรื่องค้างไว้รอเลือกแอป', !!cache['pending:Uworker']);
check('ตอบด้วยปุ่มเลือกแอป', sent.length === 1 && !!sent[0].messages[0].quickReply);
check('บอกด้วยว่าแนบรูปได้', /รูปหน้าจอ/.test(sent[0].messages[0].text), sent[0].messages[0].text);

sent = [];
handleEvent(msgImg('IMG1', GROUP));
handleEvent(msgImg('IMG2', GROUP));
check('เก็บรหัสรูปไว้ 2 รูป', JSON.parse(cache['imgs:pending:Uworker'] || '[]').length === 2);
// รูปที่ผู้ใช้ส่งทำให้ปุ่มเลือกโปรแกรมหายไป ต้องส่งกลับมาใหม่ทุกครั้ง
// ไม่งั้นคนแจ้งค้างกลางทาง มีเรื่องรออยู่แต่กดเลือกไม่ได้ — เคยเกิดจริงมาแล้ว
check('ตอบกลับทุกรูปเพื่อพาปุ่มกลับมา', sent.length === 2, sent.length + ' ข้อความ');
check('ทุกคำตอบมีปุ่มเลือกโปรแกรมติดไปด้วย', sent.every(s => !!s.messages[0].quickReply));
check('บอกว่าเก็บไปแล้วกี่รูป', /เก็บรูปไว้แล้ว 2 รูป/.test(sent[1].messages[0].text), sent[1].messages[0].text);

console.log('\n=== C. เลือกแอปแล้วเปิดเรื่อง ===');
sent = [];
handleEvent({ type:'postback', replyToken:'r', source:GROUP, postback:{ data:'repo=store' } });

check('อัปรูปเข้า intake 2 ไฟล์', puts.length === 2, puts.map(p => p.path).join(' , '));
check('อัปเข้า repo ส่วนตัวเท่านั้น', puts.every(p => p.path.indexOf('evidence/store-20260811-') === 0),
      puts.map(p => p.path).join(' , '));
check('ตั้งชื่อไฟล์เรียงลำดับ', puts[0].path.endsWith('/1.jpg') && puts[1].path.endsWith('/2.jpg'));

check('เปิด issue 1 เรื่อง', issues.length === 1);
const body = issues[0].body;
check('อัปรูปเสร็จก่อนเปิด issue', puts.length === 2 && issues.length === 1);
check('issue มีรหัสอ้างอิงหลักฐาน', /evidence: store-20260811-[a-z0-9]{8}/.test(body), body.split('\n').find(l => /evidence/.test(l)));
check('issue บอกจำนวนรูป', /แนบ 2 รูป/.test(body));
check('issue ไม่มีลิงก์ไปที่รูป', !/api\.github|api-data|https?:\/\/[^\s)]*evidence/.test(body));
check('issue ไม่มีรหัสข้อความของ LINE', !/IMG1|IMG2/.test(body), body);
check('issue ไม่มี LINE id ของคนแจ้ง', !/Uworker|Cgroup1/.test(body));
check('ยังติดป้ายเดิมครบ', issues[0].labels.join(',') === 'จาก-LINE,needs-triage');
check('บอกคนแจ้งว่าเก็บรูปแล้ว', /แนบรูปมาด้วย 2 รูป/.test(sent[0].messages[0].text), sent[0].messages[0].text);
check('ล้างรหัสรูปทิ้งหลังใช้', !cache['imgs:pending:Uworker']);

console.log('\n=== D. รูปโหลดไม่ได้ ต้องไม่ทำให้เรื่องหาย ===');
reset();
handleEvent(msgText('#แจ้ง หน้าจอค้างตอนกดพิมพ์การ์ด', GROUP));
handleEvent(msgImg('BAD', GROUP));
sent = [];
handleEvent({ type:'postback', replyToken:'r', source:GROUP, postback:{ data:'repo=plan' } });
check('ยังเปิดเรื่องให้ตามปกติ', issues.length === 1);
check('ไม่ใส่บรรทัดหลักฐานเมื่ออัปไม่สำเร็จ', !/evidence:/.test(issues[0].body));
check('บอกคนแจ้งตรง ๆ ว่ารูปเก็บไม่สำเร็จ', /เก็บไม่สำเร็จ/.test(sent[0].messages[0].text), sent[0].messages[0].text);

console.log('\n=== E. แชทเดี่ยว ส่งรูปมาก่อนโดยไม่แจ้งเรื่อง ===');
reset();
handleEvent(msgImg('IMG9', SOLO));
check('ไม่เก็บรูป', puts.length === 0 && !cache['imgs:pending:Usolo1']);
check('บอกวิธีที่ถูกต้อง', sent.length === 1 && /ต้องเล่าอาการก่อน/.test(sent[0].messages[0].text),
      sent.length ? sent[0].messages[0].text : '(ไม่ตอบเลย)');

console.log('\n=== F. เกินเพดานจำนวนรูป ===');
reset();
handleEvent(msgText('#แจ้ง ยอดคงเหลือไม่ตรงกับที่นับได้จริง', GROUP));
sent = [];
['A','B','C','D','E'].forEach(i => handleEvent(msgImg('IMG' + i, GROUP)));
check('เก็บแค่ 4 รูป', JSON.parse(cache['imgs:pending:Uworker']).length === 4);
check('บอกว่ารูปที่เกินไม่ได้เก็บ', /สูงสุด 4 รูป/.test(sent[4].messages[0].text), sent[4].messages[0].text);
check('รูปที่เกินก็ยังพาปุ่มกลับมา', !!sent[4].messages[0].quickReply);
check('รูปครบแล้วบอกว่าครบ', /ครบแล้ว/.test(sent[3].messages[0].text), sent[3].messages[0].text);

console.log('\n=== G. ยังไม่ได้ตั้ง INTAKE_TOKEN ===');
reset(); delete props.INTAKE_TOKEN;
handleEvent(msgText('#แจ้ง กดปุ่มส่งออกแล้วไฟล์ไม่ออกมา', GROUP));
sent = [];
handleEvent(msgImg('IMG1', GROUP));
check('ไม่เก็บรูป', !cache['imgs:pending:Uworker']);
check('บอกว่ายังไม่เปิดระบบรับรูป', sent.length === 1 && /ยังไม่ได้เปิดระบบรับรูป/.test(sent[0].messages[0].text));
check('ถึงรับรูปไม่ได้ ก็ยังพาปุ่มกลับมา', !!sent[0].messages[0].quickReply);
props.INTAKE_TOKEN = 'IT';

console.log('\n=== G2. กฎเหล็ก: ระหว่างมีเรื่องค้าง ทุกคำตอบต้องมีปุ่ม ===');
// ถ้าข้อไหนตก แปลว่ามีทางออกที่ทำให้คนแจ้งค้างกลางทาง กดเลือกโปรแกรมไม่ได้อีก
reset();
handleEvent(msgText('#แจ้ง ยอดที่คีย์ไปหายจากหน้าจอ', GROUP));
const noBtn = [];
[ () => handleEvent(msgImg('IMG1', GROUP)),
  () => handleEvent(msgImg('IMG2', GROUP)),
  () => handleEvent(msgImg('IMG3', GROUP)),
  () => handleEvent(msgImg('IMG4', GROUP)),
  () => handleEvent(msgImg('IMG5', GROUP)),          // เกินเพดาน
].forEach((step, i) => {
  sent = [];
  step();
  sent.forEach(s => { if (!s.messages[0].quickReply) noBtn.push('ขั้นที่ ' + (i + 1)); });
});
check('ไม่มีคำตอบไหนที่ทำปุ่มหาย', noBtn.length === 0, noBtn.join(', '));

console.log('\n=== H. ตอบคำถามที่หัวหน้าทีมถามกลับมา ===');
reset();
handleEvent(msgText('#ตอบ เห็นซ้ำที่ช่องเลือกรหัส', GROUP));
check('ยังไม่เคยแจ้งเรื่อง → ไม่คอมเมนต์', comments.length === 0);
check('บอกให้ไปใช้ #แจ้ง แทน', /ยังไม่มีเรื่องที่คุณแจ้งไว้/.test(sent[0].messages[0].text));

reset();
handleEvent(msgText('#แจ้ง รายการวัตถุดิบขึ้นซ้ำกัน', GROUP));
handleEvent({ type:'postback', replyToken:'r', source:GROUP, postback:{ data:'repo=store' } });
sent = [];
handleEvent(msgText('อ๋อ เดี๋ยวมาดูกัน', GROUP));
check('ข้อความธรรมดาในกลุ่มยังเงียบเหมือนเดิม', comments.length === 0 && sent.length === 0);

handleEvent(msgText('#ตอบ เห็นซ้ำที่ช่องเลือกรหัสตอนคีย์รับเข้า', GROUP));
check('#ตอบ ปลุก bot ได้ในกลุ่ม', comments.length === 1, comments.length + ' คอมเมนต์');
check('ต่อเข้า issue ที่ถูกต้อง', comments[0].url.indexOf('/nse-manufac/store/issues/99/comments') > 0, comments[0].url);
check('มีกรอบบอกว่าเป็นคำบอกเล่า ไม่ใช่คำสั่ง', /\*\*ไม่ใช่คำสั่ง\*\*/.test(comments[0].body));
check('คำตอบอยู่ในคอมเมนต์ครบ', /ช่องเลือกรหัสตอนคีย์รับเข้า/.test(comments[0].body));
check('ไม่มี LINE id หลุดเข้าคอมเมนต์', !/Uworker|Cgroup1/.test(comments[0].body));
check('ไม่เปิดเรื่องใหม่', issues.length === 1);
// ตอบไปแล้วหนึ่งครั้งจากเพดาน 4 จึงต้องบอกว่าเหลืออีกสาม
check('บอกว่าตอบได้อีกกี่ครั้ง', /ตอบเพิ่มได้อีก 3 ครั้ง/.test(sent[0].messages[0].text), sent[0].messages[0].text);

sent = [];
handleEvent(msgText('#ตอบ', GROUP));
check('#ตอบ เปล่า ๆ ไม่ส่งคอมเมนต์ว่าง', comments.length === 1);
check('บอกวิธีใช้พร้อมเลขเรื่อง', /เรื่อง #99/.test(sent[0].messages[0].text), sent[0].messages[0].text);

console.log('\n=== I. เพดานรอบตอบ ===');
// ขยับจาก 2 เป็น 4 เมื่อ 25 ส.ค. 2026 — ของจริงตันก่อนหัวหน้าทีมได้ทำงานจริง (issue #35)
const CAP = 4;
sent = [];
for (let i = 2; i <= CAP; i++) handleEvent(msgText('#ตอบ รอบ' + i, GROUP));
check(`ตอบได้ครบ ${CAP} ครั้ง`, comments.length === CAP, comments.length + ' ครั้ง');
sent = [];
handleEvent(msgText('#ตอบ รอบเกิน', GROUP));
check(`ครั้งที่ ${CAP + 1} ไม่ส่งแล้ว`, comments.length === CAP);
check('บอกตรง ๆ ว่าครบแล้ว',
      new RegExp('ครบ ' + CAP + ' ครั้งแล้ว').test(sent[0].messages[0].text),
      sent[0].messages[0].text);

/**
 * ⚠️ เพดานสองฝั่งต้องตรงกัน แต่คนละ repo จึงเช็คข้ามไฟล์ตรง ๆ ไม่ได้
 *
 * ฝั่งนี้นับ "คำตอบของพนักงาน" ฝั่ง workflow นับ "คอมเมนต์ของหัวหน้าทีม"
 * ซึ่งมีรอบแรกตอนเปิดเรื่องรวมอยู่ด้วย เพดานที่นั่นจึงต้องเป็น CAP + 1 เสมอ
 * ถ้าตั้งไม่ตรงกัน พนักงานจะพิมพ์คำตอบที่ไม่มีใครอ่านแล้วไม่รู้ตัว
 *
 * จึงตรึงทั้งตัวเลขและคำอธิบายที่จับคู่ไว้ ใครแก้ข้างเดียวเทสจะดังทันที
 */
const code = require('fs').readFileSync('line/Code.gs', 'utf8');
check('เพดานในโค้ดตรงกับที่เทสไว้',
      new RegExp('const MAX_REPLY\\s*=\\s*' + CAP + ';').test(code));
check('โค้ดเขียนกำกับไว้ว่าฝั่ง workflow ต้องเป็นเท่าไหร่',
      new RegExp(CAP + '\\s*\\+\\s*1\\s*=\\s*' + (CAP + 1)).test(code),
      'ต้องมีข้อความว่า ' + CAP + ' + 1 = ' + (CAP + 1) + ' อยู่ในคอมเมนต์');

console.log('\n=== J. หลายคนในกลุ่มเดียวกัน ต่างคนต่างเรื่อง ===');
reset();
const A = { type:'group', groupId:'Cgroup1', userId:'Uaaa' };
const B = { type:'group', groupId:'Cgroup1', userId:'Ubbb' };
handleEvent(msgText('#แจ้ง เรื่องของคนที่หนึ่ง ยอดไม่ตรง', A));
handleEvent({ type:'postback', replyToken:'r', source:A, postback:{ data:'repo=store' } });
issues[0] = issues[0];                                  // #99 ของ A
UrlFetchApp.fetch = ((f) => (url, opt) => {             // ให้เรื่องที่สองได้เลข 100
  if (url.indexOf('/issues') >= 0 && url.indexOf('/comments') < 0) {
    issues.push({ url, body: JSON.parse(opt.payload).body });
    return { getResponseCode: () => 201, getContentText: () => JSON.stringify({ number: 100 }) };
  }
  return f(url, opt);
})(UrlFetchApp.fetch);
handleEvent(msgText('#แจ้ง เรื่องของคนที่สอง กดพิมพ์แล้วค้าง', B));
handleEvent({ type:'postback', replyToken:'r', source:B, postback:{ data:'repo=plan' } });

comments = [];
handleEvent(msgText('#ตอบ คำตอบของคนที่หนึ่ง', A));
handleEvent(msgText('#ตอบ คำตอบของคนที่สอง', B));
check('คนแรกตอบเข้าเรื่องของตัวเอง', /store\/issues\/99\//.test(comments[0].url), comments[0].url);
check('คนที่สองตอบเข้าเรื่องของตัวเอง', /plan\/issues\/100\//.test(comments[1].url), comments[1].url);


console.log('\n=== K. คำสั่งของเจ้าของ กับ สรุปเป็นรอบ ===');

// รหัสที่ถูกรูปแบบ = ตัวนำหน้า 1 + เลขฐานสิบหกตัวเล็ก 32 = 33 ตัว
const OWNER = 'U0123456789abcdef0123456789abcdef';
const OTHER = 'Uffffffff11111111ffffffff11111111';
props.ALLOW = 'Cgroup1,Usolo1,' + OWNER + ',' + OTHER;
const OWN  = { type: 'user', userId: OWNER };
const NOT  = { type: 'user', userId: OTHER };
const said = () => (sent[0] && sent[0].messages[0].text) || '';

// ── สวม GitHub ปลอมสำหรับหมวดนี้ ──
const hoursAgo = h => new Date(Date.now() - h * 36e5).toISOString();
let fakeIssues = {
  store: [
    { number: 91, title: 'LINE: ตอนคัดกรองล้ม', labels: [], comments: 2,
      created_at: hoursAgo(2), pull_request: { url: 'x' }, state: 'open', html_url: 'U91' },
    { number: 63, title: 'agent-guard ตัดสินจากสิ่งที่เลือกเองได้', labels: [{ name: 'needs-owner-decision' }],
      comments: 4, created_at: hoursAgo(300), state: 'open', html_url: 'U63' },
    { number: 96, title: 'คีย์รับเข้าแล้วยอดไม่ขึ้น', labels: [{ name: 'จาก-LINE' }, { name: 'needs-triage' }],
      comments: 0, created_at: hoursAgo(3), state: 'open', html_url: 'U96' },
    { number: 97, title: 'เพิ่งแจ้งเข้ามาเมื่อกี้', labels: [{ name: 'จาก-LINE' }],
      comments: 1, created_at: hoursAgo(1), state: 'open', html_url: 'U97' }
  ],
  plan: []
};
let patched = [];
const ghFake = (url, opt) => {
  const m = url.match(/\/repos\/nse-manufac\/(store|plan)\/issues(\?|\/(\d+))/);
  if (m && m[2] === '?') return { getResponseCode: () => 200, getContentText: () => JSON.stringify(fakeIssues[m[1]]) };
  if (m && m[3]) {
    const it = (fakeIssues[m[1]] || []).filter(x => String(x.number) === m[3])[0];
    if (/\/comments$/.test(url)) { comments.push({ url, body: JSON.parse(opt.payload).body }); return { getResponseCode: () => 201, getContentText: () => '{}' }; }
    if ((opt.method || 'get') === 'patch') {
      // ของจริง GitHub ตอบ 404 ถ้าเรื่องนั้นไม่มีอยู่ — ของปลอมต้องโกหกเหมือนกันไม่ได้
      if (!it) return { getResponseCode: () => 404, getContentText: () => '{}' };
      patched.push({ n: m[3], state: JSON.parse(opt.payload).state });
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    }
    return it ? { getResponseCode: () => 200, getContentText: () => JSON.stringify(it) }
              : { getResponseCode: () => 404, getContentText: () => '{}' };
  }
  if (url.indexOf('api.line.me') >= 0) { sent.push(JSON.parse(opt.payload)); return { getResponseCode: () => 200, getContentText: () => '{}' }; }
  throw new Error('ไม่รู้จัก url: ' + url);
};
UrlFetchApp.fetch = ghFake;

// ── OWNER_ID ที่ผิดรูปแบบ ต้องถือว่า "ยังไม่ได้ตั้ง" ──
// ข้อนี้สำคัญที่สุดในหมวด ถ้าพลาดคือล็อกเจ้าของออกจากระบบโดยแก้จากใน LINE ไม่ได้
['', '  ', '"' + OWNER + '"', OWNER.toUpperCase(), OWNER.slice(0, 20), OWNER + 'a',
 'C0123456789abcdef0123456789abcdef', 'ยังไม่ได้ตั้ง']
  .forEach(bad => {
    props.OWNER_ID = bad;
    check('OWNER_ID ผิดรูปแบบ (' + bad.length + ' ตัว) ถือว่ายังไม่ได้ตั้ง', ownerId() === '', JSON.stringify(ownerId()));
  });
// เว้นวรรคหัวท้ายติดมาตอนคัดลอกเป็นเรื่องปกติที่สุด และตัดทิ้งได้อย่างปลอดภัย
// จึงต้องยอมรับ ไม่ใช่ปฏิเสธ — ไม่งั้นเจ้าของจะงงว่าใส่ถูกแล้วทำไมไม่ทำงาน
[' ' + OWNER, OWNER + ' ', '\t' + OWNER + '\n'].forEach(ws => {
  props.OWNER_ID = ws;
  check('OWNER_ID ที่มีเว้นวรรคติดมา (' + ws.length + ' ตัว) ยังใช้ได้', ownerId() === OWNER, JSON.stringify(ownerId()));
});
props.OWNER_ID = OWNER;
check('OWNER_ID ที่ถูกต้อง ใช้ได้', ownerId() === OWNER);

// ── #ฉัน เปิดให้ทุกคนใน ALLOW เพราะเป็นทางเดียวที่เจ้าของจะรู้รหัสตัวเอง ──
reset(); handleEvent(msgText('#ฉัน', NOT));
check('#ฉัน บอกรหัสของคนที่ถาม', said().indexOf(OTHER) >= 0 && issues.length === 0, said().slice(0, 40));

// ── คนอื่นสั่งไม่ได้ ──
reset(); handleEvent(msgText('#สรุป', NOT));
check('คนที่ไม่ใช่เจ้าของ สั่ง #สรุป ไม่ได้', /เฉพาะเจ้าของ/.test(said()) && issues.length === 0);
reset(); handleEvent(msgText('#ปิด s96', NOT));
check('คนที่ไม่ใช่เจ้าของ สั่ง #ปิด ไม่ได้', /เฉพาะเจ้าของ/.test(said()) && patched.length === 0);

// ── คำสั่งต้องไม่กลายเป็นการเปิด issue ใหม่ ──
// ถ้าลำดับการตรวจผิด "#ปิด s96" จะถูกอ่านเป็นการแจ้งปัญหา แล้วเปิดเรื่องขยะขึ้นมา
reset(); patched = []; handleEvent(msgText('#ปิด s96 ไม่ใช่บั๊ก ทะเบียนมีชื่อซ้ำ', OWN));
check('#ปิด ไม่เปิด issue ใหม่', issues.length === 0 && Object.keys(cache).length === 0);
check('#ปิด สั่งปิดจริง', patched.length === 1 && patched[0].n === '96' && patched[0].state === 'closed', JSON.stringify(patched));
check('#ปิด บันทึกเหตุผลไว้ในเรื่อง', comments.length === 1 && /ทะเบียนมีชื่อซ้ำ/.test(comments[0].body));

reset(); patched = []; handleEvent(msgText('#ตรวจใหม่ p0', OWN));
check('#ตรวจใหม่ เรื่องที่ไม่มีอยู่ ไม่พังและไม่เปิดค้าง', patched.length <= 1 && /ไม่สำเร็จ|GitHub ตอบ/.test(said()), said().slice(0, 40));

reset(); patched = []; handleEvent(msgText('#ตรวจใหม่ s96', OWN));
check('#ตรวจใหม่ ปิดแล้วเปิดกลับ', patched.length === 2 && patched[0].state === 'closed' && patched[1].state === 'open', JSON.stringify(patched));
check('#ตรวจใหม่ บอกว่ามีค่าใช้จ่าย', /ค่าใช้จ่าย/.test(said()), said());

// ── #เรื่อง ──
reset(); handleEvent(msgText('#เรื่อง s63', OWN));
check('#เรื่อง แสดงป้ายและจำนวนคอมเมนต์', /needs-owner-decision/.test(said()) && /4 อัน/.test(said()), said().slice(0, 60));
reset(); handleEvent(msgText('#เรื่อง', OWN));
check('#เรื่อง ที่ไม่บอกเลข สอนวิธีใช้ ไม่เงียบ', /s48/.test(said()));

// ── สรุป ──
reset(); handleEvent(msgText('#สรุป', OWN));
const d = said();
check('สรุปจับ "ไม่มีใครตอบเลย" ของเรื่องที่คอมเมนต์เป็นศูนย์', /s96/.test(d) && /ยังไม่มีใครตอบเลย/.test(d), d);
check('สรุปไม่เหมาเรื่องที่เพิ่งแจ้งมาชั่วโมงเดียวว่าล้ม', d.indexOf('s97 ') === -1 || !/s97.*ยังไม่มีใครตอบ/.test(d));
check('สรุปแยก PR ออกมาเป็นรอคุณอนุมัติ', /รอคุณอนุมัติ/.test(d) && /s91/.test(d), d);
check('สรุปแยกเรื่องที่รอตัดสิน', /รอคุณตัดสิน/.test(d) && /s63/.test(d));
check('สรุปไม่มี markdown ปนมา', !/\*\*|^#\s|\|/m.test(d), d.slice(0, 80));

// ── ไม่มีอะไรค้าง = ตัวตั้งเวลาต้องไม่ส่ง ──
fakeIssues = { store: [], plan: [] };
check('ไม่มีอะไรค้าง buildDigest คืนค่าว่าง', buildDigest() === '');
reset(); handleEvent(msgText('#สรุป', OWN));
check('แต่ถ้าเจ้าของถามเอง ต้องตอบ ไม่ใช่เงียบ', /ไม่มีอะไรค้าง/.test(said()), said());

// ── ในกลุ่ม: เจ้าของสั่งได้ คนอื่นยังเงียบเหมือนเดิม ──
fakeIssues = { store: [], plan: [] };
const GOWN = { type: 'group', groupId: 'Cgroup1', userId: OWNER };
const GOTH = { type: 'group', groupId: 'Cgroup1', userId: OTHER };
reset(); handleEvent(msgText('#สรุป', GOWN));
check('เจ้าของสั่งในกลุ่มได้ ไม่เงียบ', sent.length === 1 && /ไม่มีอะไรค้าง/.test(said()), said());
reset(); handleEvent(msgText('#สรุป', GOTH));
check('คนอื่นพิมพ์คำสั่งในกลุ่ม ยังเงียบเหมือนเดิม', sent.length === 0);
reset(); handleEvent(msgText('#อะไรก็ไม่รู้', GOTH));
check('ข้อความขึ้นต้นด้วย # ของคนอื่นในกลุ่ม ยังเงียบ', sent.length === 0);

// ── ยังไม่ได้ตั้ง OWNER_ID ──
props.OWNER_ID = 'ยังไม่ได้ตั้ง';
reset(); handleEvent(msgText('#สรุป', OWN));
check('ยังไม่ได้ตั้ง OWNER_ID ต้องบอกวิธีตั้ง ไม่ใช่เงียบ', /#ฉัน/.test(said()) && /OWNER_ID/.test(said()), said());
props.OWNER_ID = OWNER;

console.log('\n' + (ok ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'));
process.exit(ok ? 0 : 1);
