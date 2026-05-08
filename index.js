require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const admin = require("firebase-admin");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

// ===== FIREBASE INIT =====
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.PROJECT_ID,
    clientEmail: process.env.CLIENT_EMAIL,
    privateKey: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

// ===== GOOGLE SHEETS INIT =====
// Avtorizatsiya sozlamalari
const serviceAccountAuth = new JWT({
  email: process.env.CLIENT_EMAIL,
  key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const doc = new GoogleSpreadsheet(
  process.env.SPREADSHEET_ID,
  serviceAccountAuth,
);

// Google Sheetga sarlavhalarni yozish (agar jadval bo'sh bo'lsa)
async function initSheets() {
  try {
    await doc.loadInfo();
    let sheet = doc.sheetsByIndex[0];

    // Agar sarlavhalar bo'lmasa, yaratamiz
    if (sheet.rowCount <= 1) {
      await sheet.setHeaderRow([
        "Foydalanuvchi ID",
        "To'liq ism",
        "Lavozim",
        "Yo'nalish",
        "Til",
        "Telefon",
        "Tajriba (yil)",
        "O'qish joyi",
        "Mutaxassislik",
        "Oldingi ish joyi",
        "Ko'nikmalar",
        "Sana",
      ]);
    }
    console.log("✅ Google Sheets bilan aloqa o'rnatildi.");
  } catch (e) {
    console.error("❌ Google Sheets ulanishda xato:", e);
  }
}
initSheets();

const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== STATE (XOTIRA) =====
// Murakkabroq state boshqaruvi
const userState = {};

// ===== YORDAMCHI FUNKSIYALAR =====
const cancelKeyboard = Markup.keyboard([["❌ Bekor qilish"]]).resize();

const restartProcess = (ctx) => {
  delete userState[ctx.from.id];
  return ctx.reply(
    "Anketani to'ldirish bekor qilindi. Qayta boshlash uchun /start bosing.",
  );
};

// Lavozim nomlarini chiroyli ko'rsatish
const roleNames = {
  teacher: "📚 O'qituvchi",
  technical: "🛠 Texnik xodim",
  manager: "👔 Rahbar",
};

// ===== START =====
bot.start((ctx) => {
  userState[ctx.from.id] = { step: "choosing_role" };

  return ctx.reply(
    `👋 Assalomu alaykum, Ideal Ilm-Tarbiya Xususiy Maktabi ishga qabul botiga xush kelibsiz!\n\nKeling, anketani to'ldiramiz. Avvalo, lavozimingizni tanlang:`,
    Markup.keyboard([
      ["📚 O'qituvchilar", "🛠 Texnik xodimlar"],
      ["👔 Rahbarlar"],
    ]).resize(),
  );
});

// Yangi test qo'shildi

// Bekor qilish komandasi
bot.hears("❌ Bekor qilish", restartProcess);

// ===== ROLE CHOOSING =====
bot.hears("📚 O'qituvchilar", (ctx) => {
  const id = ctx.from.id;
  if (!userState[id]) return;
  userState[id].roleType = "teacher";
  userState[id].step = "choosing_direction";

  ctx.reply(
    "Mutaxassisligingiz (faningiz) bo'yicha yo'nalishni tanlang:",
    Markup.keyboard([
      ["Matematika", "Fizika"],
      ["Ona tili", "Ingliz tili"],
      ["Tarix", "Biologiya"],
      ["Kimyo", "Informatika"],
      ["Boshlang'ich", "Jismoniy tarbiya"],
      ["Arab tili", "Boshqa"],
      ["❌ Bekor qilish"],
    ]).resize(),
  );
});

bot.hears("🛠 Texnik xodimlar", (ctx) => {
  const id = ctx.from.id;
  if (!userState[id]) return;
  userState[id].roleType = "technical";
  userState[id].step = "choosing_direction";

  ctx.reply(
    "O'zingizga mos sohani tanlang:",
    Markup.keyboard([
      ["Oshpaz", "Oshpaz yordamchisi"],
      ["Qo'riqlov", "Administrator"],
      ["Kutubxonachi", "SMM mutaxassisi"],
      ["Usta texnik", "Boshqa"],
      ["❌ Bekor qilish"],
    ]).resize(),
  );
});

bot.hears("👔 Rahbarlar", (ctx) => {
  const id = ctx.from.id;
  if (!userState[id]) return;
  userState[id].roleType = "manager";
  userState[id].step = "choosing_direction";

  ctx.reply(
    "Vakansiyani tanlang:",
    Markup.keyboard([
      ["O'IBD o'rinbosari"],
      ["MMIBD o'rinbosari"],
      ["❌ Bekor qilish"],
    ]).resize(),
  );
});

// ===== MAIN FLOW (TEXT HANDLING) =====
bot.on("text", async (ctx) => {
  const id = ctx.from.id;
  const text = ctx.message.text;
  const state = userState[id];

  if (!state || state.step === "choosing_role" || text === "❌ Bekor qilish")
    return;

  // 1. Yo'nalish tanlangandan keyin
  if (state.step === "choosing_direction") {
    state.direction = text;
    state.step = "choosing_language";
    return ctx.reply(
      "🌍 Qaysi tilda dars o'ta olasiz yoki muloqot qilasiz?",
      Markup.keyboard([
        ["🇺🇿 O'zbek tili", "🇷🇺 Rus tili"],
        ["🇺🇿/🇷🇺 Ikkala tilda ham", "❌ Bekor qilish"],
      ]).resize(),
    );
  }

  // 2. Til tanlangandan keyin
  if (state.step === "choosing_language") {
    state.language = text;
    state.step = "entering_name";
    return ctx.reply(
      "👤 To'liq ism va familiyangizni kiriting.\n\nMisol: Aliyev Vali G'aniyevich",
      { parse_mode: "Markdown", reply_markup: cancelKeyboard.reply_markup },
    );
  }

  // 3. Ism kiritilgandan keyin (Telefon so'rash qismi)
  if (state.step === "entering_name") {
    if (text.length < 5)
      return ctx.reply("⚠️ Iltimos, ism familiyangizni to'liq kiriting.");
    state.fullName = text;
    state.step = "sending_phone";
    return ctx.reply(
      "📞 Telefon raqamingizni yuboring.\n\nPastdagi tugmani bosishingiz yoki raqamingizni qo'lda yozib yuborishingiz mumkin.\n\nMisol: +998901234567",
      {
        parse_mode: "Markdown",
        ...Markup.keyboard([
          [Markup.button.contactRequest("📱 Kontaktni yuborish")],
          ["❌ Bekor qilish"],
        ]).resize(),
      },
    );
  }

  // YANGI QISM: Agar foydalanuvchi raqamni qo'lda yozsa
  if (state.step === "sending_phone") {
    // O'zbekiston raqamlari uchun oddiy REGEX (998 bilan boshlanuvchi 12 ta belgi)
    const phoneRegex = /^\+?998[0-9]{9}$/;

    if (phoneRegex.test(text)) {
      state.phone = text;
      state.step = "entering_experience";
      return ctx.reply(
        "✅ Raqam qabul qilindi.\n\n📊 Necha yillik ish tajribasiga egasiz?\n\n(Masalan: 5 yoki 0)",
        { parse_mode: "Markdown", reply_markup: cancelKeyboard.reply_markup },
      );
    } else {
      return ctx.reply(
        "⚠️ Noto'g'ri format. Iltimos, raqamni +998XXXXXXXXX ko'rinishida yuboring yoki pastdagi tugmani bosing.",
      );
    }
  }

  // Eslatma: Telefon raqami 'contact' xabar turi orqali olinadi (pastga qarang)

  // 4. Tajriba kiritilgandan keyin
  if (state.step === "entering_experience") {
    const exp = parseInt(text);
    if (isNaN(exp) || exp < 0 || exp > 50) {
      return ctx.reply(
        "⚠️ Iltimos, faqat raqam kiriting (masalan: 3 yoki 0). Maksimal 50 yil.",
      );
    }
    state.experience = exp;

    if (state.roleType === "teacher" || state.roleType === "manager") {
      state.step = "entering_education";
      return ctx.reply(
        "🎓 Qaysi oliy ta'lim muassasasini bitirgansiz?\n\nMisol: Toshkent Davlat Pedagogika Universiteti",
        { parse_mode: "Markdown", reply_markup: cancelKeyboard.reply_markup },
      );
    } else {
      state.step = "entering_work_history";
      return ctx.reply(
        "🏢 Oxirgi 2 ta ish joyingiz va lavozimingizni yozing.\n\nMisol: 'Eko-maktab', oshpaz (2020-2023)",
        { parse_mode: "Markdown", reply_markup: cancelKeyboard.reply_markup },
      );
    }
  }

  // === Faqat O'qituvchi/Rahbar uchun ===
  if (state.step === "entering_education") {
    state.education = text;
    state.step = "entering_specialization";
    return ctx.reply(
      "🔬 Diplom bo'yicha mutaxassisligingiz nima?\n\nMisol: Matematika va informatika o'qituvchisi",
      { parse_mode: "Markdown", reply_markup: cancelKeyboard.reply_markup },
    );
  }

  if (state.step === "entering_specialization") {
    state.specialization = text;
    state.step = "entering_work_history";
    return ctx.reply(
      "🏢 Oldingi ish joylaringiz va lavozimingiz.\n\nMisol: 157-maktab, matematika o'qituvchisi (5 yil)",
      { parse_mode: "Markdown", reply_markup: cancelKeyboard.reply_markup },
    );
  }

  // === Barcha uchun umumiy tugash qismi ===
  if (state.step === "entering_work_history") {
    state.workHistory = text;

    if (state.roleType === "technical") {
      state.step = "entering_skills";
      return ctx.reply(
        "🛠 Qo'shimcha ko'nikmalaringiz yoki sertifikatlaringiz bormi?\n\nMisol: Kompyuter savodxonligi, haydovchilik guvohnomasi C toifa",
        { parse_mode: "Markdown", reply_markup: cancelKeyboard.reply_markup },
      );
    } else {
      return finish(ctx); // O'qituvchi/Rahbar tugatadi
    }
  }

  // === Faqat Texnik xodim uchun ===
  if (state.step === "entering_skills") {
    state.skills = text;
    return finish(ctx);
  }
});

// ===== CONTACT HANDLING (TELEFON RAQAM) =====
bot.on("contact", (ctx) => {
  const id = ctx.from.id;
  const state = userState[id];

  if (!state || state.step !== "sending_phone") {
    return ctx.reply(
      "⚠️ Iltimos, anketani ketma-ketlikda to'ldiring. /start bosing.",
    );
  }

  // Telegramdan kelgan tasdiqlangan raqam
  let phone = ctx.message.contact.phone_number;
  if (!phone.startsWith("+")) phone = "+" + phone;

  state.phone = phone;
  state.step = "entering_experience";

  // Oddiy klaviaturani qaytarish
  ctx.reply(
    `✅ Telefon raqamingiz qabul qilindi: ${phone}\n\nKeyingi savol:`,
    Markup.removeKeyboard(),
  );

  // Bir oz kutib keyingi savolni berish (UX uchun yaxshi)
  setTimeout(() => {
    ctx.reply(
      "📊 Necha yillik ish tajribasiga egasiz?\n\n(Faqat raqam kiriting, masalan: 5. Agar tajriba bo'lmasa 0 kiriting)",
      { parse_mode: "Markdown", reply_markup: cancelKeyboard.reply_markup },
    );
  }, 500);
});

// ===== FINISH & SAVE TO BOTH DB =====
async function finish(ctx) {
  const id = ctx.from.id;
  const state = userState[id];

  // 1. Kutish xabari
  const waitMsg = await ctx.reply(
    "⏳ Ariza qayta ishlanmoqda, iltimos kuting...",
    Markup.removeKeyboard(),
  );

  const now = new Date();
  const dateStr = now.toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });

  try {
    // 2. Google Sheets'ni yuklash
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0]; // O'zgaruvchi shu yerda e'lon qilindi

    // 3. Sarlavhalarni tekshirish va o'rnatish
    try {
      await sheet.loadHeaderRow();
    } catch (headerError) {
      // Agar jadval bo'sh bo'lsa, sarlavhalarni yozamiz
      await sheet.setHeaderRow([
        "Foydalanuvchi ID",
        "To'liq ism",
        "Lavozim",
        "Yo'nalish",
        "Til",
        "Telefon",
        "Tajriba (yil)",
        "O'qish joyi",
        "Mutaxassislik",
        "Oldingi ish joyi",
        "Ko'nikmalar",
        "Sana",
      ]);
    }

    // 4. Ma'lumotlarni tartiblash
    const rowData = {
      "Foydalanuvchi ID": id,
      "To'liq ism": state.fullName,
      Lavozim: roleNames[state.roleType] || state.roleType,
      "Yo'nalish": state.direction,
      Til: state.language,
      Telefon: state.phone,
      "Tajriba (yil)": state.experience,
      "O'qish joyi": state.education || "N/A",
      Mutaxassislik: state.specialization || "N/A",
      "Oldingi ish joyi": state.workHistory || "",
      "Ko'nikmalar": state.skills || "N/A",
      Sana: dateStr,
    };

    // 5. Google Sheets'ga qo'shish
    await sheet.addRow(rowData);

    // 6. Firebase'ga saqlash
    await db.collection("applications").add({
      userId: id,
      ...state,
      createdAt: now,
    });

    // 7. Adminga xabar yuborish
    const adminMsg = `
🔔 **Yangi ariza tushdi!**

👤 **Nomzod:** ${state.fullName}
💼 **Lavozim:** ${roleNames[state.roleType] || state.roleType} (${state.direction})
🌍 **Til:** ${state.language}
📞 **Telefon:** ${state.phone}
📊 **Tajriba:** ${state.experience} yil

🏢 **Ish tarixi:** ${state.workHistory || "Ko'rsatilmadi"}
🎓 **Ma'lumoti:** ${state.education || "N/A"} - ${state.specialization || "N/A"}
🛠 **Ko'nikmalar:** ${state.skills || "N/A"}
📅 **Sana:** ${dateStr}
`;

    const adminIds = process.env.ADMIN_IDS
      ? process.env.ADMIN_IDS.split(",")
      : [];

    // 3. Barcha adminlarga xabar yuborish (Loop)
    const sendNotifications = adminIds.map(async (adminId) => {
      try {
        await ctx.telegram.sendMessage(adminId.trim(), adminMsg, {
          parse_mode: "Markdown",
        });
      } catch (err) {
        console.error(`Admin ${adminId} ga xabar yetib bormadi:`, err.message);
      }
    });

    // Barcha yuborish jarayonlari tugashini kutamiz
    await Promise.all(sendNotifications);

    // 8. Yakuniy javob
    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
    await ctx.reply(
      "✅ Rahmat! Arizangiz muvaffaqiyatli qabul qilindi.\n\nTez orada mas'ul xodimlarimiz siz bilan bog'lanishadi.",
      Markup.keyboard([["/start"]]).resize(),
    );
  } catch (error) {
    console.error("Saqlashda umumiy xato:", error);
    // Xatolik haqida foydalanuvchini ogohlantirish
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
    } catch (e) {}
    await ctx.reply(
      "⚠️ Arizani saqlashda xatolik yuz berdi. Iltimos, administratorga murojaat qiling.",
    );
  } finally {
    delete userState[id];
  }
}

// ===== RUN =====
bot.launch().then(() => {
  console.log("🚀 Bot Firebase va Google Sheets bilan ishga tushdi!");
});

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
