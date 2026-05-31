const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, collection, getDoc, getDocs, setDoc, addDoc } = require('firebase/firestore');
require('dotenv').config();

// 1. تهيئة قاعدة بيانات Firestore السحابية
// ستأتي بهذه القيم من ملف firebase-applet-config.json المتواجد في تطبيقك
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const databaseId = process.env.FIREBASE_DATABASE_ID || '';

// 2. تهيئة بوت تليجرام (وضع التحديث التلقائي Polling المستمر وسهل الإعداد في الخوادم المستقلة)
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

console.log('🤖 البوت السحابي المستقل يعمل الآن بنشاط على مدار الساعة...');

// دالة لمعالجة النصوص وتجنيب حقن الرموز
function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// دالة لتعديل الرموز التعبيرية بحسب حالة تفعيل مراحل القصص التسعة
function getStageStatusEmoji(status) {
  return status ? '🟢' : '⚪';
}

// 3. معالجة أوامر تليجرام
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';
  const username = msg.from.username || '';
  const firstName = msg.from.first_name || '';
  const lastName = msg.from.last_name || '';

  // أ. أمر البداية والتفويض /start [UID]
  const startMatch = text.match(/^\/start\s+([A-Za-z0-9_\-]+)\s*$/);
  if (startMatch) {
    const uid = startMatch[1];
    try {
      // ربط معرّف المحادثة بتليجرام بـ Firebase UID
      await setDoc(doc(db, 'telegram_bindings', String(chatId)), {
        uid,
        username,
        firstName,
        lastName,
        linkedAt: new Date().toISOString()
      });

      const successMsg = `🎉 <b>تم ربط حسابك السحابي بنجاح!</b>\n\n👤 الرمز التعريفي: <code>${uid}</code>\n\nيمكنك الآن التحكم وإدارة المراحل التسعة لقصصك مباشرة من تليجرام!\n\n📋 <b>جرب أحد الأوامر التالية:</b>\n🔹 <code>/stories</code> - لعرض قصصك ومراحل إنتاجها\n🔹 <code>/stats</code> - لعرض الإحصائيات العامة`;
      bot.sendMessage(chatId, successMsg, { parse_mode: 'HTML' });
    } catch (err) {
      bot.sendMessage(chatId, `❌ حدث خطأ أثناء الربط: <code>${err.message}</code>`, { parse_mode: 'HTML' });
    }
    return;
  }

  // ب. المساعدة والدعم
  if (text === '/start' || text === '/help' || text === 'مساعدة') {
    const helpMsg = `👋 <b>أهلاً بك في البوت السحابي لإدارة إنتاج القصص!</b>\n\nلتفعيل البوت:\n1️⃣ توجه للوحة التحكم بالويب وانسخ رمز (UID) الخاص بك.\n2️⃣ أرسل الأمر هنا بالتنسيق التالي:\n<code>/start &lt;رمز_UID&gt;</code>`;
    bot.sendMessage(chatId, helpMsg, { parse_mode: 'HTML' });
    return;
  }

  // ج. التحقق من الربط لتنفيذ بقية الأوامر
  let uid = '';
  try {
    const bindingDoc = await getDoc(doc(db, 'telegram_bindings', String(chatId)));
    if (!bindingDoc.exists()) {
      bot.sendMessage(chatId, `⚠️ <b>عذراً! حسابك غير مربوط بعد.</b>\nيرجى إرسال الرمز التعريفي بالصيغة التالية:\n<code>/start &lt;UID&gt;</code>`, { parse_mode: 'HTML' });
      return;
    }
    uid = bindingDoc.data().uid;
  } catch (err) {
    bot.sendMessage(chatId, `⚠️ فشل التحقق من الحساب: ${err.message}`);
    return;
  }

  // د. أمر عرض قائمة القصص /stories
  if (text === '/stories' || text === 'القصص' || text === '📋 قصصي') {
    try {
      const storiesSnap = await getDocs(collection(db, 'users', uid, 'stories'));
      if (storiesSnap.empty) {
        bot.sendMessage(chatId, '📭 لا توجد قصص مضافة في مخططك حالياً.');
        return;
      }

      let response = `📋 <b>قائمة قصصك الحالية سير إنتاجها:</b>\n\n`;
      storiesSnap.forEach((d) => {
        const story = d.data();
        response += `🔸 <b>${escapeHtml(story.title || 'بلا عنوان')}</b> (ID: <code>${d.id}</code>)\n`;
        response += `├─ 🎨 رسم: ${getStageStatusEmoji(story.drawing)} | 🎙️ صوت: ${getStageStatusEmoji(story.audio)}\n`;
        response += `└─ 🎬 فيديو: ${getStageStatusEmoji(story.video)} | 🖼️ غلاف: ${getStageStatusEmoji(story.cover)}\n\n`;
      });
      bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
    } catch (err) {
      bot.sendMessage(chatId, `❌ خطأ في جلب البيانات: ${err.message}`);
    }
    return;
  }

  // هـ. أمر الاستعلام عن الإحصائيات /stats
  if (text === '/stats' || text === 'الإحصائيات') {
    try {
      const storiesSnap = await getDocs(collection(db, 'users', uid, 'stories'));
      let total = 0, drawingCount = 0, audioCount = 0, videoCount = 0, publishedCount = 0;
      storiesSnap.forEach((d) => {
        total++;
        const s = d.data();
        if (s.drawing) drawingCount++;
        if (s.audio) audioCount++;
        if (s.video) videoCount++;
        if (s.published) publishedCount++;
      });

      const statsMsg = `📊 <b>إحصائيات مراحل إنتاج قصصك:</b>\n\n` +
                       `📦 إجمالي القصص: <b>${total}</b>\n` +
                       `🎨 المكتمل رسوماتها: <b>${drawingCount}</b>\n` +
                       `🎙️ المسجل صوتياً: <b>${audioCount}</b>\n` +
                       `🎬 المنتجة كفيديو: <b>${videoCount}</b>\n` +
                       `✅ المنشورة نهائياً: <b>${publishedCount}</b>`;
      bot.sendMessage(chatId, statsMsg, { parse_mode: 'HTML' });
    } catch (err) {
      bot.sendMessage(chatId, `❌ خطأ في جلب الإحصائيات: ${err.message}`);
    }
    return;
  }

  // و. إضافة قصة جديدة /add
  if (text.startsWith('/add ')) {
    const storyTitle = text.substring(5).trim();
    if (!storyTitle) {
      bot.sendMessage(chatId, '⚠️ الرجاء تحديد عنوان القصة. مثال: <code>/add قصة المغامر الصغير</code>', { parse_mode: 'HTML' });
      return;
    }
    try {
      const newStory = {
        title: storyTitle,
        drawing: false,
        upgrade: false,
        audit: false,
        audio: false,
        noiseRemoval: false,
        video: false,
        cover: false,
        shorts: false,
        published: false,
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'users', uid, 'stories'), newStory);
      bot.sendMessage(chatId, `✅ تم بنجاح إضافة القصة الجديدة <b>"${storyTitle}"</b> إلى قائمة أعمالك! وتزامنها مع الويب على الفور.`, { parse_mode: 'HTML' });
    } catch (err) {
      bot.sendMessage(chatId, `❌ فشل إضافة القصة: ${err.message}`);
    }
    return;
  }
});