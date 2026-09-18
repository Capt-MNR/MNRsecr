import {
  Archive,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  FileText,
  LayoutDashboard,
  Menu,
  Mic,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import { useState } from "react";

type Message = {
  id: number;
  role: "assistant" | "user";
  text: string;
  time: string;
};

const prompts = ["ما الأولوية الآن؟", "سجّل مصروفاً", "ذكّرني بالاتصال"];

const records = [
  { id: "expense", title: "غداء العمل", meta: "محمود · منذ ساعتين", detail: "١٬٢٥٠ ج.م", tone: "coral", icon: WalletCards },
  { id: "meeting", title: "اتصال فريق التصميم", meta: "اليوم · ١١:٣٠ ص", detail: "بعد ٤٨ دقيقة", tone: "blue", icon: CalendarClock },
  { id: "file", title: "ملف الربع الثالث", meta: "مستحق اليوم · مسودة", detail: "آخر تعديل منذ ٣٥ دقيقة", tone: "mint", icon: FileText },
];

const initialMessages: Message[] = [
  { id: 1, role: "assistant", text: "صباح الخير يا كريم. أنا هنا، ونقدر نبدأ من أي شيء في بالك.", time: "٠٩:٤٢" },
  { id: 2, role: "assistant", text: "عندك قرار واحد ينتظر اعتمادك، وبعده اتصال التصميم الساعة ١١:٣٠.", time: "٠٩:٤٣" },
];

export default function BriefRailSecretaryMobile() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [approved, setApproved] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "records" | "today">("today");
  const [recordsOpen, setRecordsOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(false);
  const [recordSheet, setRecordSheet] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [recording, setRecording] = useState(false);

  const send = () => {
    const clean = draft.trim();
    if (!clean) return;
    const answer = clean.includes("مصروف")
      ? "تمام. اكتب المبلغ والوصف، وأنا أجهز التسجيل للمراجعة قبل الحفظ."
      : clean.includes("اتصال") || clean.includes("مكالمة")
        ? "اتصال فريق التصميم اليوم الساعة ١١:٣٠. أذكّرك قبلها بعشر دقائق؟"
        : "حاضر. سأرتّب هذا لك وأرجع بالنتيجة هنا.";
    const now = Date.now();
    setMessages((current) => [
      ...current,
      { id: now, role: "user", text: clean, time: "الآن" },
      { id: now + 1, role: "assistant", text: answer, time: "الآن" },
    ]);
    setDraft("");
    setActiveTab("chat");
  };

  const choosePrompt = (prompt: string) => {
    setDraft(prompt);
    setActiveTab("chat");
    setNotice("");
  };

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  return (
    <main className="brs-shell" dir="rtl">
      <style>{`
        .brs-shell {
          --ink:#1f2c33; --sub:#78868b; --paper:#edf1ef; --card:#fffdf9; --line:#d8e1dc;
          --coral:#c9674f; --coral-soft:#f7e3da; --blue:#416d83; --blue-soft:#e1edf1;
          --mint:#3f806d; --mint-soft:#e1efe9; --yellow:#c69a3a; --shadow:0 17px 40px rgba(43,63,58,.08);
          min-height:100dvh; width:100%; overflow-x:hidden; color:var(--ink); background:var(--paper);
          font-family:"IBM Plex Sans Arabic","Noto Sans Arabic",sans-serif; letter-spacing:-.018em;
        }
        .brs-shell *, .brs-shell *::before, .brs-shell *::after { box-sizing:border-box; }
        .brs-app { min-height:100dvh; padding:0 14px 168px; }
        .brs-topbar { position:sticky; top:0; z-index:6; display:flex; align-items:center; justify-content:space-between; min-height:66px; margin:0 -14px; padding:0 14px; border-bottom:1px solid rgba(216,225,220,.9); background:rgba(237,241,239,.94); backdrop-filter:blur(14px); }
        .brs-brand, .brs-top-actions { display:flex; align-items:center; gap:9px; }
        .brs-avatar { display:grid; width:34px; height:34px; place-items:center; color:#fff9ef; border-radius:11px; background:var(--coral); box-shadow:0 7px 15px rgba(201,103,79,.2); }
        .brs-brand-copy strong { display:block; font-size:13px; font-weight:850; }
        .brs-brand-copy span { display:flex; align-items:center; gap:5px; margin-top:2px; color:var(--sub); font-size:9px; }
        .brs-status-dot { width:5px; height:5px; border-radius:50%; background:var(--mint); }
        .brs-icon { display:grid; width:38px; height:38px; place-items:center; padding:0; color:var(--sub); border:1px solid var(--line); border-radius:12px; background:rgba(255,253,249,.7); cursor:pointer; }
        .brs-icon:active, .brs-pill:active, .brs-record:active, .brs-send:active, .brs-nav:active { transform:scale(.97); }
        .brs-welcome { display:flex; align-items:end; justify-content:space-between; padding:18px 2px 14px; }
        .brs-welcome strong { display:block; font-size:18px; letter-spacing:-.04em; }
        .brs-welcome small { display:block; margin-top:4px; color:var(--sub); font-size:10px; }
        .brs-live { display:inline-flex; align-items:center; gap:6px; padding:8px 10px; color:var(--mint); border:1px solid #c5ded4; border-radius:10px; background:var(--mint-soft); font-size:9px; font-weight:850; }
        .brs-live i { width:5px; height:5px; border-radius:50%; background:var(--mint); }
        .brs-priority { position:relative; overflow:hidden; padding:17px 16px 15px; border:1px solid #e6c7bb; border-radius:20px; background:linear-gradient(135deg,#fff8f3 0%,#fffdf9 72%); box-shadow:var(--shadow); }
        .brs-priority::before { position:absolute; top:0; right:0; width:5px; height:100%; background:var(--coral); content:""; }
        .brs-priority-kicker { display:flex; align-items:center; justify-content:space-between; color:var(--coral); font-size:9px; font-weight:850; }
        .brs-priority-kicker span { display:inline-flex; align-items:center; gap:5px; }
        .brs-priority h2 { margin:9px 0 5px; font-size:17px; letter-spacing:-.04em; }
        .brs-priority p { max-width:94%; margin:0; color:var(--sub); font-size:10px; line-height:1.75; }
        .brs-priority-footer { display:flex; align-items:end; justify-content:space-between; gap:10px; margin-top:14px; padding-top:12px; border-top:1px solid #f0ddd5; }
        .brs-amount strong { display:block; font-size:21px; letter-spacing:-.06em; }
        .brs-amount span { display:block; margin-top:2px; color:var(--sub); font-size:9px; }
        .brs-priority-actions { display:flex; gap:7px; }
        .brs-action { display:inline-flex; align-items:center; justify-content:center; gap:5px; min-height:38px; padding:0 11px; border-radius:10px; font:inherit; font-size:9px; font-weight:850; cursor:pointer; }
        .brs-action.primary { color:#fff9ef; border:1px solid var(--coral); background:var(--coral); }
        .brs-action.secondary { color:var(--sub); border:1px solid var(--line); background:var(--card); }
        .brs-approved { display:inline-flex; align-items:center; gap:6px; color:var(--mint); font-size:10px; font-weight:850; }
        .brs-section-label { display:flex; align-items:center; justify-content:space-between; margin:18px 2px 9px; }
        .brs-section-label strong { font-size:12px; }
        .brs-section-label span { color:var(--sub); font-size:9px; }
        .brs-rail { display:grid; gap:8px; }
        .brs-rail-card { display:flex; align-items:center; gap:9px; min-height:59px; padding:8px 10px; color:var(--ink); border:1px solid var(--line); border-radius:15px; background:rgba(255,253,249,.78); font:inherit; text-align:right; cursor:pointer; transition:transform .16s ease; }
        .brs-rail-card:hover { transform:translateX(-2px); }
        .brs-rail-mark { display:grid; flex:0 0 auto; width:35px; height:35px; place-items:center; border-radius:11px; }
        .brs-rail-mark.coral { color:var(--coral); background:var(--coral-soft); }
        .brs-rail-mark.blue { color:var(--blue); background:var(--blue-soft); }
        .brs-rail-mark.mint { color:var(--mint); background:var(--mint-soft); }
        .brs-rail-copy { min-width:0; flex:1; }
        .brs-rail-copy strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }
        .brs-rail-copy span { display:block; margin-top:3px; color:var(--sub); font-size:9px; }
        .brs-rail-detail { color:var(--coral); font-size:9px; font-weight:850; white-space:nowrap; }
        .brs-rail-card > svg { color:#a6afad; }
        .brs-chat { margin-top:18px; overflow:hidden; border:1px solid var(--line); border-radius:20px; background:rgba(255,253,249,.86); box-shadow:0 12px 30px rgba(43,63,58,.055); }
        .brs-chat-head { display:flex; align-items:center; justify-content:space-between; padding:13px 13px 12px; border-bottom:1px solid var(--line); }
        .brs-chat-person { display:flex; align-items:center; gap:8px; }
        .brs-orb { display:grid; width:34px; height:34px; place-items:center; color:#fff9ef; border-radius:11px; background:var(--blue); }
        .brs-chat-person strong { display:block; font-size:12px; }
        .brs-chat-person span { display:block; margin-top:2px; color:var(--sub); font-size:9px; }
        .brs-chat-tools { display:flex; gap:4px; }
        .brs-chat-tools .brs-icon { width:33px; height:33px; border:0; background:transparent; }
        .brs-search { margin:9px 11px 0; padding:0 10px; border:1px solid var(--line); border-radius:10px; background:var(--card); }
        .brs-search input { width:100%; height:33px; color:var(--ink); border:0; outline:0; background:transparent; font:inherit; font-size:10px; text-align:right; }
        .brs-messages { display:flex; flex-direction:column; gap:10px; min-height:200px; max-height:35dvh; overflow-y:auto; padding:13px 12px 10px; }
        .brs-message { width:fit-content; max-width:88%; padding:9px 11px; border-radius:15px; font-size:11px; line-height:1.75; }
        .brs-message.assistant { align-self:flex-start; border:1px solid var(--line); border-top-right-radius:5px; background:#fbfaf6; }
        .brs-message.user { align-self:flex-end; color:#fff9ef; border:1px solid var(--blue); border-top-left-radius:5px; background:var(--blue); }
        .brs-message-label { display:flex; align-items:center; gap:5px; margin-bottom:5px; color:var(--coral); font-size:8px; font-weight:850; }
        .brs-message-label i { width:5px; height:5px; border-radius:50%; background:var(--coral); }
        .brs-message-meta { display:flex; align-items:center; gap:4px; margin-top:5px; opacity:.55; font-size:8px; }
        .brs-suggestion-row { display:flex; gap:7px; overflow-x:auto; padding:10px 0 1px; scrollbar-width:none; }
        .brs-suggestion-row::-webkit-scrollbar { display:none; }
        .brs-pill { flex:0 0 auto; min-height:36px; padding:0 11px; color:var(--blue); border:1px solid #c8dce4; border-radius:10px; background:var(--blue-soft); font:inherit; font-size:9px; cursor:pointer; }
        .brs-fold { margin-top:16px; overflow:hidden; border:1px solid var(--line); border-radius:16px; background:rgba(255,253,249,.72); }
        .brs-fold-toggle { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:55px; padding:0 12px; color:var(--ink); border:0; background:transparent; font:inherit; text-align:right; cursor:pointer; }
        .brs-fold-copy { display:flex; align-items:center; gap:9px; }
        .brs-fold-icon { display:grid; width:31px; height:31px; place-items:center; color:var(--mint); border-radius:10px; background:var(--mint-soft); }
        .brs-fold-copy strong { display:block; font-size:11px; }
        .brs-fold-copy span { display:block; margin-top:2px; color:var(--sub); font-size:9px; }
        .brs-fold-body { display:flex; gap:9px; padding:0 12px 13px; color:var(--sub); font-size:10px; line-height:1.75; }
        .brs-fold-body svg { flex:0 0 auto; margin-top:2px; color:var(--mint); }
        .brs-composer-wrap { position:fixed; right:0; bottom:59px; left:0; z-index:7; padding:8px 14px 9px; border-top:1px solid rgba(216,225,220,.94); background:rgba(237,241,239,.95); backdrop-filter:blur(14px); }
        .brs-composer { display:flex; align-items:center; gap:3px; min-height:52px; padding:4px; border:1px solid #d1ddd7; border-radius:15px; background:var(--card); box-shadow:0 8px 20px rgba(43,63,58,.07); }
        .brs-composer input { min-width:0; flex:1; height:40px; padding:0 7px; color:var(--ink); border:0; outline:0; background:transparent; font:inherit; font-size:10px; text-align:right; }
        .brs-composer input::placeholder { color:#9aa6a6; }
        .brs-composer-tool { display:grid; width:36px; height:40px; place-items:center; color:var(--sub); border:0; background:transparent; cursor:pointer; }
        .brs-composer-tool.recording { color:var(--coral); }
        .brs-send { display:grid; width:41px; height:41px; place-items:center; color:#fff9ef; border:0; border-radius:11px; background:var(--coral); cursor:pointer; }
        .brs-bottom-nav { position:fixed; right:0; bottom:0; left:0; z-index:8; display:grid; grid-template-columns:repeat(3,1fr); min-height:60px; padding:5px 9px max(5px,env(safe-area-inset-bottom)); border-top:1px solid var(--line); background:rgba(255,253,249,.97); box-shadow:0 -6px 20px rgba(43,63,58,.06); }
        .brs-nav { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; color:#93a0a0; border:0; border-radius:11px; background:transparent; font:inherit; font-size:9px; cursor:pointer; }
        .brs-nav.active { color:var(--coral); background:var(--coral-soft); font-weight:850; }
        .brs-toast { position:fixed; right:14px; bottom:131px; left:14px; z-index:13; padding:10px 12px; color:#fff9ef; border-radius:11px; background:var(--ink); font-size:10px; text-align:center; box-shadow:0 9px 24px rgba(31,44,51,.18); }
        .brs-sheet-scrim, .brs-menu-scrim { position:fixed; inset:0; z-index:9; border:0; background:rgba(31,44,51,.25); }
        .brs-sheet { position:fixed; right:0; bottom:0; left:0; z-index:10; padding:11px 14px calc(75px + env(safe-area-inset-bottom)); border-radius:21px 21px 0 0; background:var(--card); box-shadow:0 -18px 40px rgba(31,44,51,.17); }
        .brs-sheet-handle { width:37px; height:4px; margin:0 auto 15px; border-radius:5px; background:#d2dbd6; }
        .brs-sheet-head { display:flex; align-items:center; justify-content:space-between; }
        .brs-sheet-head strong { font-size:15px; }
        .brs-sheet p { margin:9px 0 0; color:var(--sub); font-size:11px; line-height:1.8; }
        .brs-menu { position:fixed; top:0; right:0; bottom:0; z-index:12; width:min(82vw,300px); padding:20px 14px; background:var(--card); box-shadow:-17px 0 32px rgba(31,44,51,.15); }
        .brs-menu-head { display:flex; align-items:center; justify-content:space-between; padding-bottom:16px; border-bottom:1px solid var(--line); }
        .brs-menu-head strong { font-size:15px; }
        .brs-menu-list { display:grid; gap:7px; margin-top:16px; }
        .brs-menu-list button { display:flex; align-items:center; gap:10px; min-height:48px; padding:0 11px; color:var(--sub); border:0; border-radius:12px; background:transparent; font:inherit; font-size:11px; text-align:right; cursor:pointer; }
        .brs-menu-list button:hover { color:var(--coral); background:var(--coral-soft); }
        @media (min-width:720px) {
          .brs-app { max-width:560px; margin:0 auto; padding-right:22px; padding-left:22px; }
          .brs-topbar { margin-right:-22px; margin-left:-22px; padding-right:22px; padding-left:22px; }
          .brs-composer-wrap { right:50%; left:50%; width:560px; transform:translateX(50%); }
          .brs-bottom-nav { right:50%; left:50%; width:560px; transform:translateX(50%); }
        }
      `}</style>

      <div className="brs-app">
        <header className="brs-topbar">
          <div className="brs-brand">
            <span className="brs-avatar"><Sparkles size={17} /></span>
            <span className="brs-brand-copy"><strong>سكرتيري</strong><span><i className="brs-status-dot" /> متاح الآن</span></span>
          </div>
          <div className="brs-top-actions">
            <button className="brs-icon" aria-label="الإشعارات" onClick={() => showNotice("لا توجد إشعارات جديدة")}><Bell size={16} /></button>
            <button className="brs-icon" aria-label="فتح القائمة" onClick={() => setMenuOpen(true)}><Menu size={18} /></button>
          </div>
        </header>

        <div className="brs-welcome">
          <div><strong>صباح هادئ، كريم</strong><small>الخميس، ٢٤ أكتوبر · القاهرة</small></div>
          <span className="brs-live"><i /> مباشر</span>
        </div>

        <section className="brs-priority" aria-label="الأولوية الآن">
          <div className="brs-priority-kicker"><span><Bell size={12} /> الأولوية الآن</span><span>قرارك أولاً</span></div>
          <h2>تسجيل مصروف بانتظارك</h2>
          {!approved ? (
            <>
              <p>ذكرت أن محمود دفع معك في غداء العمل. راجع التفاصيل قبل أن أضيفها إلى سجلاتك.</p>
              <div className="brs-priority-footer">
                <div className="brs-amount"><strong>١٬٢٥٠ ج.م</strong><span>غداء العمل · محمود</span></div>
                <div className="brs-priority-actions">
                  <button className="brs-action secondary" onClick={() => choosePrompt("عدّل مصروف غداء العمل")}><MoreHorizontal size={13} /> تعديل</button>
                  <button className="brs-action primary" onClick={() => setApproved(true)}><Check size={13} /> اعتماد</button>
                </div>
              </div>
            </>
          ) : (
            <div className="brs-priority-footer"><span className="brs-approved"><CheckCircle2 size={14} /> تم الاعتماد والحفظ في السجلات</span><button className="brs-action secondary" onClick={() => setApproved(false)}>تراجع</button></div>
          )}
        </section>

        <div className="brs-section-label"><strong>محطتك اليوم</strong><span>٣ عناصر مرتبطة بسياقك</span></div>
        <section className="brs-rail" aria-label="محطة اليوم">
          {records.map((record) => {
            const Icon = record.icon;
            return <button className="brs-rail-card" key={record.id} onClick={() => setRecordSheet(record.id)}><span className={`brs-rail-mark ${record.tone}`}><Icon size={16} /></span><span className="brs-rail-copy"><strong>{record.title}</strong><span>{record.meta}</span></span><span className="brs-rail-detail">{record.detail}</span><ChevronLeft size={14} /></button>;
          })}
        </section>

        <section className="brs-chat" aria-label="محادثة المساعد">
          <div className="brs-chat-head">
            <div className="brs-chat-person"><span className="brs-orb"><Sparkles size={16} /></span><span><strong>المساعد الشخصي</strong><span>يفهم سياقك، وليس فقط كلماتك</span></span></div>
            <div className="brs-chat-tools"><button className="brs-icon" aria-label="بحث في المحادثة" onClick={() => setSearchOpen(!searchOpen)}><Search size={14} /></button><button className="brs-icon" aria-label="خيارات المحادثة" onClick={() => showNotice("المحادثة محفوظة في سياق اليوم")}><MoreHorizontal size={15} /></button></div>
          </div>
          {searchOpen && <div className="brs-search"><input autoFocus placeholder="ابحث داخل المحادثة..." aria-label="بحث داخل المحادثة" /></div>}
          <div className="brs-messages">
            {messages.map((message) => <div className={`brs-message ${message.role}`} key={message.id}>{message.role === "assistant" && <span className="brs-message-label"><i /> سكرتيري</span>}{message.text}<span className="brs-message-meta">{message.role === "assistant" ? <Sparkles size={9} /> : <Check size={9} />}{message.time}</span></div>)}
          </div>
        </section>

        <div className="brs-suggestion-row">
          {prompts.map((prompt) => <button className="brs-pill" key={prompt} onClick={() => choosePrompt(prompt)}>{prompt}</button>)}
        </div>

        <section className="brs-fold">
          <button className="brs-fold-toggle" onClick={() => setContextOpen(!contextOpen)} aria-expanded={contextOpen}>
            <span className="brs-fold-copy"><span className="brs-fold-icon"><ShieldCheck size={15} /></span><span><strong>الصورة الأكبر</strong><span>قرارات ومواعيد تحت المتابعة</span></span></span>{contextOpen ? <ChevronUp size={17} color="#9ca9a6" /> : <ChevronDown size={17} color="#9ca9a6" />}
          </button>
          {contextOpen && <div className="brs-fold-body"><CheckCircle2 size={15} /><span>مصروف واحد ينتظر اعتمادك. لا توجد تنبيهات فائتة، واتصال التصميم هو موعدك التالي.</span></div>}
        </section>

        <section className="brs-fold">
          <button className="brs-fold-toggle" onClick={() => setRecordsOpen(!recordsOpen)} aria-expanded={recordsOpen}>
            <span className="brs-fold-copy"><span className="brs-fold-icon" style={{ color: "var(--blue)", background: "var(--blue-soft)" }}><Archive size={15} /></span><span><strong>السجلات المرتبطة</strong><span>افتح التفاصيل من محطة اليوم</span></span></span>{recordsOpen ? <ChevronUp size={17} color="#9ca9a6" /> : <ChevronDown size={17} color="#9ca9a6" />}
          </button>
          {recordsOpen && <div className="brs-fold-body"><Archive size={15} color="#416d83" /><span>٣ عناصر مرتبطة بهذه المحادثة، ويمكن العودة إليها مع الحفاظ على نفس السياق.</span></div>}
        </section>
      </div>

      <div className="brs-composer-wrap">
        <div className="brs-composer">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="اكتب طلبك كما تتكلم..." aria-label="اكتب طلبك" />
          <button className="brs-composer-tool" aria-label="إرفاق ملف" onClick={() => showNotice("يمكنك إرفاق ملف في الرسالة التالية")}><Paperclip size={15} /></button>
          <button className={`brs-composer-tool ${recording ? "recording" : ""}`} aria-label="تسجيل صوتي" onClick={() => { setRecording(!recording); showNotice(recording ? "انتهى التسجيل الصوتي" : "بدأ التسجيل الصوتي"); }}><Mic size={16} /></button>
          <button className="brs-send" aria-label="إرسال الرسالة" onClick={send}><Send size={14} /></button>
        </div>
      </div>

      <nav className="brs-bottom-nav" aria-label="التنقل السفلي">
        <button className={`brs-nav ${activeTab === "chat" ? "active" : ""}`} onClick={() => { setActiveTab("chat"); document.querySelector(".brs-chat")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}><Sparkles size={17} />المساعد</button>
        <button className={`brs-nav ${activeTab === "records" ? "active" : ""}`} onClick={() => { setActiveTab("records"); setRecordsOpen(true); document.querySelector(".brs-rail")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}><Archive size={17} />السجلات</button>
        <button className={`brs-nav ${activeTab === "today" ? "active" : ""}`} onClick={() => { setActiveTab("today"); window.scrollTo({ top: 0, behavior: "smooth" }); }}><LayoutDashboard size={17} />اليوم</button>
      </nav>

      {notice && <div className="brs-toast" role="status">{notice}</div>}
      {recordSheet && <><button className="brs-sheet-scrim" aria-label="إغلاق التفاصيل" onClick={() => setRecordSheet(null)} /><section className="brs-sheet"><div className="brs-sheet-handle" /><div className="brs-sheet-head"><strong>{records.find((record) => record.id === recordSheet)?.title}</strong><button className="brs-icon" aria-label="إغلاق التفاصيل" onClick={() => setRecordSheet(null)}><X size={16} /></button></div><p>هذا السجل مرتبط بالمحادثة الحالية. يمكنك أن تقول «عدّل السجل» وسأفتح التفاصيل مع الحفاظ على السياق.</p></section></>}
      {menuOpen && <><button className="brs-menu-scrim" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} /><aside className="brs-menu"><div className="brs-menu-head"><strong>مساحات سكرتيرك</strong><button className="brs-icon" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={16} /></button></div><div className="brs-menu-list"><button onClick={() => { setMenuOpen(false); setActiveTab("chat"); }}><Sparkles size={16} /> المحادثة</button><button onClick={() => { setRecordsOpen(true); setMenuOpen(false); setActiveTab("records"); }}><Archive size={16} /> السجلات</button><button onClick={() => { setMenuOpen(false); showNotice("التفضيلات متاحة من مساحة الإعدادات"); }}><Settings2 size={16} /> التفضيلات</button></div></aside></>}
    </main>
  );
}