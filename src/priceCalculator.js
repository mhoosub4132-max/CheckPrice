const config = require("./config");

/**
 * หาราคาร้าน (กรณีมีไนโตร) จากราคาดิสคอร์ดที่อ่านได้
 *
 * ลำดับการค้นหา:
 * 1. ตรงเป๊ะ - ถ้าราคาดิสคอร์ดตรงกับ key ใน priceTable เป๊ะ ใช้ค่านั้นเลย
 * 2. ใกล้เคียงที่สุด - ถ้าไม่ตรงเป๊ะ (เช่น OCR อ่านเพี้ยนไปนิดหน่อย หรือไอเทมราคาใหม่
 *    ที่ยังไม่มีในตาราง) จะหาราคาที่ใกล้เคียงที่สุดในตารางมาใช้แทน แล้วติดธง
 *    isApproximate: true ไว้ เพื่อให้ embed แจ้งเตือนผู้ใช้ว่าเป็นราคาประมาณ
 *
 * คืนค่า { shopPrice, isApproximate, matchedDiscordPrice }
 */
function getShopPriceWithNitro(discordPrice) {
  const table = config.priceTable;

  // 1. ตรงเป๊ะ
  if (Object.prototype.hasOwnProperty.call(table, discordPrice)) {
    return {
      shopPrice: table[discordPrice],
      isApproximate: false,
      matchedDiscordPrice: discordPrice,
    };
  }

  // 2. หาค่าใกล้เคียงที่สุด
  let closestKey = null;
  let closestDiff = Infinity;

  for (const key of Object.keys(table)) {
    const keyNum = Number(key);
    const diff = Math.abs(keyNum - discordPrice);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestKey = keyNum;
    }
  }

  return {
    shopPrice: table[closestKey],
    isApproximate: true,
    matchedDiscordPrice: closestKey,
  };
}

/**
 * คำนวณราคาร้านทั้งกรณีมี/ไม่มีไนโตร จากราคาดิสคอร์ดที่ OCR อ่านได้ 1 ชิ้น
 */
function calculateItemPrice(discordPrice) {
  const { shopPrice, isApproximate, matchedDiscordPrice } =
    getShopPriceWithNitro(discordPrice);
  const withoutNitro = shopPrice + config.noNitroSurchargePerItem;

  return {
    discordPrice,
    withNitro: shopPrice,
    withoutNitro,
    isApproximate,
    matchedDiscordPrice,
  };
}

/**
 * เมื่อ OCR เจอราคาหลายตัวในรูปเดียว (เช่น ราคาปกติขีดฆ่า + ราคาลด)
 * ให้ถือว่า "ราคาปัจจุบัน" คือราคาที่ต่ำสุดที่เจอ (ราคาหลังหักส่วนลด)
 */
function pickCurrentPrice(prices) {
  if (!prices || prices.length === 0) return null;
  return Math.min(...prices);
}

module.exports = { calculateItemPrice, pickCurrentPrice, getShopPriceWithNitro };