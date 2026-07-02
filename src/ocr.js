const { createWorker } = require("tesseract.js");
const sharp = require("sharp");
const config = require("./config");

// ---- Persistent Tesseract worker ----
// สร้างครั้งเดียวตอนบอทเริ่มทำงาน แล้วใช้ตัวเดิมซ้ำตลอด
// (เดิมโค้ดสร้าง worker ใหม่ + โหลดโมเดลภาษาใหม่ทุกครั้งที่มีรูปเข้ามา ซึ่งช้ามาก)
let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker(config.ocr.language);
  }
  return workerPromise;
}

/**
 * เรียกตอนบอทเริ่มทำงาน (ใน index.js) เพื่อเตรียม worker ให้พร้อมล่วงหน้า
 * ไม่จำเป็นต้องเรียกก็ได้ (จะสร้างอัตโนมัติตอนรูปแรกเข้ามา) แต่เรียกไว้ก่อน
 * จะทำให้รูปแรกที่ user ส่งมาไม่ต้องรอโหลดโมเดล
 */
async function initOcr() {
  await getWorker();
}

/**
 * ดาวน์โหลดรูปจาก URL แนบไฟล์ Discord แล้วคืนค่าเป็น Buffer
 */
async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`โหลดรูปไม่สำเร็จ: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * เตรียมภาพก่อนส่งเข้า OCR เพื่อเพิ่มความแม่นยำ
 * - แปลงเป็นขาวดำ (grayscale)
 * - เพิ่ม contrast
 * - ขยายขนาดถ้ารูปเล็กเกินไป (OCR อ่านตัวเล็กได้แม่นขึ้นเมื่อรูปใหญ่)
 */
async function preprocessImage(buffer) {
  const metadata = await sharp(buffer).metadata();
  // รูปยิ่งเล็ก ยิ่งต้องขยายมากขึ้น เพื่อให้ตัวเลขคมชัดพอให้ OCR อ่านถูก
  let scale;
  if (metadata.width < 600) scale = 3;
  else if (metadata.width < 1000) scale = 2;
  else scale = 1;

  return sharp(buffer)
    .resize({ width: Math.round(metadata.width * scale) })
    .grayscale()
    .normalize() // เพิ่ม contrast อัตโนมัติ
    .sharpen()
    .toBuffer();
}

/**
 * อ่านข้อความทั้งหมดจากรูปด้วย Tesseract แล้วดึงราคาทุกตัวที่เจอ (ตัวเลขต่อจาก B/฿)
 * คืนค่า { rawText, prices } - prices คือ array ของราคาทั้งหมดที่เจอในรูป
 */
async function extractPricesFromImage(imageUrl) {
  const rawBuffer = await downloadImage(imageUrl);
  const processedBuffer = await preprocessImage(rawBuffer);

  const worker = await getWorker();
  const {
    data: { text },
  } = await worker.recognize(processedBuffer);

  const prices = [];
  const matches = text.matchAll(config.ocr.pricePattern);
  for (const m of matches) {
    const num = parseFloat(m[1].replace(/,/g, ""));
    if (!isNaN(num) && num > 0) prices.push(num);
  }

  return { rawText: text, prices };
}

module.exports = { extractPricesFromImage, initOcr };