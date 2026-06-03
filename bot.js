import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from 'firebase/app';
import { initializeFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Load Firebase Config
let db = null;
let databaseId = '';
let firebaseConfig = {};

try {
  let actualConfig = null;
  const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
  
  if (fs.existsSync(firebaseConfigPath)) {
    const rawData = fs.readFileSync(firebaseConfigPath, 'utf-8');
    firebaseConfig = JSON.parse(rawData);
    
    const rawConfig = firebaseConfig.default || firebaseConfig;
    actualConfig = {
      apiKey: rawConfig.apiKey || '',
      authDomain: rawConfig.authDomain || '',
      projectId: rawConfig.projectId || '',
      storageBucket: rawConfig.storageBucket || '',
      messagingSenderId: rawConfig.messagingSenderId || '',
      appId: rawConfig.appId || '',
      firestoreDatabaseId: rawConfig.firestoreDatabaseId || 'ai-studio-ee2f9c55-a351-47c4-b67b-4458ea90689f',
    };
    console.log('[Firebase] Loaded configuration from firebase-applet-config.json');
  } else {
    console.warn('[Firebase] Warning: firebase-applet-config.json file was not found in the root directory.');
    console.log('[Firebase] Utilizing default embedded applet credentials as a fallback...');
    actualConfig = {
      apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyDhHSSFhuwX3E3dlZW4_j3C2qUlnI4AFTE',
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'gen-lang-client-0537909860.firebaseapp.com',
      projectId: process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0537909860',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'gen-lang-client-0537909860.firebasestorage.app',
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '791915606354',
      appId: process.env.FIREBASE_APP_ID || '1:791915606354:web:2400d89cbcf8236eb00a8b',
      firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || 'ai-studio-ee2f9c55-a351-47c4-b67b-4458ea90689f',
    };
  }
  
  if (actualConfig) {
    const app = initializeApp(actualConfig);
    databaseId = actualConfig.firestoreDatabaseId;
    db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
    }, databaseId);
    console.log(`[Firebase] Connected directly to Firestore with Database ID: ${databaseId}`);
  }
} catch (error) {
  console.error('[Firebase] Error initializing App:', error);
}

// DbAdapter definition for absolute compatibility with web-app query structures
class CollectionRefWrapper {
  constructor(db, path) {
    this._db = db;
    this._path = path;
  }
  doc(docId) {
    return new DocRefWrapper(this._db, this._path, docId);
  }
  async get() {
    const fCol = collection(this._db, this._path);
    const snap = await getDocs(fCol);
    const docsList = [];
    snap.forEach(d => {
      docsList.push({
        id: d.id,
        exists: d.exists(),
        data: () => d.data()
      });
    });
    return {
      empty: snap.empty,
      forEach: (callback) => {
        docsList.forEach(callback);
      },
      docs: docsList
    };
  }
}

class DocRefWrapper {
  constructor(db, path, docId) {
    this._db = db;
    this._path = path;
    this._docId = docId;
  }
  async get() {
    const fDoc = doc(this._db, this._path, this._docId);
    const snap = await getDoc(fDoc);
    return {
      exists: snap.exists(),
      data: () => snap.data()
    };
  }
  async set(data) {
    const fDoc = doc(this._db, this._path, this._docId);
    await setDoc(fDoc, data);
  }
  async update(data) {
    const fDoc = doc(this._db, this._path, this._docId);
    await updateDoc(fDoc, data);
  }
  collection(subName) {
    return new CollectionRefWrapper(this._db, `${this._path}/${this._docId}/${subName}`);
  }
}

class DbAdapter {
  constructor(db) {
    this._db = db;
  }
  collection(colName) {
    return new CollectionRefWrapper(this._db, colName);
  }
}

const dbAdapter = db ? new DbAdapter(db) : null;

// Determine Telegram Bot Token
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || firebaseConfig.telegramBotToken;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN is not defined in either environment variables (.env) or firebase-applet-config.json.');
  process.exit(1);
}

// Initialize Telegram polling bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
console.log('🟢 Telegram Polling Bot has been successfully initialized on your computer!');

// HTML escaping helper
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Custom safe message sender equipped with automatic content splitting to avoid ETELEGRAM 400 Bad Request: message is too long errors.
async function sendSafeMessage(chatId, text, options = {}) {
  const MAX_LIMIT = 3800; // Safe threshold strictly below Telegram's 4096 character cap
  if (!text) return;

  const lines = text.split('\n');
  const chunksToSend = [];
  let currentChunk = '';

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > MAX_LIMIT) {
      if (currentChunk.trim()) {
        chunksToSend.push(currentChunk);
      }
      currentChunk = line;
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
    }
  }

  if (currentChunk.trim()) {
    chunksToSend.push(currentChunk);
  }

  // Sequentially deliver chunks to ensure ordered delivery in chat
  for (let i = 0; i < chunksToSend.length; i++) {
    const chunk = chunksToSend[i];
    const chunkOptions = { parse_mode: 'HTML', ...options };
    // Only attach keyboard reply configurations to the final segment
    if (options.reply_markup && i !== chunksToSend.length - 1) {
      delete chunkOptions.reply_markup;
    }
    
    try {
      await bot.sendMessage(chatId, chunk, chunkOptions);
    } catch (err) {
      console.error(`[Telegram] Split-sender failed at segment ${i + 1}/${chunksToSend.length}:`, err.message);
    }
  }
}

