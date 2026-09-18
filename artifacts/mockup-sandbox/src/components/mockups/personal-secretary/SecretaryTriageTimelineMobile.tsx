import {
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Inbox,
  LayoutList,
  MessageCircle,
  Mic,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings2,
  Sparkles,
  TimerReset,
  WalletCards,
  X,
} from "lucide-react";
import { useState } from "react";

type ViewMode = "focus" | "records";
type QueueId = "expense" | "call" | "file";

type TimelineItem = {
  id: QueueId;
  eyebrow: string;
  title: string;
  detail: string;
  meta: string;
  tone: "sun" | "sky" | "leaf";
  icon: typeof WalletCards;
};

type ChatLine = {
  id: number;
  role: "assistant" | "user";
  text: string;
};

const queue: TimelineItem[] = [
  {
    id: "expense",
    eyebrow: "يحتاج قرارك · مصروف",
    title: "غداء العمل مع محمود",
    detail: "١٬٢٥٠ ج.م",
    meta: "أضيف قبل ساعتين",
    tone: "sun",
    icon: WalletCards,
  },
  {
    id: "call",
    eyebrow: "التالي · اجتماع",
    title: "اتصال فريق التصميم",
    detail: "١١:٣٠ ص",
    meta: "بعد ٤٨ دقيقة",
    tone: "sky",
    icon: CalendarClock,
  },
  {
    id: "file",
    eyebrow: "مسودة · مستند",
    title: "ملف الربع الثالث",
    detail: "مستحق اليوم",
    meta: "آخر تعديل منذ ٣٥ دقيقة",
    tone: "leaf",
    icon: FileText,
  },
];

const initialChat: ChatLine[] = [
  {
    id: 1,
    role: "assistant",
    text: "صباح الخير يا كريم. رتّبت لك ما يحتاج قراراً أولاً، ثم ما سيأتي بعده.",
  },
  {
    id: 2,
    role: "assistant",
    text: "ابدأ بغداء العمل: كل التفاصيل جاهزة، وينقصها اعتمادك فقط.",
  },
];

const quickCommands = ["سجّل مصروفاً", "ذكّرني بالاتصال", "ما الذي ينتظرني؟"];

