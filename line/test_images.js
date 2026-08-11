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
  if (url.indexOf('/issues') >= 0) {
    const b = JSON.parse(opt.payload);
    issues.push({ url, body: b.body, title: b.title, labels: b.labels });
    return { getResponseCode: () => 201, getContentText: () => JSON.stringify({ number: 99 }) };
  }
  if (url.indexOf('api.line.me') >= 0) { sent.push(JSON.parse(opt.payload)); return { getResponseCode: () => 200, getContentText: () => '{}' }; }
  throw new Error('ไม่รู้จัก url: ' + url);
} };

eval(fs.readFileSync(path, 'utf8').replace(/^const P = /m, 'var P = '));

const reset = () => { sent = []; puts = []; issues = []; for (const k in cache) delete cache[k]; };
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
check('ไม่ตอบทีละรูป (ไม่รกกลุ่ม)', sent.length === 0, sent.length + ' ข้อความ');

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
check('บอกว่ารูปที่เกินไม่ได้เก็บ', sent.length === 1 && /สูงสุด 4 รูป/.test(sent[0].messages[0].text));

console.log('\n=== G. ยังไม่ได้ตั้ง INTAKE_TOKEN ===');
reset(); delete props.INTAKE_TOKEN;
handleEvent(msgText('#แจ้ง กดปุ่มส่งออกแล้วไฟล์ไม่ออกมา', GROUP));
sent = [];
handleEvent(msgImg('IMG1', GROUP));
check('ไม่เก็บรูป', !cache['imgs:pending:Uworker']);
check('บอกว่ายังไม่เปิดระบบรับรูป', sent.length === 1 && /ยังไม่ได้เปิดระบบรับรูป/.test(sent[0].messages[0].text));
props.INTAKE_TOKEN = 'IT';

console.log('\n' + (ok ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'));
process.exit(ok ? 0 : 1);