// Wrapper for editing inline message markups
async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
  const options = {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'HTML',
  };
  if (replyMarkup) {
    options.reply_markup = replyMarkup;
  }
  try {
    await bot.editMessageText(text, options);
  } catch (error) {
    console.error('[Telegram] Error editing message markup:', error.message);
  }
}

// Keyboard Layout Definitions matching cloud setup beautifully
const queryKeyboard = {
  keyboard: [
    [
      { text: 'القصص التي تحتاج لرسم' },
      { text: 'القصص بدون صوت' }
    ],
    [
      { text: 'قصص تحتاج فيديو' },
      { text: 'قصص تحتاج غلاف' }
    ],
    [
      { text: 'إزالة الضجيج من الصوت' }
    ],
    [
      { text: '➕ إضافة قصة' },
      { text: '⚙️ تحديث حالة قصة' }
    ],
    [
      { text: '📋 قصصي' },
      { text: '📊 الإحصائيات' },
      { text: 'ℹ️ المساعدة' }
    ]
  ],
  resize_keyboard: true,
  one_time_keyboard: false
};

const stageKeyboard = {
  inline_keyboard: [
    [
      { text: "✏️ رسم", callback_data: "selstage_drawing" },
      { text: "🎨 ترقية دقة", callback_data: "selstage_imageUpscaled" }
    ],
    [
      { text: "🔍 تدقيق جودة", callback_data: "selstage_imageAudited" },
      { text: "🎙️ تسجيل صوت", callback_data: "selstage_audio" }
    ],
    [
      { text: "🔇 تصفية الصوت", callback_data: "selstage_audioNoiseReduced" },
      { text: "🎬 مونتاج فيديو", callback_data: "selstage_video" }
    ],
    [
      { text: "🖼️ بوستر وغلاف", callback_data: "selstage_thumbnail" },
      { text: "📱 شورتس", callback_data: "selstage_short" }
    ],
    [
      { text: "📢 النشر والتسليم", callback_data: "selstage_published" }
    ]
  ]
};

const stageNamesAr = {
  drawing: '✏️ رسم القصة',
  imageUpscaled: '🎨 رفع دقة الصور والرسومات',
  imageAudited: '🔍 تدقيق ومراجعة جودة الصور',
  audio: '🎙️ تسجيل الصوت',
  audioNoiseReduced: '🔇 إزالة الضجيج من الصوت',
  video: '🎬 مونتاج الفيديو',
  thumbnail: '🖼️ غلاف وبروشور القصة',
  short: '📱 تصميم شورتس',
  published: '📢 النشر والتسليم النهائي'
};

// Stage Filter Listings Maker
async function showStoriesForStageUpdate(chatId, messageId, uid, stageKey, prefixMsg = '') {
  if (!dbAdapter) return;
  const storiesSnapshot = await dbAdapter.collection('users').doc(uid).collection('stories').get();
  const list = [];
  storiesSnapshot.forEach(docSnap => {
    const s = docSnap.data();
    if (!s[stageKey]) {
      list.push(s);
    }
  });

  list.sort((a, b) => (a.id || 0) - (b.id || 0));
  const stageNameAr = stageNamesAr[stageKey] || stageKey;

  if (list.length === 0) {
    const emptyMarkup = {
      inline_keyboard: [
        [{ text: "🔙 عودة للمراحل", callback_data: "back_to_stages" }]
      ]
    };
    await editTelegramMessage(
      chatId,
      messageId,
      `${prefixMsg}🎉 <b>رائع جداً! لا توجد حالياً أي قصص تحتاج إلى [${stageNameAr}].</b> كل المهام لهذه المرحلة مكتملة!`,
      emptyMarkup
    );
    return;
  }

  const inline_keyboard = [];
  const subset = list.slice(0, 10);
  subset.forEach(s => {
    inline_keyboard.push([
      {
        text: `📦 ${s.title} (ID: ${s.id})`,
        callback_data: `tgl_${s.id}_${stageKey}`
      }
    ]);
  });

  inline_keyboard.push([
    { text: "🔙 عودة للمراحل", callback_data: "back_to_stages" }
  ]);

  let contentText = prefixMsg + `⚙️ <b>القصص التي تحتاج إلى [${stageNameAr}] (${list.length} قصص معلقة):</b>\n`;
  contentText += `اضغط على أي قصة من القائمة أدناه لتعليمها كـ <b>مكتملة</b> فوراَ وتحديث لوحة التحكم:\n`;
  if (list.length > 10) {
    contentText += `\n⚠️ <i>ملاحظة: تظهر أول 10 قصص فقط لسهولة التصفح.</i>`;
  }

  await editTelegramMessage(
    chatId,
    messageId,
    contentText,
    { inline_keyboard }
  );
}

