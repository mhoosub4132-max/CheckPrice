require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { extractPricesFromImage, initOcr } = require("./ocr");
const { calculateItemPrice, pickCurrentPrice } = require("./priceCalculator");
const config = require("./config");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/**
 * เช็คว่าห้องที่ส่งข้อความมา อนุญาตให้บอททำงานไหม
 *
 * ลำดับการเช็ค:
 * 1. Blacklist ก่อนเสมอ - ถ้าห้องหรือหมวดหมู่ของห้องนั้นติด blacklist บอทจะไม่ทำงานเด็ดขาด
 *    ไม่ว่า allowlist จะตั้งค่าไว้ยังไงก็ตาม
 * 2. Allowlist - ถ้าไม่ได้ตั้งค่า allowedChannelIds และ allowedCategoryIds ไว้เลย
 *    (ปล่อยว่างทั้งคู่) ถือว่าอนุญาตทุกห้องที่ไม่ติด blacklist
 */
function isChannelAllowed(channel) {
  const {
    allowedChannelIds,
    allowedCategoryIds,
    blacklistedChannelIds,
    blacklistedCategoryIds,
  } = config;

  // 1. เช็ค blacklist ก่อนเสมอ
  if (blacklistedChannelIds.includes(channel.id)) return false;
  if (channel.parentId && blacklistedCategoryIds.includes(channel.parentId))
    return false;

  // 2. เช็ค allowlist
  const noRestriction =
    allowedChannelIds.length === 0 && allowedCategoryIds.length === 0;
  if (noRestriction) return true;

  if (allowedChannelIds.includes(channel.id)) return true;
  if (channel.parentId && allowedCategoryIds.includes(channel.parentId))
    return true;

  return false;
}

client.once("clientReady", async () => {
  console.log(`บอทออนไลน์แล้วในชื่อ ${client.user.tag}`);
  console.log("กำลังเตรียม OCR worker...");
  await initOcr();
  console.log("OCR worker พร้อมใช้งานแล้ว");
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return; // ไม่ทำงานใน DM
  if (!isChannelAllowed(message.channel)) return; // ห้องนี้ไม่ได้อยู่ในรายการที่อนุญาต

  // ทำงานทันทีเมื่อมีรูปแนบมาในข้อความ ไม่ต้องพิมพ์คำสั่งใด ๆ
  const images = [...message.attachments.values()].filter((att) =>
    IMAGE_EXT.test(att.name || "")
  );

  if (images.length === 0) return; // ไม่มีรูปแนบ ก็เฉย ๆ ไม่ต้องตอบอะไร

  const statusMsg = await message.reply(
    `⏳ กำลังอ่านราคาจาก ${images.length} รูป...`
  );

  const results = await Promise.all(
    images.map(async (att, index) => {
      try {
        const { prices, rawText } = await extractPricesFromImage(att.url);
        const current = pickCurrentPrice(prices);

        if (current === null) {
          let errorMsg = "อ่านราคาจากรูปนี้ไม่พบ (ลองส่งรูปที่คมชัดกว่านี้)";
          if (config.debugOcr) {
            const snippet = rawText.trim().slice(0, 300).replace(/\n+/g, " ");
            errorMsg += `\n📝 OCR อ่านได้: "${snippet}"`;
          }
          return { index: index + 1, error: errorMsg };
        }

        return { index: index + 1, ...calculateItemPrice(current) };
      } catch (err) {
        console.error(err);
        return { index: index + 1, error: "เกิดข้อผิดพลาดระหว่างอ่านรูป" };
      }
    })
  );

  const embed = buildResultEmbed(results);
  const components = buildTicketButtonRow(message.guild.id);

  await statusMsg.edit({
    content: "✅ ผลการอ่านราคา",
    embeds: [embed],
    components,
  });
});

/**
 * สร้างปุ่มลิงก์ไปห้องเปิด ticket ถ้ามีการตั้งค่า ticketChannelId ไว้ใน config
 * ถ้าไม่ได้ตั้งค่า (เป็นค่าว่าง) จะคืน [] ไม่แสดงปุ่มเลย
 */
function buildTicketButtonRow(guildId) {
  if (!config.ticketChannelId) return [];

  const ticketUrl = `https://discord.com/channels/${guildId}/${config.ticketChannelId}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("🎟️ เปิด Ticket สั่งซื้อ")
      .setStyle(ButtonStyle.Link)
      .setURL(ticketUrl)
  );

  return [row];
}

function buildResultEmbed(results) {
  const okResults = results.filter((r) => !r.error);

  const discordLines = results
    .map((r) =>
      r.error ? `#${pad(r.index)} ⚠️ ${r.error}` : `#${pad(r.index)} ${formatPrice(r.discordPrice)} บาท`
    )
    .join("\n");

  const nitroLines = okResults
    .map((r) => {
      const approxTag = r.isApproximate ? " (~ ประมาณ)" : "";
      return `#${pad(r.index)} ${formatPrice(r.withNitro)} บาท${approxTag}`;
    })
    .join("\n");
  const nitroTotal = okResults.reduce((sum, r) => sum + r.withNitro, 0);

  const noNitroLines = okResults
    .map(
      (r) =>
        `#${pad(r.index)} ${formatPrice(r.withNitro)}+${formatPrice(config.noNitroSurchargePerItem)} = ${formatPrice(r.withoutNitro)} บาท`
    )
    .join("\n");
  const noNitroTotal = okResults.reduce((sum, r) => sum + r.withoutNitro, 0);

  const embed = new EmbedBuilder()
    .setColor(0xff69b4)
    .setTitle(`ผลการอ่าน ( จำนวน ${results.length} รูป )`)
    .addFields(
      { name: "💗 ราคาดิสคอร์ด", value: "```\n" + discordLines + "\n```" },
      {
        name: "💗 ราคาร้านขาย (มีไนโตร)",
        value:
          "```\n" +
          (nitroLines || "-") +
          `\nรวมราคา : ${formatPrice(nitroTotal)} บาท` +
          "\n```",
      },
      {
        name: "💗 ราคาไม่มีไนโตร (บวกเพิ่มชิ้นละ)",
        value:
          "```\n" +
          (noNitroLines || "-") +
          `\nรวมราคา : ${formatPrice(noNitroTotal)} บาท` +
          "\n```",
      }
    );

  return embed;
}

/**
 * แสดงราคาแบบไม่มีทศนิยมถ้าเป็นเลขลงตัว (เช่น 79 ไม่ใช่ 79.00)
 * แต่ยังคงทศนิยมไว้ถ้าจำเป็น (เช่น 79.50)
 */
function formatPrice(num) {
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

client.login(process.env.DISCORD_TOKEN);