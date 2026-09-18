import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Filter,
  LayoutList,
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

type QueueItem = {
  id: string;
  title: string;
  description: string;
  detail: string;
  tone: "coral" | "blue" | "mint";
  icon: typeof WalletCards;
};

type TimelineItem = {
  time: string;
  title: string;
  note: string;
  status: "next" | "done" | "open";
};

const queue: QueueItem[] = [
  {
    id: "expense",
    title: "اعتماد غداء العمل",
    description: "مصروف من محمود يحتاج قرارك",
    detail: "١٬٢٥٠ ج.م · بطاقة الشركة",
    tone: "coral",
    icon: WalletCards,
  },
  {
    id: "brief",
    title: "ملف الربع الثالث",
    description: "مسودة جاهزة للمراجعة",
    detail: "آخر تعديل منذ ٣٥ دقيقة",
    tone: "mint",
    icon: FileText,
  },
  {
    id: "design",
    title: "اتصال فريق التصميم",
    description: "موعدك التالي اليوم",
    detail: "١١:٣٠ ص · بعد ٤٨ دقيقة",
    tone: "blue",
    icon: CalendarClock,
  },
];

const timeline: TimelineItem[] = [
  { time: "٠٩:٤٢", title: "مراجعة البريد", note: "تم الفرز تلقائياً", status: "done" },
  { time: "١١:٣٠", title: "اتصال فريق التصميم", note: "٤٨ دقيقة من الآن", status: "next" },
  { time: "١٣:١٥", title: "غداء مع محمود", note: "مطعم قريب من المكتب", status: "open" },
  { time: "١٦:٠٠", title: "تسليم ملف الربع الثالث", note: "موعد التسليم اليوم", status: "open" },
];

const starterPrompts = ["ما الأولوية الآن؟", "سجّل مصروفاً", "ذكّرني قبل الاتصال"];