// Callback queries click triggers
async function handleTelegramCallbackQuery(callbackQuery) {
  if (!dbAdapter) return;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const data = callbackQuery.data;
  const queryId = callbackQuery.id;

  if (!chatId || !messageId || !data) return;

  try {
    const bindingDoc = await dbAdapter.collection('telegram_bindings').doc(String(chatId)).get();
    if (!bindingDoc.exists) {
      await bot.answerCallbackQuery(queryId, { text: "الرجاء ربط حسابك أولاً بالبوت.", show_alert: true });
      return;
    }
    const { uid } = bindingDoc.data() || {};
    if (!uid) {
      await bot.answerCallbackQuery(queryId, { text: "فشل تحديد حسابك المربوط.", show_alert: true });
      return;
    }

    if (data === 'back_to_stages') {
      await bot.answerCallbackQuery(queryId);
      await editTelegramMessage(
        chatId,
        messageId,
        "⚙️ <b>اختر المرحلة الإنتاجية المراد تصفيتها وتحديثها:</b>\nاختر من الأزرار أدناه لتظهر لك القصص التي تحتاج تلك المرحلة لإنجازها بضغطة زر واحدة لمنع الخطأ بالأرقام والمسميات:",
        stageKeyboard
      );
      return;
    }

    if (data.startsWith('selstage_')) {
      const stageKey = data.substring('selstage_'.length);
      await bot.answerCallbackQuery(queryId);
      await showStoriesForStageUpdate(chatId, messageId, uid, stageKey);
      return;
    }

    if (data.startsWith('tgl_')) {
      const match = data.match(/^tgl_(\d+)_(.+)$/);
      if (!match) {
        await bot.answerCallbackQuery(queryId, { text: "تنسيق غير مدعوم." });
        return;
      }
      const storyIdStr = match[1];
      const stageKey = match[2];

      const docRef = dbAdapter.collection('users').doc(uid).collection('stories').doc(storyIdStr);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        await bot.answerCallbackQuery(queryId, { text: "القصة غير موجودة.", show_alert: true });
        return;
      }

      const storyData = docSnap.data();
      const currentVal = !(!storyData?.[stageKey]);
      const newVal = !currentVal;

      await docRef.update({
        [stageKey]: newVal,
        serverSecret: 'TOTA_TELEGRAM_BOT_SECRET_2026'
      });

      const stageNameAr = stageNamesAr[stageKey] || stageKey;
      await bot.answerCallbackQuery(queryId, { text: `✅ تم إنجاز المرحلة للقصة بنجاح!` });

      await showStoriesForStageUpdate(chatId, messageId, uid, stageKey, `🔄 <b>تم بنجاح إنجاز [${stageNameAr}] لـ "${storyData?.title}"!</b>\n\n`);
      return;
    }

  } catch (err) {
    console.error('[Telegram Callback Error]:', err);
    try {
      await bot.answerCallbackQuery(queryId, { text: "حدث خطأ غير متوقع.", show_alert: true });
    } catch (_) {}
  }
}