export default function SecretaryTriageTimelineMobile() {
  const [view, setView] = useState<ViewMode>("focus");
  const [selected, setSelected] = useState<QueueId>("expense");
  const [approved, setApproved] = useState(false);
  const [chat, setChat] = useState<ChatLine[]>(initialChat);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  const activeItem = queue.find((item) => item.id === selected) ?? queue[0];
  const ActiveIcon = activeItem.icon;

  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const send = () => {
    const clean = draft.trim();
    if (!clean) return;
    const answer = clean.includes("مصروف")
      ? "أرسل المبلغ والوصف، وسأضعه في قائمة المراجعة قبل الحفظ."
      : clean.includes("اتصال") || clean.includes("مكالمة")
        ? "اتصال فريق التصميم الساعة ١١:٣٠. سأذكّرك قبل الموعد بعشر دقائق."
        : "حاضر. أضفت ذلك إلى قائمة المتابعة وسأحافظ على سياق المحادثة.";
    const id = Date.now();
    setChat((current) => [
      ...current,
      { id, role: "user", text: clean },
      { id: id + 1, role: "assistant", text: answer },
    ]);
    setDraft("");
    setComposerOpen(false);
  };

  const chooseCommand = (command: string) => {
    setDraft(command);
    setComposerOpen(true);
  };

  return (
    <main className="sttm-shell" dir="rtl">
      <style>{`
        .sttm-shell {
          --sttm-ink: #26363b;
          --sttm-muted: #7a898a;
          --sttm-paper: #f1eee8;
          --sttm-card: #fffdf8;
          --sttm-line: #e0ddd5;
          --sttm-terracotta: #c5644e;
          --sttm-terracotta-soft: #f7e6de;
          --sttm-sky: #527b8b;
          --sttm-sky-soft: #e2edf0;
          --sttm-leaf: #548476;
          --sttm-leaf-soft: #e2eee9;
          width: 100%;
          min-height: 100dvh;
          overflow: hidden;
          color: var(--sttm-ink);
          background:
            radial-gradient(circle at 6% 0%, rgba(230, 207, 178, .54), transparent 35%),
            radial-gradient(circle at 100% 54%, rgba(207, 227, 222, .48), transparent 33%),
            var(--sttm-paper);
          font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", sans-serif;
          letter-spacing: -.018em;
        }
        .sttm-shell *, .sttm-shell *::before, .sttm-shell *::after { box-sizing: border-box; }
        .sttm-frame { width: 100%; min-height: 100dvh; padding: 0 15px 23px; }
        .sttm-topbar {
          position: sticky; top: 0; z-index: 4; display: flex; align-items: center;
          justify-content: space-between; min-height: 68px; margin: 0 -15px; padding: 0 15px;
          border-bottom: 1px solid rgba(224, 221, 213, .9); background: rgba(241, 238, 232, .9);
          backdrop-filter: blur(16px);
        }
        .sttm-brand { display: flex; align-items: center; gap: 9px; }
        .sttm-brand-mark { display: grid; width: 37px; height: 37px; place-items: center; color: #fff9f1; border-radius: 13px; background: var(--sttm-terracotta); box-shadow: 0 8px 17px rgba(197, 100, 78, .17); }
        .sttm-brand-copy strong { display: block; font-size: 13px; font-weight: 850; }
        .sttm-brand-copy span { display: flex; align-items: center; gap: 5px; margin-top: 2px; color: var(--sttm-muted); font-size: 9px; }
        .sttm-online { width: 5px; height: 5px; border-radius: 50%; background: var(--sttm-leaf); }
        .sttm-top-actions, .sttm-action-row { display: flex; align-items: center; gap: 7px; }
        .sttm-icon {
          display: grid; width: 36px; height: 36px; place-items: center; color: var(--sttm-muted);
          border: 1px solid var(--sttm-line); border-radius: 11px; background: rgba(255, 253, 248, .6);
          cursor: pointer; transition: transform .16s ease, background .16s ease;
        }
        .sttm-icon:active, .sttm-queue-card:active, .sttm-main-action:active, .sttm-command:active, .sttm-tab:active { transform: scale(.97); }
        .sttm-context { display: flex; align-items: end; justify-content: space-between; padding: 20px 1px 16px; }
        .sttm-context p { margin: 0; color: var(--sttm-muted); font-size: 10px; }
        .sttm-context h1 { margin: 3px 0 0; font-size: 22px; line-height: 1.25; letter-spacing: -.055em; }
        .sttm-date { text-align: left; color: var(--sttm-muted); font-size: 9px; line-height: 1.7; }
        .sttm-date strong { display: block; color: var(--sttm-ink); font-size: 11px; }
        .sttm-switcher { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border: 1px solid var(--sttm-line); border-radius: 13px; background: rgba(225, 222, 214, .63); }
        .sttm-tab { min-height: 37px; color: var(--sttm-muted); border: 0; border-radius: 9px; background: transparent; font: inherit; font-size: 10px; cursor: pointer; }
        .sttm-tab.active { color: var(--sttm-ink); background: var(--sttm-card); box-shadow: 0 3px 9px rgba(57, 66, 62, .08); font-weight: 850; }
        .sttm-section-head { display: flex; align-items: center; justify-content: space-between; margin: 18px 1px 9px; }
        .sttm-section-head strong { font-size: 13px; }
        .sttm-section-head span { color: var(--sttm-muted); font-size: 9px; }
        .sttm-queue { display: grid; gap: 9px; }
        .sttm-queue-card {
          position: relative; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 75px;
          padding: 10px 9px; color: var(--sttm-ink); text-align: right; border: 1px solid var(--sttm-line);
          border-radius: 16px; background: rgba(255, 253, 248, .82); cursor: pointer;
          transition: transform .16s ease, border-color .16s ease, background .16s ease;
        }
        .sttm-queue-card.selected { border-color: #d69d8e; background: #fff8f3; box-shadow: 0 8px 20px rgba(96, 77, 66, .06); }
        .sttm-card-mark { display: grid; flex: 0 0 auto; width: 39px; height: 39px; place-items: center; border-radius: 12px; }
        .sttm-card-mark.sun { color: var(--sttm-terracotta); background: var(--sttm-terracotta-soft); }
        .sttm-card-mark.sky { color: var(--sttm-sky); background: var(--sttm-sky-soft); }
        .sttm-card-mark.leaf { color: var(--sttm-leaf); background: var(--sttm-leaf-soft); }
        .sttm-card-copy { min-width: 0; flex: 1; }
        .sttm-card-copy em { display: block; overflow: hidden; color: var(--sttm-muted); font-size: 8px; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }
        .sttm-card-copy strong { display: block; overflow: hidden; margin-top: 3px; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .sttm-card-copy small { display: block; margin-top: 4px; color: var(--sttm-muted); font-size: 8px; }
        .sttm-card-detail { color: var(--sttm-terracotta); font-size: 10px; font-weight: 850; white-space: nowrap; }
        .sttm-card-arrow { color: #abb3af; }
        .sttm-detail {
          margin-top: 15px; padding: 15px; border: 1px solid var(--sttm-line); border-radius: 20px;
          background: rgba(255, 253, 248, .88); box-shadow: 0 14px 30px rgba(72, 76, 67, .07);
          animation: sttm-enter .24s ease both;
        }
        .sttm-detail-head { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
        .sttm-detail-label { display: flex; align-items: center; gap: 7px; color: var(--sttm-terracotta); font-size: 9px; font-weight: 850; }
        .sttm-detail-label i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
        .sttm-detail h2 { margin: 7px 0 0; font-size: 16px; letter-spacing: -.04em; }
        .sttm-detail-meta { color: var(--sttm-muted); font-size: 9px; line-height: 1.8; }
        .sttm-value { display: flex; align-items: end; justify-content: space-between; margin-top: 15px; padding-top: 12px; border-top: 1px solid var(--sttm-line); }
        .sttm-value strong { font-size: 22px; letter-spacing: -.06em; }
        .sttm-value span { color: var(--sttm-muted); font-size: 9px; }
        .sttm-main-action { display: inline-flex; align-items: center; justify-content: center; gap: 6px; width: 100%; min-height: 43px; margin-top: 13px; color: #fff9f1; border: 1px solid var(--sttm-terracotta); border-radius: 12px; background: var(--sttm-terracotta); font: inherit; font-size: 10px; font-weight: 850; cursor: pointer; transition: transform .16s ease; }
        .sttm-secondary-action { width: 100%; min-height: 37px; margin-top: 7px; color: var(--sttm-muted); border: 0; background: transparent; font: inherit; font-size: 9px; cursor: pointer; }
        .sttm-approved { display: flex; align-items: center; gap: 6px; margin-top: 13px; padding: 10px; color: var(--sttm-leaf); border-radius: 11px; background: var(--sttm-leaf-soft); font-size: 10px; font-weight: 850; }
        .sttm-chat-preview { margin-top: 16px; padding: 14px; border: 1px solid #d5e1e2; border-radius: 18px; background: #edf4f2; }
        .sttm-chat-preview-head { display: flex; align-items: center; justify-content: space-between; }
        .sttm-chat-title { display: flex; align-items: center; gap: 7px; color: var(--sttm-sky); font-size: 10px; font-weight: 850; }
        .sttm-chat-title span { display: grid; width: 26px; height: 26px; place-items: center; color: #f8fbf8; border-radius: 9px; background: var(--sttm-sky); }
        .sttm-chat-preview-head button { display: inline-flex; align-items: center; gap: 3px; color: var(--sttm-sky); border: 0; background: transparent; font: inherit; font-size: 9px; cursor: pointer; }
        .sttm-bubble { margin-top: 10px; padding: 10px; color: var(--sttm-ink); border: 1px solid rgba(201, 218, 216, .75); border-radius: 13px 13px 4px 13px; background: #fbfdf8; font-size: 10px; line-height: 1.85; }
        .sttm-command-row { display: flex; gap: 7px; overflow-x: auto; margin-top: 10px; scrollbar-width: none; }
        .sttm-command-row::-webkit-scrollbar { display: none; }
        .sttm-command { flex: 0 0 auto; min-height: 34px; padding: 0 10px; color: var(--sttm-sky); border: 1px solid #c9dde0; border-radius: 10px; background: #e5f0f1; font: inherit; font-size: 9px; cursor: pointer; }
        .sttm-records { display: grid; gap: 8px; margin-top: 14px; }
        .sttm-record-row { display: flex; align-items: center; gap: 9px; min-height: 62px; padding: 9px; border: 1px solid var(--sttm-line); border-radius: 14px; background: rgba(255, 253, 248, .78); }
        .sttm-record-row span { flex: 1; font-size: 10px; }
        .sttm-record-row small { color: var(--sttm-muted); font-size: 8px; }
        .sttm-bottom-tools { display: flex; align-items: center; justify-content: space-between; margin-top: 17px; padding: 10px 2px 3px; border-top: 1px solid rgba(224, 221, 213, .82); color: var(--sttm-muted); font-size: 9px; }
        .sttm-bottom-tools button { display: inline-flex; align-items: center; gap: 5px; color: inherit; border: 0; background: transparent; font: inherit; cursor: pointer; }
        .sttm-composer-panel { position: fixed; z-index: 8; right: 12px; bottom: 12px; left: 12px; padding: 9px; border: 1px solid var(--sttm-line); border-radius: 17px; background: rgba(255, 253, 248, .98); box-shadow: 0 12px 38px rgba(50, 58, 55, .18); animation: sttm-enter .2s ease both; }
        .sttm-composer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; color: var(--sttm-muted); font-size: 9px; }
        .sttm-composer { display: flex; align-items: center; gap: 4px; min-height: 48px; padding: 4px; border: 1px solid var(--sttm-line); border-radius: 13px; background: #f8f9f4; }
        .sttm-composer input { min-width: 0; flex: 1; height: 38px; padding: 0 7px; color: var(--sttm-ink); border: 0; outline: 0; background: transparent; font: inherit; font-size: 10px; text-align: right; }
        .sttm-composer input::placeholder { color: #9ca8a5; }
        .sttm-compose-tool { display: grid; width: 33px; height: 38px; place-items: center; color: var(--sttm-muted); border: 0; background: transparent; cursor: pointer; }
        .sttm-send { display: grid; width: 38px; height: 38px; place-items: center; color: #fff9f1; border: 0; border-radius: 10px; background: var(--sttm-terracotta); cursor: pointer; }
        .sttm-compose-launch { position: fixed; z-index: 5; right: 16px; bottom: 18px; display: grid; width: 51px; height: 51px; place-items: center; color: #fff9f1; border: 0; border-radius: 17px; background: var(--sttm-terracotta); box-shadow: 0 12px 25px rgba(197, 100, 78, .27); cursor: pointer; transition: transform .16s ease; }
        .sttm-compose-launch:active { transform: scale(.95); }
        .sttm-dimmer { position: fixed; z-index: 7; inset: 0; border: 0; background: rgba(38, 54, 59, .2); }
        .sttm-search { position: fixed; z-index: 9; top: 68px; right: 12px; left: 12px; display: flex; align-items: center; gap: 7px; padding: 8px; border: 1px solid var(--sttm-line); border-radius: 13px; background: var(--sttm-card); box-shadow: 0 10px 25px rgba(50, 58, 55, .12); animation: sttm-enter .2s ease both; }
        .sttm-search input { min-width: 0; flex: 1; height: 34px; color: var(--sttm-ink); border: 0; outline: 0; background: transparent; font: inherit; font-size: 10px; text-align: right; }
        .sttm-settings { position: fixed; z-index: 9; top: 70px; left: 12px; width: 195px; padding: 13px; border: 1px solid var(--sttm-line); border-radius: 15px; background: var(--sttm-card); box-shadow: 0 10px 25px rgba(50, 58, 55, .12); animation: sttm-enter .2s ease both; }
        .sttm-settings strong { display: block; font-size: 11px; }
        .sttm-settings p { margin: 7px 0 0; color: var(--sttm-muted); font-size: 9px; line-height: 1.8; }
        .sttm-toast { position: fixed; z-index: 12; right: 15px; bottom: 82px; left: 15px; padding: 11px; color: var(--sttm-leaf); border: 1px solid #c8ddd7; border-radius: 12px; background: var(--sttm-leaf-soft); font-size: 10px; text-align: center; animation: sttm-enter .2s ease both; }
        @keyframes sttm-enter { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
        @media (min-width: 640px) {
          .sttm-shell { display: grid; place-items: center; min-height: 100dvh; padding: 22px; }
          .sttm-frame { width: min(100%, 430px); min-height: min(920px, 100dvh - 44px); padding-bottom: 23px; border: 1px solid #d9d5cc; border-radius: 30px; box-shadow: 0 22px 65px rgba(57, 74, 67, .14); }
          .sttm-topbar { border-radius: 30px 30px 0 0; }
          .sttm-compose-launch { right: calc(50% - 198px); bottom: 40px; }
          .sttm-composer-panel { right: auto; left: 50%; width: min(100% - 24px, 406px); transform: translateX(-50%); }
          .sttm-search { right: auto; left: 50%; width: min(100% - 24px, 406px); transform: translateX(-50%); }
          .sttm-settings { left: calc(50% - 198px); }
          .sttm-dimmer { display: none; }
        }
      `}</style>

      <div className="sttm-frame">
        <header className="sttm-topbar">
          <div className="sttm-brand">
            <span className="sttm-brand-mark"><Sparkles size={17} /></span>
            <span className="sttm-brand-copy"><strong>سكرتيري</strong><span><i className="sttm-online" /> متاح الآن</span></span>
          </div>
          <div className="sttm-top-actions">
            <button className="sttm-icon" aria-label="بحث" onClick={() => setSearchOpen((open) => !open)}><Search size={16} /></button>
            <button className="sttm-icon" aria-label="الإعدادات" onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={16} /></button>
          </div>
        </header>

        <section className="sttm-context">
          <div><p>الخميس، ٢٤ أكتوبر · القاهرة</p><h1>صباح هادئ، كريم</h1></div>
          <div className="sttm-date"><strong>٣ نقاط متابعة</strong> مرتبة حسب الأولوية</div>
        </section>

        <div className="sttm-switcher" role="tablist" aria-label="مساحة السكرتير">
          <button className={`sttm-tab ${view === "focus" ? "active" : ""}`} onClick={() => setView("focus")}><Inbox size={13} /> الأولويات</button>
          <button className={`sttm-tab ${view === "records" ? "active" : ""}`} onClick={() => setView("records")}><LayoutList size={13} /> كل السجلات</button>
        </div>

        {view === "focus" ? (
          <>
            <div className="sttm-section-head"><strong>مسار اليوم</strong><span>اسحب القرار إلى الأمام</span></div>
            <div className="sttm-queue">
              {queue.map((item) => {
                const Icon = item.icon;
                return (
                  <button className={`sttm-queue-card ${selected === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item.id)}>
                    <span className={`sttm-card-mark ${item.tone}`}><Icon size={17} /></span>
                    <span className="sttm-card-copy"><em>{item.eyebrow}</em><strong>{item.title}</strong><small>{item.meta}</small></span>
                    <span className="sttm-card-detail">{item.detail}</span><ChevronLeft className="sttm-card-arrow" size={15} />
                  </button>
                );
              })}
            </div>

            <article className="sttm-detail" key={activeItem.id}>
              <div className="sttm-detail-head">
                <div><div className="sttm-detail-label"><i /> {activeItem.eyebrow}</div><h2>{activeItem.title}</h2></div>
                <span className={`sttm-card-mark ${activeItem.tone}`}><ActiveIcon size={17} /></span>
              </div>
              <div className="sttm-detail-meta">{activeItem.meta} · مرتبط بالمحادثة الحالية</div>
              {activeItem.id === "expense" ? (
                <>
                  <div className="sttm-value"><strong>{activeItem.detail}</strong><span>محمود · غداء العمل</span></div>
                  {!approved ? (
                    <>
                      <button className="sttm-main-action" onClick={() => { setApproved(true); announce("تم اعتماد المصروف وإضافته إلى السجلات"); }}><Check size={15} /> اعتماد وحفظ</button>
                      <button className="sttm-secondary-action" onClick={() => chooseCommand("عدّل مصروف غداء العمل")}>تعديل التفاصيل قبل الحفظ</button>
                    </>
                  ) : <div className="sttm-approved"><CheckCircle2 size={15} /> تم الاعتماد — أضيف إلى سجلاتك</div>}
                </>
              ) : (
                <>
                  <div className="sttm-value"><strong>{activeItem.detail}</strong><span>{activeItem.id === "call" ? "مع فريق التصميم" : "مجلد التقارير"}</span></div>
                  <button className="sttm-main-action" onClick={() => announce(activeItem.id === "call" ? "سأذكّرك قبل اتصال التصميم بعشر دقائق" : "فتحت المسودة في قائمة المتابعة")}><TimerReset size={15} /> {activeItem.id === "call" ? "فعّل التذكير" : "متابعة المسودة"}</button>
                </>
              )}
            </article>

            <section className="sttm-chat-preview">
              <div className="sttm-chat-preview-head">
                <div className="sttm-chat-title"><span><MessageCircle size={13} /></span> محادثة السياق</div>
                <button onClick={() => setComposerOpen(true)}>أكمل الحديث <ChevronLeft size={12} /></button>
              </div>
              <div className="sttm-bubble">{chat[chat.length - 1]?.text ?? "اكتب ما تريد ترتيبه."}</div>
              <div className="sttm-command-row">{quickCommands.map((command) => <button className="sttm-command" key={command} onClick={() => chooseCommand(command)}>{command}</button>)}</div>
            </section>
          </>
        ) : (
          <>
            <div className="sttm-section-head"><strong>السجل الكامل</strong><span>٣ عناصر مرتبطة بك اليوم</span></div>
            <div className="sttm-records">
              {queue.map((item) => {
                const Icon = item.icon;
                return <button className="sttm-record-row" key={item.id} onClick={() => { setSelected(item.id); setView("focus"); }}><span className={`sttm-card-mark ${item.tone}`}><Icon size={16} /></span><span><strong>{item.title}</strong><small>{item.meta}</small></span><ChevronLeft size={15} color="#abb3af" /></button>;
              })}
              <button className="sttm-record-row" onClick={() => announce("سيظهر السجل الجديد هنا بعد حفظه")}><span className="sttm-card-mark leaf"><Plus size={16} /></span><span><strong>إضافة سجل جديد</strong><small>ابدأ من المحادثة بصياغتك الطبيعية</small></span><ChevronLeft size={15} color="#abb3af" /></button>
            </div>
          </>
        )}

        <footer className="sttm-bottom-tools">
          <button onClick={() => announce("آخر مزامنة قبل ٣ دقائق")}><CheckCircle2 size={13} /> تمت المزامنة قبل ٣ دقائق</button>
          <button onClick={() => announce("لا توجد تنبيهات فائتة")}><Bell size={13} /> لا تنبيهات فائتة</button>
        </footer>
      </div>

      <button className="sttm-compose-launch" aria-label="محادثة جديدة" onClick={() => setComposerOpen(true)}><Plus size={21} /></button>

      {searchOpen && (
        <div className="sttm-search">
          <Search size={15} color="#7a898a" /><input autoFocus placeholder="ابحث في السجلات..." /><button className="sttm-icon" aria-label="إغلاق البحث" onClick={() => setSearchOpen(false)}><X size={14} /></button>
        </div>
      )}
      {settingsOpen && <div className="sttm-settings"><strong>تفضيلات السكرتير</strong><p>سأبقي قراراتك معلّقة للمراجعة، وأرسل التذكيرات قبل المواعيد بعشر دقائق.</p></div>}
      {composerOpen && (
        <>
          <button className="sttm-dimmer" aria-label="إغلاق المحادثة" onClick={() => setComposerOpen(false)} />
          <section className="sttm-composer-panel">
            <div className="sttm-composer-head"><span>محادثة جديدة مع سكرتيرك</span><button className="sttm-icon" aria-label="إغلاق" onClick={() => setComposerOpen(false)}><X size={14} /></button></div>
            <div className="sttm-composer">
              <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="اكتب طلبك كما تتكلم..." />
              <button className="sttm-compose-tool" aria-label="إرفاق ملف" onClick={() => announce("اختر ملفاً من جهازك لإرفاقه")}><Paperclip size={15} /></button>
              <button className="sttm-compose-tool" aria-label="تسجيل صوتي" onClick={() => announce("التسجيل الصوتي جاهز")}><Mic size={15} /></button>
              <button className="sttm-send" aria-label="إرسال" onClick={send}><Send size={14} /></button>
            </div>
          </section>
        </>
      )}
      {notice && <button className="sttm-toast" onClick={() => setNotice("")}>{notice}</button>}
    </main>
  );
}