export default function SecretaryPulseBoard() {
  const [activeQueue, setActiveQueue] = useState("expense");
  const [approved, setApproved] = useState(false);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState("صباح الخير يا كريم. جمّعت لك القرارات والمواعيد هنا، لتعرف أين تبدأ دون فتح محادثة طويلة.");
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  const activeItem = queue.find((item) => item.id === activeQueue) ?? queue[0];
  const send = () => {
    const value = draft.trim();
    if (!value) return;
    const isExpense = value.includes("مصروف");
    setReply(
      isExpense
        ? "تمام. أعطني المبلغ والوصف، وسأضعه في طابور المراجعة قبل الحفظ."
        : value.includes("أولوية")
          ? "ابدأ بالقرار البرتقالي: اعتماد غداء العمل. يستغرق ثانيتين، وبعده يبقى اتصال التصميم هو الخطوة التالية."
          : "حاضر. سأحتفظ بهذا في سياق يومك وأعيده لك عند الحاجة.",
    );
    setDraft("");
  };

  return (
    <main className="spb-shell" dir="rtl">
      <style>{`
        .spb-shell {
          --ink: #192b35;
          --muted: #74838a;
          --paper: #f2eee6;
          --surface: #fffdf8;
          --surface-2: #f8f4ed;
          --line: #e2dbcf;
          --coral: #d76c4d;
          --coral-soft: #f8e4db;
          --blue: #3f6887;
          --blue-soft: #e1ebf1;
          --mint: #428270;
          --mint-soft: #e0efe8;
          --yellow: #d39e38;
          min-height: 100dvh;
          color: var(--ink);
          background:
            radial-gradient(circle at 94% 6%, rgba(63,104,135,.09), transparent 24rem),
            radial-gradient(circle at 8% 92%, rgba(215,108,77,.09), transparent 27rem),
            var(--paper);
          font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", sans-serif;
          letter-spacing: -.02em;
        }
        .spb-shell *, .spb-shell *::before, .spb-shell *::after { box-sizing: border-box; }
        .spb-frame { width: min(100%, 1460px); min-height: 100dvh; margin: auto; padding: 20px; }
        .spb-header { display:flex; align-items:center; justify-content:space-between; min-height:58px; margin-bottom:18px; }
        .spb-identity { display:flex; align-items:center; gap:12px; }
        .spb-mark { display:grid; width:42px; height:42px; place-items:center; color:#fff8ef; border-radius:15px; background:var(--coral); box-shadow:0 10px 22px rgba(215,108,77,.2); }
        .spb-identity strong { display:block; font-size:15px; font-weight:850; }
        .spb-identity small { display:flex; align-items:center; gap:5px; margin-top:2px; color:var(--muted); font-size:10px; }
        .spb-online { width:6px; height:6px; border-radius:50%; background:var(--mint); }
        .spb-actions { display:flex; align-items:center; gap:8px; }
        .spb-action { display:grid; width:36px; height:36px; place-items:center; color:var(--muted); border:1px solid var(--line); border-radius:11px; background:rgba(255,253,248,.72); cursor:pointer; transition:transform .18s ease, background .18s ease; }
        .spb-action:hover { transform:translateY(-2px); background:var(--surface); }
        .spb-chip { display:inline-flex; align-items:center; gap:6px; min-height:29px; padding:0 10px; color:var(--mint); border:1px solid #c5ddd4; border-radius:10px; background:var(--mint-soft); font-size:10px; font-weight:800; }
        .spb-chip i { width:5px; height:5px; border-radius:50%; background:var(--mint); }
        .spb-layout { display:grid; grid-template-columns: minmax(0,1.55fr) minmax(310px,.78fr); gap:18px; align-items:start; }
        .spb-main { min-width:0; }
        .spb-greeting { display:flex; align-items:end; justify-content:space-between; margin:0 4px 16px; }
        .spb-greeting h1 { margin:0; font-size:clamp(25px,3vw,37px); line-height:1.15; letter-spacing:-.055em; }
        .spb-greeting p { margin:7px 0 0; color:var(--muted); font-size:11px; }
        .spb-greeting-date { color:var(--muted); font-size:10px; text-align:left; }
        .spb-greeting-date strong { display:block; color:var(--ink); font-size:12px; }
        .spb-command { display:flex; align-items:center; gap:10px; padding:10px; margin-bottom:16px; border:1px solid #d6cfc3; border-radius:18px; background:rgba(255,253,248,.83); box-shadow:0 12px 28px rgba(73,61,46,.06); }
        .spb-command-orb { display:grid; flex:0 0 auto; width:38px; height:38px; place-items:center; color:var(--blue); border-radius:12px; background:var(--blue-soft); }
        .spb-command input { min-width:0; flex:1; height:38px; padding:0 4px; color:var(--ink); border:0; outline:0; background:transparent; font:inherit; font-size:12px; text-align:right; }
        .spb-command input::placeholder { color:#97a0a0; }
        .spb-command button { display:grid; width:34px; height:34px; place-items:center; color:#fff8ef; border:0; border-radius:10px; background:var(--coral); cursor:pointer; transition:transform .18s ease; }
        .spb-command button:hover { transform:scale(1.04); }
        .spb-command-tools { display:flex; gap:1px; }
        .spb-command-tools button { color:var(--muted); background:transparent; }
        .spb-command-tools button:hover { background:var(--surface-2); transform:none; }
        .spb-board { display:grid; grid-template-columns:minmax(0,1.18fr) minmax(250px,.82fr); gap:0; overflow:hidden; border:1px solid var(--line); border-radius:22px; background:rgba(255,253,248,.88); box-shadow:0 17px 42px rgba(73,61,46,.07); }
        .spb-board-primary { min-width:0; padding:22px 22px 20px; }
        .spb-board-secondary { padding:22px 18px; border-right:1px solid var(--line); background:rgba(248,244,237,.65); }
        .spb-section-label { display:flex; align-items:center; justify-content:space-between; margin-bottom:13px; }
        .spb-section-label h2 { margin:0; font-size:15px; }
        .spb-section-label span { color:var(--muted); font-size:10px; }
        .spb-focus-card { padding:15px; border:1px solid #ecd0c4; border-radius:16px; background:linear-gradient(135deg,#fff8f3,#fdf1eb); }
        .spb-focus-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .spb-focus-title { display:flex; align-items:center; gap:8px; }
        .spb-tone { display:grid; width:30px; height:30px; place-items:center; border-radius:10px; }
        .spb-tone.coral { color:var(--coral); background:var(--coral-soft); }
        .spb-tone.blue { color:var(--blue); background:var(--blue-soft); }
        .spb-tone.mint { color:var(--mint); background:var(--mint-soft); }
        .spb-focus-title strong { display:block; font-size:12px; }
        .spb-focus-title span { display:block; margin-top:2px; color:var(--muted); font-size:9px; }
        .spb-status { color:var(--coral); font-size:9px; font-weight:850; }
        .spb-focus-card p { margin:13px 0 11px; color:var(--muted); font-size:10px; line-height:1.7; }
        .spb-value { display:flex; align-items:end; justify-content:space-between; padding-top:10px; border-top:1px solid #efdcd2; }
        .spb-value strong { font-size:20px; letter-spacing:-.05em; }
        .spb-value span { color:var(--muted); font-size:9px; }
        .spb-focus-actions { display:flex; gap:7px; margin-top:14px; }
        .spb-button { display:inline-flex; align-items:center; justify-content:center; gap:5px; min-height:33px; padding:0 12px; border-radius:10px; font:inherit; font-size:10px; font-weight:800; cursor:pointer; transition:transform .18s ease, opacity .18s ease; }
        .spb-button:hover { transform:translateY(-1px); }
        .spb-button.primary { color:#fff8ef; border:1px solid var(--coral); background:var(--coral); }
        .spb-button.ghost { color:var(--muted); border:1px solid var(--line); background:var(--surface); }
        .spb-approved { display:flex; align-items:center; gap:6px; padding:9px 0 2px; color:var(--mint); font-size:10px; font-weight:800; }
        .spb-queue { display:grid; gap:8px; margin-top:11px; }
        .spb-queue-item { display:flex; align-items:center; gap:9px; width:100%; padding:10px; color:var(--ink); border:1px solid var(--line); border-radius:14px; background:rgba(255,253,248,.8); font:inherit; text-align:right; cursor:pointer; transition:transform .18s ease, border-color .18s ease, background .18s ease; }
        .spb-queue-item:hover, .spb-queue-item.active { transform:translateX(-2px); border-color:#d4c6b8; background:var(--surface); }
        .spb-queue-item.active { box-shadow:0 7px 18px rgba(73,61,46,.06); }
        .spb-queue-copy { min-width:0; flex:1; }
        .spb-queue-copy strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }
        .spb-queue-copy span { display:block; margin-top:3px; overflow:hidden; color:var(--muted); text-overflow:ellipsis; white-space:nowrap; font-size:9px; }
        .spb-queue-copy small { display:block; margin-top:5px; color:var(--muted); font-size:8px; }
        .spb-queue-arrow { color:#a1aaa8; }
        .spb-assistant-note { display:flex; gap:9px; margin-top:18px; padding:11px; border:1px solid #d5e0e3; border-radius:13px; background:#edf3f2; }
        .spb-assistant-note svg { flex:0 0 auto; color:var(--blue); margin-top:2px; }
        .spb-assistant-note p { margin:0; color:#52666d; font-size:10px; line-height:1.75; }
        .spb-assistant-note strong { color:var(--ink); }
        .spb-timeline { display:grid; gap:0; }
        .spb-timeline-item { position:relative; display:grid; grid-template-columns:45px 15px 1fr; gap:8px; min-height:59px; }
        .spb-timeline-item:not(:last-child)::after { content:""; position:absolute; top:18px; right:51px; bottom:-6px; width:1px; background:#d9d2c7; }
        .spb-time { padding-top:1px; color:var(--muted); font-size:9px; }
        .spb-dot { z-index:1; display:grid; width:13px; height:13px; place-items:center; margin-top:2px; border:3px solid var(--surface-2); border-radius:50%; background:#b6bebc; box-shadow:0 0 0 1px #d8d1c5; }
        .spb-timeline-item.next .spb-dot { background:var(--coral); box-shadow:0 0 0 1px #e6b9aa; }
        .spb-timeline-item.done .spb-dot { background:var(--mint); }
        .spb-timeline-copy strong { display:block; font-size:10px; }
        .spb-timeline-copy span { display:block; margin-top:3px; color:var(--muted); font-size:9px; }
        .spb-today-footer { display:flex; align-items:center; justify-content:space-between; margin-top:14px; padding-top:14px; border-top:1px solid var(--line); color:var(--muted); font-size:9px; }
        .spb-today-footer button { display:inline-flex; align-items:center; gap:4px; padding:0; color:var(--coral); border:0; background:transparent; font:inherit; font-size:9px; font-weight:800; cursor:pointer; }
        .spb-bottom { display:grid; grid-template-columns:minmax(0,1fr) 250px; gap:18px; margin-top:18px; }
        .spb-reply { padding:17px 19px; border:1px solid var(--line); border-radius:18px; background:rgba(255,253,248,.72); }
        .spb-reply-head { display:flex; align-items:center; gap:8px; margin-bottom:8px; color:var(--blue); font-size:10px; font-weight:850; }
        .spb-reply p { margin:0; color:var(--muted); font-size:11px; line-height:1.85; }
        .spb-starters { padding:16px; border:1px solid var(--line); border-radius:18px; background:rgba(248,244,237,.7); }
        .spb-starters strong { display:block; margin-bottom:10px; font-size:11px; }
        .spb-starter { display:flex; align-items:center; justify-content:space-between; width:100%; padding:7px 0; color:var(--blue); border:0; border-bottom:1px solid #e8e1d7; background:transparent; font:inherit; font-size:9px; text-align:right; cursor:pointer; }
        .spb-starter:last-child { border-bottom:0; }
        .spb-starter:hover { color:var(--coral); }
        .spb-scrim { position:fixed; z-index:20; inset:0; display:none; background:rgba(25,43,53,.22); }
        .spb-drawer { position:fixed; z-index:21; top:0; bottom:0; right:0; width:min(84vw,330px); padding:23px 18px; background:var(--surface); box-shadow:-20px 0 40px rgba(25,43,53,.15); transform:translateX(105%); transition:transform .22s ease; }
        .spb-drawer.open { transform:translateX(0); }
        .spb-drawer-head { display:flex; align-items:center; justify-content:space-between; padding-bottom:18px; border-bottom:1px solid var(--line); }
        .spb-drawer-head strong { font-size:15px; }
        .spb-drawer-nav { display:grid; gap:8px; margin-top:18px; }
        .spb-drawer-nav button { display:flex; align-items:center; gap:10px; padding:12px; color:var(--muted); border:1px solid transparent; border-radius:12px; background:transparent; font:inherit; font-size:11px; text-align:right; cursor:pointer; }
        .spb-drawer-nav button:hover { color:var(--coral); background:var(--coral-soft); }
        @media (max-width: 900px) {
          .spb-layout { grid-template-columns:1fr; }
          .spb-board-secondary { border-right:0; border-top:1px solid var(--line); }
          .spb-timeline { grid-template-columns:repeat(2,1fr); gap:10px; }
          .spb-timeline-item:not(:last-child)::after { display:none; }
          .spb-bottom { grid-template-columns:1fr; }
        }
        @media (max-width: 620px) {
          .spb-frame { padding:13px; }
          .spb-header { margin-bottom:14px; }
          .spb-header .spb-chip { display:none; }
          .spb-greeting { align-items:start; }
          .spb-greeting-date { display:none; }
          .spb-board { display:block; border-radius:19px; }
          .spb-board-primary, .spb-board-secondary { padding:17px 14px; }
          .spb-board-secondary { border-top:1px solid var(--line); }
          .spb-timeline { grid-template-columns:1fr; gap:0; }
          .spb-timeline-item:not(:last-child)::after { display:block; right:51px; }
          .spb-command { border-radius:15px; }
          .spb-command-tools { display:none; }
          .spb-shell .spb-action:nth-last-child(2) { display:none; }
        }
      `}</style>

      <div className="spb-frame">
        <header className="spb-header">
          <div className="spb-identity">
            <span className="spb-mark"><Sparkles size={19} /></span>
            <span><strong>سكرتيري</strong><small><i className="spb-online" /> متاح الآن · يتابع يومك</small></span>
          </div>
          <div className="spb-actions">
            <span className="spb-chip"><i /> لا توجد تنبيهات فائتة</span>
            <button className="spb-action" aria-label="الإشعارات"><Bell size={16} /></button>
            <button className="spb-action" aria-label="الإعدادات"><Settings2 size={16} /></button>
            <button className="spb-action" aria-label="فتح القائمة" onClick={() => setMenuOpen(true)}><LayoutList size={16} /></button>
          </div>
        </header>

        <div className="spb-layout">
          <section className="spb-main">
            <div className="spb-greeting">
              <div><h1>صباح هادئ، كريم.</h1><p>بدلاً من البحث في محادثة، هذه هي الخطوة الأهم الآن.</p></div>
              <div className="spb-greeting-date"><strong>الخميس، ٢٤ أكتوبر</strong>القاهرة · ٠٩:٤٣ ص</div>
            </div>

            <div className="spb-command">
              <span className="spb-command-orb"><Sparkles size={17} /></span>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="قل لي ما تريد إنجازه..." aria-label="قل لي ما تريد إنجازه" />
              <div className="spb-command-tools">
                <button className="spb-action" aria-label="إرفاق ملف"><Paperclip size={14} /></button>
                <button className="spb-action" aria-label="تسجيل صوتي"><Mic size={14} /></button>
              </div>
              <button aria-label="إرسال" onClick={send}><Send size={14} /></button>
            </div>

            <div className="spb-board">
              <div className="spb-board-primary">
                <div className="spb-section-label"><h2>طابور الانتباه</h2><span>٣ أشياء تستحق قرارك</span></div>
                <div className="spb-focus-card">
                  <div className="spb-focus-top">
                    <div className="spb-focus-title">
                      <span className={`spb-tone ${activeItem.tone}`}><activeItem.icon size={16} /></span>
                      <span><strong>{activeItem.title}</strong><span>{activeItem.description}</span></span>
                    </div>
                    <span className="spb-status">{activeQueue === "expense" && !approved ? "بانتظارك" : "في المتابعة"}</span>
                  </div>
                  <p>{activeQueue === "expense" ? "ذكرت أن محمود دفع معك في غداء العمل. راجع التفاصيل هنا، ثم احفظه مرة واحدة في سجلاتك." : activeItem.id === "brief" ? "جمعت لك آخر نسخة مع ملاحظاتك المفتوحة. يمكنك إرسالها للمراجعة عندما تكون جاهزاً." : "موعدك محفوظ في يومك. أستطيع تذكيرك قبل البدء أو تجهيز نقاط الحديث."}</p>
                  <div className="spb-value"><strong>{activeQueue === "expense" ? "١٬٢٥٠ ج.م" : activeItem.detail}</strong><span>{activeQueue === "expense" ? "غداء العمل · محمود" : "تفاصيل مرتبطة بيومك"}</span></div>
                  {activeQueue === "expense" && !approved ? (
                    <div className="spb-focus-actions">
                      <button className="spb-button primary" onClick={() => setApproved(true)}><Check size={13} /> اعتماد وحفظ</button>
                      <button className="spb-button ghost" onClick={() => setDraft("عدّل مصروف غداء العمل")}><MoreHorizontal size={14} /> تعديل</button>
                    </div>
                  ) : (
                    <div className="spb-approved"><CheckCircle2 size={14} /> {activeQueue === "expense" ? "تم اعتماد المصروف وإضافته للسجل" : "أبقيت هذا في سياق يومك"}</div>
                  )}
                </div>
                <div className="spb-queue">
                  {queue.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button className={`spb-queue-item ${activeQueue === item.id ? "active" : ""}`} key={item.id} onClick={() => setActiveQueue(item.id)}>
                        <span className={`spb-tone ${item.tone}`}><Icon size={15} /></span>
                        <span className="spb-queue-copy"><strong>{item.title}</strong><span>{item.description}</span><small>{item.detail}</small></span>
                        <ArrowLeft className="spb-queue-arrow" size={14} />
                      </button>
                    );
                  })}
                </div>
                <div className="spb-assistant-note"><ShieldCheck size={15} /><p><strong>لماذا هذا أولاً؟</strong><br />هذا القرار يغلق مصروفاً مفتوحاً، ثم يترك لك وقتاً صافياً قبل اتصال التصميم.</p></div>
              </div>

              <aside className="spb-board-secondary">
                <div className="spb-section-label"><h2>إيقاع اليوم</h2><span>بالترتيب</span></div>
                <div className="spb-timeline">
                  {timeline.map((item) => (
                    <div className={`spb-timeline-item ${item.status}`} key={item.time}>
                      <span className="spb-time">{item.time}</span><i className="spb-dot" />
                      <span className="spb-timeline-copy"><strong>{item.title}</strong><span>{item.note}</span></span>
                    </div>
                  ))}
                </div>
                <div className="spb-today-footer"><span>التركيز ٣ من ٤</span><button onClick={() => setFocusMode(!focusMode)}>{focusMode ? "إنهاء التركيز" : "وضع التركيز"} <ArrowUpRight size={12} /></button></div>
              </aside>
            </div>

            <div className="spb-bottom">
              <div className="spb-reply"><div className="spb-reply-head"><Sparkles size={14} /> من السكرتير</div><p>{reply}</p></div>
              <div className="spb-starters"><strong>ابدأ بصوتك أو بكلماتك</strong>{starterPrompts.map((prompt) => <button className="spb-starter" key={prompt} onClick={() => setDraft(prompt)}>{prompt}<ArrowLeft size={12} /></button>)}</div>
            </div>
          </section>
        </div>
      </div>

      <div className="spb-scrim" style={{ display: menuOpen ? "block" : "none" }} onClick={() => setMenuOpen(false)} />
      <aside className={`spb-drawer ${menuOpen ? "open" : ""}`}>
        <div className="spb-drawer-head"><strong>مساحات سكرتيرك</strong><button className="spb-action" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={16} /></button></div>
        <nav className="spb-drawer-nav">
          <button onClick={() => setMenuOpen(false)}><Sparkles size={16} /> لوحة الأولويات</button>
          <button onClick={() => setMenuOpen(false)}><Archive size={16} /> كل السجلات</button>
          <button onClick={() => setMenuOpen(false)}><Search size={16} /> البحث في السياق</button>
          <button onClick={() => setMenuOpen(false)}><Filter size={16} /> إعدادات العرض</button>
        </nav>
      </aside>
    </main>
  );
}