// Inbound text commands matching
async function handleTelegramCommand(chatId, text, fromUser = {}) {
  if (!dbAdapter) {
    await sendSafeMessage(chatId, "⚠️ <b>النظام غير متصل بقاعدة البيانات في الوقت الحالي.</b> من فضلك أعد المحاولة لاحقاً.", { reply_markup: queryKeyboard });
    return;
  }

  const username = fromUser.username || '';
  const firstName = fromUser.first_name || '';
  const lastName = fromUser.last_name || '';
  const trimmedText = text.trim();

  // Command A: /start [UID]
  const startMatch = trimmedText.match(/^\/start\s+([A-Za-z0-9_\-]+)\s*$/);
  if (startMatch) {
    const uid = startMatch[1];
    try {
      await dbAdapter.collection('telegram_bindings').doc(String(chatId)).set({
        uid,
        username: username || '',
        firstName: firstName || '',
        lastName: lastName || '',
        linkedAt: new Date().toISOString(),
      });
      
      const welcomeBack = `🎉 <b>تم ربط حساب تيليجرام الخاص بك بنجاح!</b>
      
👤 الحساب المربوط: <code>${uid}</code>
اسم المستخدم: @${username || 'بلا'}

يمكنك الآن إدارة ومتابعة إنتاج القصص المخصصة لحسابك مباشرة وتحديث المراحل الـ 9 بسرعة وبمنتهى الكفاءة.

💡 <b>أبرز الأوامر التي يمكنك تجربتها الآن:</b>
🔹 <code>/stories</code> - لعرض كافة قصصك وتفاصيل إنتاجها الحالية.
🔹 <code>/stats</code> - لمعرفة كفاءة الإنتاج وسير العمل العام.
🔹 <code>/add &lt;عنوان القصة&gt;</code> - لإضافة قصة جديدة بسرعة.
🔹 <code>/update &lt;المعرّف&gt; &lt;المرحلة&gt;</code> - لتفعيل/تعطيل إحدى مراحل الإنتاج. @${username}`;
      await sendSafeMessage(chatId, welcomeBack, { reply_markup: queryKeyboard });
    } catch (e) {
      console.error('[Telegram Start Error]:', e);
      const errMsg = e instanceof Error ? e.message : 'خطأ غير معروف';
      await sendSafeMessage(chatId, `❌ <b>فشل ربط الحساب.</b> تفاصيل الخطأ: <code>${escapeHtml(errMsg)}</code>`, { reply_markup: queryKeyboard });
    }
    return;
  }

  if (trimmedText === '/start' || trimmedText === '/help' || trimmedText === 'مساعدة' || trimmedText === 'ℹ️ المساعدة') {
    const helpMessage = `👋 <b>أهلاً بك في بوت إدارة إنتاج قصص الأطفال!</b>

هذا البوت يساعدك على التحكم وتتبع المراحل التسعة لإنتاج القصص المصورة والمسجلة وصانعي شورتس وتصدير النشر مباشرة وبشكل متكامل مع لوحة التحكم للتطبيق.

⚙️ <b>خطوات ربط البوت بحسابك الموحد:</b>
1️⃣ توجه إلى التطبيق في نسخته بالويب.
2️⃣ انسخ <b>رمز الربط (UID)</b> الموضح أسفل بطاقة "تكامل تيليجرام" (بعد تسجيل دخولك بجوجل).
3️⃣ أرسل الأمر التالي هنا:
<code>/start &lt;رمز_الربط&gt;</code> <i>(مثال: <code>/start xyz123</code> )</i>

📋 <b>الأوامر والاستعلامات المتاحة بعد الربط:</b>
🔹 <code>/stories</code> - لعرض قائمة قصصك الحالية وتفاصيل مراحلها.
🔹 <code>/stats</code> - لمعاينة كفاءة العمليات وجدول كميات المراحل.
🔹 <code>/add اسم القصة - السلسلة - البطل - القيمة الأخلاقية</code> - لإضافة قصة جديدة بكامل بياناتها (أو اكتب فقط <code>/add عنوان القصة</code>).
🔹 <code>اسم القصة - المرحلة</code> - لتحديث حالة قصة وإنجازها مباشرة بمجرد كتابتها! (مثال: <code>قصة عمر والفأر - رسم</code>).
🔹 <code>/update &lt;المعرّف&gt; &lt;المرحلة&gt;</code> - لتبديل حالة الإنجاز بدلالة معرف القصة والمرحلة.

🔍 <b>روابط الاستعلامات السريعة (اضغط للمعاينة):</b>
✏️ <code>القصص التي تحتاج لرسم</code>
🎙️ <code>القصص بدون صوت</code>
🎬 <code>قصص تحتاج فيديو</code>
🖼️ <code>قصص تحتاج غلاف</code>
🎨 <code>رفع دقة الصور والرسومات</code>
🔍 <code>تدقيق ومراجعة جودة الصور</code>
🔇 <code>إزالة الضجيج من الصوت</code>

<i>المراحل المدعومة للاستخدام والتحديث:</i> <code>رسم</code> | <code>ترقية</code> | <code>تدقيق</code> | <code>صوت</code> | <code>تصفية</code> | <code>فيديو</code> | <code>غلاف</code> | <code>شورتس</code> | <code>نشر</code>`;
    await sendSafeMessage(chatId, helpMessage, { reply_markup: queryKeyboard });
    return;
  }

  // Bind lookup required
  try {
    const bindingDoc = await dbAdapter.collection('telegram_bindings').doc(String(chatId)).get();
    if (!bindingDoc.exists) {
      await sendSafeMessage(chatId, `⚠️ <b>أنت لم تقم بربط حسابك مع البوت حتى الآن.</b>

الرجاء التوجه للوحة ويب التطبيق ثم نسخ <b>كود UID</b> الخاص بك وإرساله هنا كالتالي لتهيئة التزامن:
<code>/start &lt;رمز_UID_الخاص_بك&gt;</code>`, { reply_markup: queryKeyboard });
      return;
    }

    const { uid } = bindingDoc.data() || {};
    if (!uid) {
      await sendSafeMessage(chatId, "⚠️ <b>فشل استرجاع بيانات حسابك المربوط.</b> نرجو إعادة الربط.", { reply_markup: queryKeyboard });
      return;
    }

    if (trimmedText === '➕ إضافة قصة' || trimmedText === 'إضافة قصة') {
      const templateMsg = `➕ <b>إضافة قصة جديدة للمخطط:</b>
      
لطفاً انسخ النص بالصيغة أدناه، عدّله، ثم أرسله مباشرة لإضافة القصة بمخطط الإنتاج فوراَ:

<code>/add اسم القصة الجديدة - اسم السلسلة - اسم البطل - القيمة الأخلاقية</code>

<i>مثال جاهز للنسخ الفوري والتعديل:</i>
<code>/add قصة الأرنب الشجاع - حكايات السلسلة الخضراء - أرنوب - الشجاعة وعدم الاستلام</code>`;
      await sendSafeMessage(chatId, templateMsg, { reply_markup: queryKeyboard });
      return;
    }

    if (trimmedText === '⚙️ تحديث حالة قصة' || trimmedText === 'تحديث حالة قصة' || trimmedText === 'تحديث') {
      await sendSafeMessage(
        chatId, 
        "⚙️ <b>اختر المرحلة الإنتاجية المراد تصفيتها وتحديثها:</b>\nاختر من الأزرار أدناه لتظهر لك القصص التي تحتاج تلك المرحلة لإنجازها بضغطة زر واحدة لمنع الخطأ بالأرقام والمسميات:",
        { reply_markup: stageKeyboard }
      );
      return;
    }

    // Command B: /stories
    if (trimmedText === '/stories' || trimmedText === 'القصص' || trimmedText === 'قصص' || trimmedText === '📋 قصصي' || trimmedText === 'قصصي') {
      const storiesSnapshot = await dbAdapter.collection('users').doc(uid).collection('stories').get();
      if (storiesSnapshot.empty) {
        await sendSafeMessage(chatId, "📭 <b>لا توجد أي قصص في بروفايلك حالياً.</b> تفضل بإضافة واحدة باستخدام الويب أو بكتابة الأمر <code>/add عنوان_القصة</code>.", { reply_markup: queryKeyboard });
        return;
      }

      const list = [];
      storiesSnapshot.forEach(docSnap => list.push(docSnap.data()));
      list.sort((a, b) => (a.id || 0) - (b.id || 0));

      let content = `📋 <b>قائمة القصص الحالية (${list.length} قصص):</b>\n\n`;
      const chunk = list.slice(0, 150); // Safe high limit because automatic message splitting handles large text safely
      
      chunk.forEach((s) => {
        const drawingEm = s.drawing ? '✅' : '❌';
        const upscaleEm = s.imageUpscaled ? '✅' : '❌';
        const auditEm = s.imageAudited ? '✅' : '❌';
        const audioEm = s.audio ? '✅' : '❌';
        const noiseEm = s.audioNoiseReduced ? '✅' : '❌';
        const videoEm = s.video ? '✅' : '❌';
        const thumbEm = s.thumbnail ? '✅' : '❌';
        const shortEm = s.short ? '✅' : '❌';
        const pubEm = s.published ? '✅' : '❌';

        content += `🆔 <b>ID: ${s.id}</b> | ${s.title}\n`;
        content += `🌀 <i>${s.series}</i> • البطل: ${s.hero || '-'}\n`;
        content += `💻 <b>المراحل التسعة:</b>\n`;
        content += `  ✏️ رسم: ${drawingEm} | 🎨 ترقية: ${upscaleEm} | 🔍 تدقيق: ${auditEm}\n`;
        content += `  🎙️ صوت: ${audioEm} | 🔇 تصفية: ${noiseEm} | 🎬 فيديو: ${videoEm}\n`;
        content += `  🖼️ غلاف: ${thumbEm} | 📱 شورتس: ${shortEm} | 📢 نشر: ${pubEm}\n`;
        content += `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`;
      });

      if (list.length > 150) {
        content += `⚠️ <i>تنويه: تم عرض أول 150 قصة فقط من أصل ${list.length}. تصفح الباقي بلوحة التحكم الرئيسية.</i>`;
      }
      await sendSafeMessage(chatId, content, { reply_markup: queryKeyboard });
      return;
    }

    // Command C: /stats
    if (trimmedText === '/stats' || trimmedText === 'إحصائيات' || trimmedText === 'الإحصائيات' || trimmedText === '📊 الإحصائيات') {
      const storiesSnapshot = await dbAdapter.collection('users').doc(uid).collection('stories').get();
      if (storiesSnapshot.empty) {
        await sendSafeMessage(chatId, "📭 <b>لا توجد قصص بالملف لحساب وتلخيص المؤشرات الكلية.</b>", { reply_markup: queryKeyboard });
        return;
      }

      const storiesList = [];
      storiesSnapshot.forEach(docSnap => storiesList.push(docSnap.data()));

      let drawing = 0, upscale = 0, audit = 0, audio = 0, noise = 0, video = 0, thumb = 0, short = 0, pub = 0;
      storiesList.forEach(s => {
        if (s.drawing) drawing++;
        if (s.imageUpscaled) upscale++;
        if (s.imageAudited) audit++;
        if (s.audio) audio++;
        if (s.audioNoiseReduced) noise++;
        if (s.video) video++;
        if (s.thumbnail) thumb++;
        if (s.short) short++;
        if (s.published) pub++;
      });
      const total = storiesList.length;
      const overallPct = total > 0 ? Math.round(((drawing + upscale + audit + audio + noise + video + thumb + short + pub) / (total * 9)) * 100) : 0;

      let statsTxt = `📊 <b>مؤشرات كفاءة الإنتاج الشاملة (تيليجرام):</b>\n\n`;
      statsTxt += `📦 <b>إجمالي عدد القصص:</b> ${total} قصص\n`;
      statsTxt += `⚡ <b>كفاءة سير العمليات الكلية:</b> <code>${overallPct}%</code>\n\n`;
      statsTxt += `📈 <b>تفاصيل إنجاز المراحل التسعة:</b>\n`;
      statsTxt += `✏️ الرسم الكلي: ${drawing}/${total} (${total ? Math.round(drawing/total*100) : 0}%)\n`;
      statsTxt += `🎨 ترقية الصور: ${upscale}/${total} (${total ? Math.round(upscale/total*100) : 0}%)\n`;
      statsTxt += `🔍 تدقيق الجودة: ${audit}/${total} (${total ? Math.round(audit/total*100) : 0}%)\n`;
      statsTxt += `🎙️ تسجيل الصوت: ${audio}/${total} (${total ? Math.round(audio/total*100) : 0}%)\n`;
      statsTxt += `🔇 تصفية الصوت: ${noise}/${total} (${total ? Math.round(noise/total*100) : 0}%)\n`;
      statsTxt += `🎬 مونتاج الفيديو: ${video}/${total} (${total ? Math.round(video/total*100) : 0}%)\n`;
      statsTxt += `🖼️ غلاف القصة: ${thumb}/${total} (${total ? Math.round(thumb/total*100) : 0}%)\n`;
      statsTxt += `📱 تصميم شورتس: ${short}/${total} (${total ? Math.round(short/total*100) : 0}%)\n`;
      statsTxt += `📢 النشر والتسليم: ${pub}/${total} (${total ? Math.round(pub/total*100) : 0}%)\n\n`;
      statsTxt += `📈 <i>البيانات متطابقة كلياً وبشكل لحظي مع موقع التطبيق الرئيسي.</i>`;

      await sendSafeMessage(chatId, statsTxt, { reply_markup: queryKeyboard });
      return;
    }

    // Command D: /add <Title - Series - Hero - Moral>
    const addMatch = trimmedText.match(/^\/add\s+(.+)$/);
    if (addMatch) {
      const rawAddText = addMatch[1].trim();
      const parts = rawAddText.split(/\s*[-—|،]\s*/).map(p => p.trim());
      
      const title = parts[0] || "قصة جديدة";
      const series = parts[1] || "بدون سلسلة";
      const hero = parts[2] || "-";
      const moral = parts[3] || "-";
      
      const storiesSnapshot = await dbAdapter.collection('users').doc(uid).collection('stories').get();
      let maxId = 100;
      storiesSnapshot.forEach(docSnap => {
        const sid = Number(docSnap.id);
        if (!isNaN(sid) && sid > maxId) {
          maxId = sid;
        }
      });
      const newId = maxId + 1;

      const newStory = {
        id: newId,
        title: title,
        series: series,
        hero: hero,
        moral: moral,
        drawing: false,
        imageUpscaled: false,
        imageAudited: false,
        audio: false,
        audioNoiseReduced: false,
        video: false,
        thumbnail: false,
        short: false,
        published: false,
        dueDate: '',
        driveLink: '',
        serverSecret: 'TOTA_TELEGRAM_BOT_SECRET_2026',
      };

      await dbAdapter.collection('users').doc(uid).collection('stories').doc(String(newId)).set(newStory);
      
      let responseMsg = `✅ <b>تم إضافة القصة الجديدة للمخطط بنجاح!</b>\n\n`;
      responseMsg += `🆔 <b>المعرّف (ID):</b> <code>${newId}</code>\n`;
      responseMsg += `📝 <b>اسم القصة:</b> <b>${title}</b>\n`;
      responseMsg += `🌀 <b>السلسلة:</b> <i>${series}</i>\n`;
      responseMsg += `🦸 <b>البطل:</b> <code>${hero}</code>\n`;
      responseMsg += `✨ <b>القيمة الأخلاقية:</b> <code>${moral}</code>\n\n`;
      responseMsg += `🔧 <i>بإمكانك تتبع وتحديث مراحل العمل والتصفية بسهولة عبر كود التحديث المباشر:</i>\n`;
      responseMsg += `<code>/update ${newId} رسم</code>`;
      
      await sendSafeMessage(chatId, responseMsg, { reply_markup: queryKeyboard });
      return;
    }

    // Command E: /update <ID> <Stage>
    const updateMatch = trimmedText.match(/^\/update\s+(\d+)\s+(.+)$/);
    if (updateMatch) {
      const storyIdStr = updateMatch[1];
      const rawStage = updateMatch[2].trim().toLowerCase();

      let stageKey = null;
      if (['drawing', 'رسم', 'الرسم'].includes(rawStage)) stageKey = 'drawing';
      else if (['upscale', 'ترقية', 'الترقية', 'upscaled', 'imageupscaled'].includes(rawStage)) stageKey = 'imageUpscaled';
      else if (['audit', 'تدقيق', 'التدقيق', 'audited', 'imageaudited'].includes(rawStage)) stageKey = 'imageAudited';
      else if (['audio', 'صوت', 'الصوت'].includes(rawStage)) stageKey = 'audio';
      else if (['noise', 'تصفية', 'التصفية', 'noise-reduction', 'audio_noise_reduced', 'audionoisereduced'].includes(rawStage)) stageKey = 'audioNoiseReduced';
      else if (['video', 'فيديو', 'الفيديو', 'مونتاج', 'المونتاج'].includes(rawStage)) stageKey = 'video';
      else if (['thumb', 'thumbnail', 'غلاف', 'الغلاف'].includes(rawStage)) stageKey = 'thumbnail';
      else if (['short', 'شورتس', 'الشورتس'].includes(rawStage)) stageKey = 'short';
      else if (['published', 'publish', 'نشر', 'النشر', 'تسليم'].includes(rawStage)) stageKey = 'published';

      if (!stageKey) {
        await sendSafeMessage(chatId, "⚠️ <b>اسم المرحلة غير صحيح!</b>\nالرجاء كتابة إحدى المراحل التسعة:\n<code>رسم</code> | <code>ترقية</code> | <code>تدقيق</code> | <code>صوت</code> | <code>تصفية</code> | <code>فيديو</code> | <code>غلاف</code> | <code>شورتس</code> | <code>نشر</code>\n\nمثال: <code>/update 102 صوت</code>", { reply_markup: queryKeyboard });
        return;
      }

      const docRef = dbAdapter.collection('users').doc(uid).collection('stories').doc(storyIdStr);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        await sendSafeMessage(chatId, `⚠️ <b>لم يتم العثور على قصة بالمعرف ${storyIdStr} في حسابك.</b> أرسل أمر <code>/stories</code> للمعاينة.`, { reply_markup: queryKeyboard });
        return;
      }

      const currentStory = docSnap.data();
      const oldVal = !(!currentStory?.[stageKey]);
      const newVal = !oldVal;

      await docRef.update({
        [stageKey]: newVal,
        serverSecret: 'TOTA_TELEGRAM_BOT_SECRET_2026'
      });

      const stageNameArMapped = {
        drawing: '✏️ الرسم المكتمل',
        imageUpscaled: '🎨 ترقية الصور',
        imageAudited: '🔍 تدقيق الصور',
        audio: '🎙️ تسجيل الصوت',
        audioNoiseReduced: '🔇 تصفية الصوت والضجيج',
        video: '🎬 المونتاج المرئي',
        thumbnail: '🖼️ غلاف القصة',
        short: '📱 تصميم شورتس',
        published: '📢 النشر والتسليم'
      }[stageKey];

      const stateText = newVal ? "<b>✅ مكتملة</b>" : "<b>❌ غير مكتملة</b>";
      await sendSafeMessage(chatId, `🔄 <b>تم تحديث حالة القصة عبر تيليجرام بنجاح!</b>\n\n📦 القصة: <b>${currentStory?.title}</b> (ID: ${storyIdStr})\n⚙️ المرحلة المحدثة: <i>${stageNameArMapped}</i>\n📊 الحالة الجديدة: ${stateText}`, { reply_markup: queryKeyboard });
      return;
    }

    // Command F: Quick Status queries
    let isQuery = false;
    let queryField = '';
    let queryTitleAr = '';

    const normalizedLower = trimmedText.toLowerCase();

    if (normalizedLower === '/need_drawing' || trimmedText === 'القصص التي تحتاج لرسم' || trimmedText === 'تحتاج رسم' || trimmedText === 'رسم معلق') {
      isQuery = true;
      queryField = 'drawing';
      queryTitleAr = 'القصص التي تحتاج لرسم';
    } else if (normalizedLower === '/no_audio' || trimmedText === 'القصص بدون صوت' || trimmedText === 'بدون صوت' || trimmedText === 'صوت معلق') {
      isQuery = true;
      queryField = 'audio';
      queryTitleAr = 'القصص بدون صوت';
    } else if (normalizedLower === '/need_video' || trimmedText === 'قصص تحتاج فيديو' || trimmedText === 'تحتاج فيديو' || trimmedText === 'فيديو معلق') {
      isQuery = true;
      queryField = 'video';
      queryTitleAr = 'قصص تحتاج فيديو والمونتاج';
    } else if (normalizedLower === '/need_cover' || trimmedText === 'قصص تحتاج غلاف' || trimmedText === 'تحتاج غلاف' || trimmedText === 'بدون غلاف') {
      isQuery = true;
      queryField = 'thumbnail';
      queryTitleAr = 'قصص تحتاج غلاف وبوستر';
    } else if (normalizedLower === '/image_upscaling' || trimmedText === 'رفع دقة الصور والرسومات' || trimmedText === 'رفع دقة الصور' || trimmedText === 'رفع دقة' || trimmedText === 'تحتاج ترقية') {
      isQuery = true;
      queryField = 'imageUpscaled';
      queryTitleAr = 'قصص تحتاج رفع دقة الصور والرسومات';
    } else if (normalizedLower === '/image_auditing' || trimmedText === 'تدقيق ومراجعة جودة الصور' || trimmedText === 'تدقيق ومراجعة' || trimmedText === 'تدقيق الصور' || trimmedText === 'تحتاج تدقيق') {
      isQuery = true;
      queryField = 'imageAudited';
      queryTitleAr = 'قصص تحتاج تدقيق ومراجعة جودة الصور';
    } else if (normalizedLower === '/audio_denoising' || trimmedText === 'إزالة الضجيج من الصوت' || trimmedText === 'إزالة الضجيج' || trimmedText === 'إزالة ضجيج' || trimmedText === 'تحتاج تصفية') {
      isQuery = true;
      queryField = 'audioNoiseReduced';
      queryTitleAr = 'قصص تحتاج إزالة الضجيج وتصفية الصوت';
    }

    if (isQuery) {
      const storiesSnapshot = await dbAdapter.collection('users').doc(uid).collection('stories').get();
      const list = [];
      storiesSnapshot.forEach(docSnap => {
        const s = docSnap.data();
        if (!s[queryField]) {
          list.push(s);
        }
      });
      list.sort((a, b) => (a.id || 0) - (b.id || 0));

      if (list.length === 0) {
        await sendSafeMessage(chatId, `🎉 <b>رائع جداً! لا توجد حالياً أي قصص تحت قائمة:</b> "${queryTitleAr}". كل المهام مكتملة ومسواة بنسبة 100%!`, { reply_markup: queryKeyboard });
        return;
      }

      let content = `📋 <b>[${queryTitleAr}] (${list.length} قصص تحتاج عمل وبث):</b>\n\n`;
      const chunk = list.slice(0, 100);
      chunk.forEach((s) => {
        content += `🆔 <b>ID: ${s.id}</b> | <b>${s.title}</b>\n`;
        content += `🌀 <i>${s.series}</i> • البطل: ${s.hero || '-'} • القيمة: ${s.moral || '-'}\n`;
        content += `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`;
      });

      if (list.length > 100) {
        content += `⚠️ <i>تنويه: تم عرض أول 100 قصة فقط للوضوح وتجنب الإطالة.</i>`;
      }
      await sendSafeMessage(chatId, content, { reply_markup: queryKeyboard });
      return;
    }

    // Command G: Natural Text Update Match: "Title - Stage" / "قصة عمر والفأر - رسم"
    if (!trimmedText.startsWith('/') && (trimmedText.includes('-') || trimmedText.includes('—') || trimmedText.includes('،') || trimmedText.includes('|'))) {
      const pDivider = trimmedText.includes('-') ? '-' : (trimmedText.includes('—') ? '—' : (trimmedText.includes('،') ? '،' : '|'));
      const parts = trimmedText.split(pDivider).map(p => p.trim());
      
      if (parts.length === 2 && parts[0] && parts[1]) {
        const lookupTitle = parts[0].toLowerCase();
        const rawStage = parts[1].toLowerCase();

        let stageKey = null;
        if (['drawing', 'رسم', 'الرسم'].includes(rawStage)) stageKey = 'drawing';
        else if (['upscale', 'ترقية', 'الترقية', 'upscaled', 'imageupscaled'].includes(rawStage)) stageKey = 'imageUpscaled';
        else if (['audit', 'تدقيق', 'التدقيق', 'audited', 'imageaudited'].includes(rawStage)) stageKey = 'imageAudited';
        else if (['audio', 'صوت', 'الصوت'].includes(rawStage)) stageKey = 'audio';
        else if (['noise', 'تصفية', 'التصفية', 'noise-reduction', 'audio_noise_reduced', 'audionoisereduced'].includes(rawStage)) stageKey = 'audioNoiseReduced';
        else if (['video', 'فيديو', 'الفيديو', 'مونتاج', 'المونتاج'].includes(rawStage)) stageKey = 'video';
        else if (['thumb', 'thumbnail', 'غلاف', 'الغلاف'].includes(rawStage)) stageKey = 'thumbnail';
        else if (['short', 'شورتس', 'الشورتس'].includes(rawStage)) stageKey = 'short';
        else if (['published', 'publish', 'نشر', 'النشر', 'تسليم'].includes(rawStage)) stageKey = 'published';

        if (stageKey) {
          const storiesSnapshot = await dbAdapter.collection('users').doc(uid).collection('stories').get();
          let matchedStory = null;
          
          storiesSnapshot.forEach(docSnap => {
            const s = docSnap.data();
            const sTitleLower = (s.title || '').toLowerCase();
            if (sTitleLower === lookupTitle || sTitleLower.includes(lookupTitle)) {
              matchedStory = s;
            }
          });

          if (matchedStory) {
            const docRef = dbAdapter.collection('users').doc(uid).collection('stories').doc(String(matchedStory.id));
            const oldVal = !(!matchedStory[stageKey]);
            const newVal = !oldVal;

            await docRef.update({
              [stageKey]: newVal,
              serverSecret: 'TOTA_TELEGRAM_BOT_SECRET_2026'
            });

            const stageNameArMapped = {
              drawing: '✏️ الرسم المكتمل',
              imageUpscaled: '🎨 ترقية الصور',
              imageAudited: '🔍 تدقيق الصور',
              audio: '🎙️ تسجيل الصوت',
              audioNoiseReduced: '🔇 تصفية الصوت والضجيج',
              video: '🎬 المونتاج المرئي',
              thumbnail: '🖼️ غلاف القصة',
              short: '📱 تصميم شورتس',
              published: '📢 النشر والتسليم'
            }[stageKey];

            const stateText = newVal ? "<b>✅ مكتملة</b>" : "<b>❌ غير مكتملة</b>";
            await sendSafeMessage(chatId, `🔄 <b>تم العثور على القصة وتحديثها بنجاح!</b>\n\n📦 القصة: <b>${matchedStory.title}</b> (ID: ${matchedStory.id})\n⚙️ المرحلة المحدثة: <i>${stageNameArMapped}</i>\n📊 الحالة الجديدة: ${stateText}`, { reply_markup: queryKeyboard });
            return;
          } else {
            await sendSafeMessage(chatId, `🔍 <b>عذراً، لم نتمكن من العثور على أي قصة تطابق الاسم:</b> "${parts[0]}"\nتأكد من كتابة الاسم بدقة أو استخدم معرف رقمي بـ <code>/update ID المرحلة</code>`, { reply_markup: queryKeyboard });
            return;
          }
        }
      }
    }

  } catch (err) {
    console.error('[Telegram Command Error]:', err);
    await sendSafeMessage(chatId, `❌ حدث خطأ داخلي أثناء معالجة الأمر: <code>${escapeHtml(err.message)}</code>`, { reply_markup: queryKeyboard });
  }
}

// Attach listeners
bot.on('message', async (msg) => {
  if (!msg.text) return;
  await handleTelegramCommand(msg.chat.id, msg.text, msg.from || {});
});

bot.on('callback_query', async (callbackQuery) => {
  await handleTelegramCallbackQuery(callbackQuery);
});

console.log('🚀 Local Telegram Bot is fully operational and listening to commands! Feel free to talk to it. Press Ctrl+C to terminate.');
