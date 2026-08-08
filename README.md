# ops — แดชบอร์ดของทีม agent

หน้าเดียวที่ตอบว่า **ทีม agent ทำอะไรไปบ้าง มีอะไรรอเราอยู่ และใช้เงินไปเท่าไร**
ครอบคลุม `nse-manufac/store` และ `nse-manufac/plan`

👉 https://nse-manufac.github.io/ops/

---

## repo นี้ทำอะไร

ทุก 30 นาที มันจะ

1. ถาม GitHub ว่า agent ของทั้งสอง repo รันอะไรไปบ้าง
2. ดึงราคาและจำนวนเทิร์นของแต่ละรอบออกจาก log
3. เขียน `index.html` ใหม่แล้ว commit — GitHub Pages เผยแพร่ให้เอง

**ไม่มี agent อยู่ใน repo นี้** มีแต่สคริปต์ที่คนเขียน (`scripts/build.py`)

---

## ตั้งค่าครั้งเดียวตอนเริ่ม

### 1. สร้าง PAT แบบอ่านอย่างเดียว

github.com/settings/personal-access-tokens → **Generate new token**

| ช่อง | ค่า |
|---|---|
| ชื่อ | `ops-dashboard-read` |
| Repository access | Only select repositories → เลือก **store** และ **plan** |
| Repository permissions | **Actions: Read-only** · **Contents: Read-only** · **Issues: Read-only** · **Pull requests: Read-only** |

> **ห้ามให้สิทธิ์เขียนอะไรทั้งสิ้น** token นี้ทำหน้าที่อ่านอย่างเดียว
> การเขียน `index.html` ใช้ `GITHUB_TOKEN` ของ repo นี้เอง ซึ่งแตะ repo อื่นไม่ได้

### 2. ใส่เป็น secret

github.com/nse-manufac/ops/settings/secrets/actions → **New repository secret**

ชื่อ `READ_AGENTS_PAT` (ตรงตัวพิมพ์)

### 3. เปิด Pages

Settings → Pages → Source = **Deploy from a branch** → `main` / `(root)`

---

## ทำไมต้องใช้ PAT ไม่ใช้ GITHUB_TOKEN

`GITHUB_TOKEN` ของ repo นี้อ่าน Actions API ของ repo อื่นไม่ได้ ถึงจะเป็น public ก็ตาม

ผลพลอยได้คือขอบเขตชัดมาก — token ที่เก็บไว้ที่นี่ **อ่านได้อย่างเดียวและอ่านได้แค่สอง repo นั้น**
ต่อให้หลุดออกไป ก็อ่านได้เฉพาะสิ่งที่เป็นสาธารณะอยู่แล้ว

---

## หลักที่ใช้ตัดสินว่าอะไรรวม อะไรแยก

**รวมได้เฉพาะสิ่งที่แชร์กันจริง** — บิลใบเดียวกัน กับคิวความสนใจของเจ้าของ

**ที่เหลือแยกรายทีมทั้งหมด** เพราะทุกอย่างที่ลงมือทำกับมันเป็นรายทีม —
เพดานปรับแยก · key เพิกถอนแยก · prompt แก้แยก

ตัวเลขรวมอย่าง "หัวหน้าทีมใช้ไป $2.00" เอาไปตัดสินใจอะไรไม่ได้
แต่ "หัวหน้าทีมของ plan แพงกว่าของ store 28%" เอาไปทำอะไรต่อได้

---

## เรื่องที่ควรรู้

**ราคาอยู่ใน log ดิบเท่านั้น** ไม่มี API ให้ถามตรง ๆ ต้องโหลด log ทั้งไฟล์มาหา
ซึ่งกินเวลา 3–5 วินาทีต่อรอบ จึงเก็บ `data.json` ไว้เป็น cache และอ่านเฉพาะรอบใหม่

**GitHub เก็บ log ไว้ 90 วัน** รอบที่เก่ากว่านั้นอ่านราคาไม่ได้อีก
แต่เพราะ cache ไว้แล้ว ตัวเลขเก่าจึงไม่หายไปจากแดชบอร์ด — **อย่าลบ `data.json`**

**รอบที่ถูกข้ามไม่ปรากฏในตาราง** เพราะไม่ได้เรียกโมเดลและไม่มีค่าใช้จ่าย
ส่วนรอบที่ล้มแล้วเสียเงินจะขึ้นเป็นแถวจาง ๆ พร้อมนับรวมใน "เสียเปล่า"

**เพดานเป็นของใครของมัน** `store` 6 + `plan` 6 = ช่างซ่อมรันได้ 12 รอบ/วัน ไม่ใช่ 6
ปรับที่ Settings → Variables → `AGENT_MAX_RUNS_PER_DAY` ของแต่ละ repo

---

## รันในเครื่อง

ต้องมี `gh` ที่ล็อกอินแล้ว กับ Python 3

```
python scripts/build.py                # เก็บข้อมูลใหม่แล้วสร้างหน้า
python scripts/build.py --render-only  # สร้างหน้าใหม่จาก data.json เดิม (แก้หน้าตาเร็ว ๆ)
```
