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

export default function ChatFirstSecretaryMobile() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [approved, setApproved] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "records" | "today">("chat");
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [recordSheet, setRecordSheet] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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
  };

  const choosePrompt = (prompt: string) => {
    setDraft(prompt);
    setActiveTab("chat");
  };

  return (
    <main className="cfm-shell" dir="rtl">
      <style>{`
        .cfm-shell {
          --ink:#1c2b34; --sub:#75848b; --paper:#f2eee7; --card:#fffdf8;
          --line:#e1dbd1; --coral:#d76b4d; --coral-soft:#f8e4db;
          --blue:#426b89; --blue-soft:#e1ecf2; --mint:#438170; --mint-soft:#e1efe9; --yellow:#d2a03d;
          width:100%; min-height:100dvh; overflow-x:hidden; color:var(--ink); background:var(--paper);
          font-family:"IBM Plex Sans Arabic","Noto Sans Arabic",sans-serif; letter-spacing:-.018em;
        }
        .cfm-shell *, .cfm-shell *::before, .cfm-shell *::after { box-sizing:border-box; }
        .cfm-app { width:100%; min-height:100dvh; padding:0 14px 164px; }
        .cfm-header { position:sticky; z-index:4; top:0; display:flex; align-items:center; justify-content:space-between; min-height:67px; margin:0 -14px; padding:0 14px; border-bottom:1px solid rgba(225,219,209,.84); background:rgba(242,238,231,.94); backdrop-filter:blur(12px); }
        .cfm-header-side, .cfm-header-actions { display:flex; align-items:center; gap:8px; }
        .cfm-avatar { display:grid; width:35px; height:35px; place-items:center; color:#fff8ef; border-radius:12px; background:var(--coral); box-shadow:0 7px 15px rgba(215,107,77,.18); }
        .cfm-header-copy strong { display:block; font-size:13px; font-weight:850; }
        .cfm-header-copy small { display:flex; align-items:center; gap:5px; margin-top:2px; color:var(--sub); font-size:9px; }
        .cfm-online { width:5px; height:5px; border-radius:50%; background:var(--mint); }
        .cfm-icon { display:grid; width:42px; height:42px; place-items:center; padding:0; color:var(--sub); border:1px solid var(--line); border-radius:13px; background:rgba(255,253,248,.56); cursor:pointer; }
        .cfm-icon:active, .cfm-action:active, .cfm-prompt:active, .cfm-record:active { transform:scale(.97); }
        .cfm-date-strip { display:flex; align-items:center; justify-content:space-between; padding:15px 2px 14px; }
        .cfm-date-copy { color:var(--sub); font-size:10px; }
        .cfm-date-copy strong { display:block; margin-bottom:2px; color:var(--ink); font-size:14px; }
        .cfm-live { display:inline-flex; align-items:center; gap:6px; padding:8px 9px; color:var(--mint); border:1px solid #c8ded6; border-radius:10px; background:var(--mint-soft); font-size:9px; font-weight:850; }
        .cfm-live i { width:5px; height:5px; border-radius:50%; background:var(--mint); }
        .cfm-chat { overflow:hidden; border:1px solid var(--line); border-radius:21px; background:rgba(255,253,248,.9); box-shadow:0 13px 34px rgba(73,61,46,.075); }
        .cfm-chat-head { display:flex; align-items:center; justify-content:space-between; padding:15px 14px 13px; border-bottom:1px solid var(--line); }
        .cfm-chat-person { display:flex; align-items:center; gap:9px; }
        .cfm-orb { display:grid; width:37px; height:37px; place-items:center; color:#fff8ef; border-radius:12px; background:var(--blue); box-shadow:0 6px 15px rgba(66,107,137,.18); }
        .cfm-chat-person strong { display:block; font-size:13px; }
        .cfm-chat-person span { display:block; margin-top:2px; color:var(--sub); font-size:9px; }
        .cfm-chat-tools { display:flex; gap:5px; }
        .cfm-chat-tools .cfm-icon { width:36px; height:36px; border:0; background:transparent; }
        .cfm-messages { display:flex; flex-direction:column; gap:12px; min-height:370px; max-height:52dvh; overflow-y:auto; padding:16px 13px 10px; overscroll-behavior:contain; }
        .cfm-message { width:fit-content; max-width:88%; padding:11px 12px; border-radius:16px; font-size:12px; line-height:1.8; }
        .cfm-message.assistant { align-self:flex-start; border:1px solid var(--line); border-top-right-radius:5px; background:#fbf9f4; }
        .cfm-message.user { align-self:flex-end; color:#fff8ef; border:1px solid var(--blue); border-top-left-radius:5px; background:var(--blue); }
        .cfm-message-label { display:flex; align-items:center; gap:5px; margin-bottom:6px; color:var(--coral); font-size:9px; font-weight:850; }
        .cfm-message-label i { width:5px; height:5px; border-radius:50%; background:var(--coral); }
        .cfm-message-meta { display:flex; align-items:center; gap:5px; margin-top:6px; opacity:.55; font-size:8px; }
        .cfm-approval { margin:0 12px 12px; padding:13px; border:1px solid #eed0c4; border-radius:15px; background:#fff6f1; }
        .cfm-approval-head { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11px; font-weight:850; }
        .cfm-pending { color:var(--coral); font-size:9px; }
        .cfm-approval p { margin:8px 0 10px; color:var(--sub); font-size:10px; line-height:1.7; }
        .cfm-amount { display:flex; align-items:end; justify-content:space-between; padding-top:9px; border-top:1px solid #f0ddd4; }
        .cfm-amount strong { font-size:19px; letter-spacing:-.05em; }
        .cfm-amount span { color:var(--sub); font-size:9px; }
        .cfm-approval-actions { display:flex; gap:7px; margin-top:12px; }
        .cfm-action { display:inline-flex; align-items:center; justify-content:center; gap:5px; min-height:45px; padding:0 13px; border-radius:11px; font:inherit; font-size:10px; font-weight:850; cursor:pointer; transition:transform .16s ease; }
        .cfm-action.primary { color:#fff8ef; border:1px solid var(--coral); background:var(--coral); }
        .cfm-action.secondary { color:var(--sub); border:1px solid var(--line); background:var(--card); }
        .cfm-approved { display:flex; align-items:center; gap:6px; padding-top:9px; color:var(--mint); font-size:10px; font-weight:850; }
        .cfm-composer-wrap { position:fixed; z-index:6; right:0; bottom:59px; left:0; padding:8px 14px 9px; border-top:1px solid rgba(225,219,209,.92); background:rgba(242,238,231,.94); backdrop-filter:blur(14px); }
        .cfm-composer { display:flex; align-items:center; gap:5px; width:100%; min-height:54px; padding:5px; border:1px solid #d8d0c4; border-radius:16px; background:var(--card); box-shadow:0 7px 18px rgba(73,61,46,.06); }
        .cfm-composer input { min-width:0; flex:1; height:42px; padding:0 7px; color:var(--ink); border:0; outline:0; background:transparent; font:inherit; font-size:11px; text-align:right; }
        .cfm-composer input::placeholder { color:#98a3a5; }
        .cfm-composer-tool { display:grid; width:39px; height:42px; place-items:center; color:var(--sub); border:0; background:transparent; cursor:pointer; }
        .cfm-send { display:grid; width:43px; height:43px; place-items:center; color:#fff8ef; border:0; border-radius:12px; background:var(--coral); cursor:pointer; }
        .cfm-suggestion-row { display:flex; gap:7px; overflow-x:auto; padding:11px 1px 1px; scrollbar-width:none; }
        .cfm-suggestion-row::-webkit-scrollbar { display:none; }
        .cfm-prompt { flex:0 0 auto; min-height:39px; padding:0 11px; color:var(--blue); border:1px solid #cbdde6; border-radius:11px; background:var(--blue-soft); font:inherit; font-size:9px; cursor:pointer; }
        .cfm-collapsibles { display:grid; gap:9px; margin-top:13px; }
        .cfm-collapse { overflow:hidden; border:1px solid var(--line); border-radius:16px; background:rgba(255,253,248,.72); }
        .cfm-collapse-toggle { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:57px; padding:0 13px; color:var(--ink); border:0; background:transparent; font:inherit; text-align:right; cursor:pointer; }
        .cfm-toggle-copy { display:flex; align-items:center; gap:9px; }
        .cfm-toggle-icon { display:grid; width:32px; height:32px; place-items:center; border-radius:10px; }
        .cfm-toggle-icon.blue { color:var(--blue); background:var(--blue-soft); }
        .cfm-toggle-icon.mint { color:var(--mint); background:var(--mint-soft); }
        .cfm-toggle-copy strong { display:block; font-size:11px; }
        .cfm-toggle-copy span { display:block; margin-top:2px; color:var(--sub); font-size:9px; }
        .cfm-chevron { color:#9da6a5; }
        .cfm-record-list { display:grid; gap:7px; padding:0 10px 10px; }
        .cfm-record { display:flex; align-items:center; gap:8px; width:100%; min-height:53px; padding:8px; color:var(--ink); border:1px solid var(--line); border-radius:12px; background:var(--card); font:inherit; text-align:right; cursor:pointer; transition:transform .16s ease; }
        .cfm-record-copy { min-width:0; flex:1; }
        .cfm-record-copy strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }
        .cfm-record-copy span { display:block; margin-top:3px; color:var(--sub); font-size:9px; }
        .cfm-record-mark { display:grid; width:31px; height:31px; place-items:center; border-radius:10px; }
        .cfm-record-mark.coral { color:var(--coral); background:var(--coral-soft); }
        .cfm-record-mark.blue { color:var(--blue); background:var(--blue-soft); }
        .cfm-record-mark.mint { color:var(--mint); background:var(--mint-soft); }
        .cfm-record-price { color:var(--coral); font-size:9px; font-weight:850; }
        .cfm-context-copy { display:flex; gap:9px; padding:0 13px 13px; color:var(--sub); font-size:10px; line-height:1.75; }
        .cfm-context-copy svg { flex:0 0 auto; color:var(--mint); margin-top:2px; }
        .cfm-bottom-nav { position:fixed; z-index:7; right:0; bottom:0; left:0; display:grid; grid-template-columns:repeat(3,1fr); min-height:60px; padding:5px 9px max(5px, env(safe-area-inset-bottom)); border-top:1px solid var(--line); background:rgba(255,253,248,.97); box-shadow:0 -5px 20px rgba(73,61,46,.06); }
        .cfm-nav-button { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; color:#94a0a2; border:0; border-radius:12px; background:transparent; font:inherit; font-size:9px; cursor:pointer; }
        .cfm-nav-button.active { color:var(--coral); background:var(--coral-soft); font-weight:850; }
        .cfm-nav-button svg { width:18px; height:18px; }
        .cfm-sheet-scrim { position:fixed; z-index:9; inset:0; background:rgba(28,43,52,.25); }
        .cfm-sheet { position:fixed; z-index:10; right:0; bottom:0; left:0; padding:12px 14px calc(76px + env(safe-area-inset-bottom)); border-radius:22px 22px 0 0; background:var(--card); box-shadow:0 -18px 40px rgba(28,43,52,.17); }
        .cfm-sheet-handle { width:38px; height:4px; margin:0 auto 15px; border-radius:5px; background:#d3cbc0; }
        .cfm-sheet-head { display:flex; align-items:center; justify-content:space-between; }
        .cfm-sheet-head strong { font-size:15px; }
        .cfm-sheet p { margin:10px 0 0; color:var(--sub); font-size:11px; line-height:1.8; }
        .cfm-menu-scrim { position:fixed; z-index:11; inset:0; background:rgba(28,43,52,.23); }
        .cfm-menu { position:fixed; z-index:12; top:0; right:0; bottom:0; width:min(82vw,300px); padding:20px 14px; background:var(--card); box-shadow:-17px 0 32px rgba(28,43,52,.15); transform:translateX(105%); transition:transform .2s ease; }
        .cfm-menu.open { transform:translateX(0); }
        .cfm-menu-head { display:flex; align-items:center; justify-content:space-between; padding-bottom:16px; border-bottom:1px solid var(--line); }
        .cfm-menu-head strong { font-size:15px; }
        .cfm-menu-list { display:grid; gap:7px; margin-top:16px; }
        .cfm-menu-list button { display:flex; align-items:center; gap:10px; min-height:48px; padding:0 11px; color:var(--sub); border:0; border-radius:12px; background:transparent; font:inherit; font-size:11px; text-align:right; cursor:pointer; }
        .cfm-menu-list button:hover { color:var(--coral); background:var(--coral-soft); }
      `}</style>

      <div className="cfm-app">
        <header className="cfm-header">
          <div className="cfm-header-side">
            <span className="cfm-avatar"><Sparkles size={17} /></span>
            <span className="cfm-header-copy"><strong>سكرتيري</strong><small><i className="cfm-online" /> متاح الآن</small></span>
          </div>
          <div className="cfm-header-actions">
            <button className="cfm-icon" aria-label="الإشعارات"><Bell size={17} /></button>
            <button className="cfm-icon" aria-label="فتح القائمة" onClick={() => setMenuOpen(true)}><Menu size={18} /></button>
          </div>
        </header>

        <div className="cfm-date-strip">
          <div className="cfm-date-copy"><strong>صباح هادئ، كريم</strong>الخميس، ٢٤ أكتوبر · القاهرة</div>
          <span className="cfm-live"><i /> مباشر</span>
        </div>

        <section className="cfm-chat" aria-label="محادثة المساعد">
          <div className="cfm-chat-head">
            <div className="cfm-chat-person"><span className="cfm-orb"><Sparkles size={17} /></span><span><strong>المساعد الشخصي</strong><span>يفهم سياقك، وليس فقط كلماتك</span></span></div>
            <div className="cfm-chat-tools"><button className="cfm-icon" aria-label="بحث"><Search size={15} /></button><button className="cfm-icon" aria-label="خيارات المحادثة"><MoreHorizontal size={16} /></button></div>
          </div>
          <div className="cfm-messages">
            {messages.map((message) => (
              <div className={`cfm-message ${message.role}`} key={message.id}>
                {message.role === "assistant" && <span className="cfm-message-label"><i /> سكرتيري</span>}
                {message.text}
                <span className="cfm-message-meta">{message.role === "assistant" ? <Sparkles size={10} /> : <Check size={10} />}{message.time}</span>
              </div>
            ))}
          </div>
          <div className="cfm-approval">
            <div className="cfm-approval-head"><span>تسجيل مصروف بانتظارك</span>{approved ? <span className="cfm-approved"><CheckCircle2 size={13} /> تم الاعتماد</span> : <span className="cfm-pending">قرارك أولاً</span>}</div>
            {!approved ? (
              <>
                <p>ذكرت أن محمود دفع معك في غداء العمل. راجع التفاصيل قبل أن أضيفها إلى سجلاتك.</p>
                <div className="cfm-amount"><strong>١٬٢٥٠ ج.م</strong><span>غداء العمل · محمود</span></div>
                <div className="cfm-approval-actions"><button className="cfm-action primary" onClick={() => setApproved(true)}><Check size={14} /> اعتماد وحفظ</button><button className="cfm-action secondary" onClick={() => choosePrompt("عدّل مصروف غداء العمل")}><MoreHorizontal size={14} /> تعديل</button></div>
              </>
            ) : <p style={{ marginBottom: 0 }}>أضفته إلى السجلات. يمكنك الرجوع إليه من قسم السجلات بالأسفل.</p>}
          </div>
        </section>

        <div className="cfm-suggestion-row">
          {prompts.map((prompt) => <button className="cfm-prompt" key={prompt} onClick={() => choosePrompt(prompt)}>{prompt}</button>)}
        </div>

        <div className="cfm-collapsibles">
          <section className="cfm-collapse">
            <button className="cfm-collapse-toggle" onClick={() => setRecordsOpen(!recordsOpen)} aria-expanded={recordsOpen}>
              <span className="cfm-toggle-copy"><span className="cfm-toggle-icon blue"><Archive size={16} /></span><span><strong>السجلات</strong><span>٣ عناصر مرتبطة بهذه المحادثة</span></span></span>{recordsOpen ? <ChevronUp className="cfm-chevron" size={17} /> : <ChevronDown className="cfm-chevron" size={17} />}
            </button>
            {recordsOpen && <div className="cfm-record-list">{records.map((record) => { const Icon = record.icon; return <button className="cfm-record" key={record.id} onClick={() => setRecordSheet(record.id)}><span className={`cfm-record-mark ${record.tone}`}><Icon size={15} /></span><span className="cfm-record-copy"><strong>{record.title}</strong><span>{record.meta}</span></span><span className="cfm-record-price">{record.detail}</span><ChevronLeft size={14} color="#a1aaa8" /></button>; })}</div>}
          </section>
          <section className="cfm-collapse">
            <button className="cfm-collapse-toggle" onClick={() => setContextOpen(!contextOpen)} aria-expanded={contextOpen}>
              <span className="cfm-toggle-copy"><span className="cfm-toggle-icon mint"><ShieldCheck size={16} /></span><span><strong>الصورة الأكبر</strong><span>قرارات ومواعيد تحت المتابعة</span></span></span>{contextOpen ? <ChevronUp className="cfm-chevron" size={17} /> : <ChevronDown className="cfm-chevron" size={17} />}
            </button>
            {contextOpen && <div className="cfm-context-copy"><CheckCircle2 size={15} /><span>مصروف واحد ينتظر اعتمادك. لا توجد تنبيهات فائتة، واتصال التصميم هو موعدك التالي.</span></div>}
          </section>
        </div>
      </div>

      <div className="cfm-composer-wrap">
        <div className="cfm-composer">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="اكتب طلبك كما تتكلم..." aria-label="اكتب طلبك" />
          <button className="cfm-composer-tool" aria-label="إرفاق ملف"><Paperclip size={16} /></button>
          <button className="cfm-composer-tool" aria-label="تسجيل صوتي"><Mic size={17} /></button>
          <button className="cfm-send" aria-label="إرسال الرسالة" onClick={send}><Send size={15} /></button>
        </div>
      </div>

      <nav className="cfm-bottom-nav" aria-label="التنقل السفلي">
        <button className={`cfm-nav-button ${activeTab === "chat" ? "active" : ""}`} onClick={() => setActiveTab("chat")}><Sparkles size={18} />المساعد</button>
        <button className={`cfm-nav-button ${activeTab === "records" ? "active" : ""}`} onClick={() => { setActiveTab("records"); setRecordsOpen(true); }}><Archive size={18} />السجلات</button>
        <button className={`cfm-nav-button ${activeTab === "today" ? "active" : ""}`} onClick={() => { setActiveTab("today"); setContextOpen(true); }}><LayoutDashboard size={18} />اليوم</button>
      </nav>

      {recordSheet && (
        <>
          <button className="cfm-sheet-scrim" aria-label="إغلاق التفاصيل" onClick={() => setRecordSheet(null)} />
          <section className="cfm-sheet">
            <div className="cfm-sheet-handle" />
            <div className="cfm-sheet-head"><strong>{records.find((record) => record.id === recordSheet)?.title}</strong><button className="cfm-icon" aria-label="إغلاق التفاصيل" onClick={() => setRecordSheet(null)}><X size={16} /></button></div>
            <p>هذا السجل مرتبط بالمحادثة الحالية. يمكنك أن تقول «عدّل السجل» وسأفتح التفاصيل مع الحفاظ على السياق.</p>
          </section>
        </>
      )}

      {menuOpen && <><button className="cfm-menu-scrim" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} /><aside className="cfm-menu open"><div className="cfm-menu-head"><strong>مساحات سكرتيرك</strong><button className="cfm-icon" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={16} /></button></div><div className="cfm-menu-list"><button onClick={() => setMenuOpen(false)}><Sparkles size={16} /> المحادثة</button><button onClick={() => { setRecordsOpen(true); setMenuOpen(false); }}><Archive size={16} /> السجلات</button><button onClick={() => setMenuOpen(false)}><Settings2 size={16} /> التفضيلات</button></div></aside></>}
    </main>
  );
}