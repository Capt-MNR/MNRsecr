import {
  Archive,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  FileText,
  Filter,
  LayoutList,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  Settings2,
  Sparkles,
  TimerReset,
  WalletCards,
  X,
} from "lucide-react";
import { useState } from "react";

type EntryId = "expense" | "call" | "draft";
type ViewId = "day" | "records";
type ChatLine = { id: number; role: "assistant" | "user"; text: string };

type DayEntry = {
  id: EntryId;
  time: string;
  eyebrow: string;
  title: string;
  detail: string;
  meta: string;
  status: string;
  tone: "coral" | "blue" | "mint";
  icon: typeof WalletCards;
};

const entries: DayEntry[] = [
  {
    id: "expense",
    time: "٠٩:١٥",
    eyebrow: "مراجعة مطلوبة",
    title: "غداء العمل مع محمود",
    detail: "١٬٢٥٠ ج.م",
    meta: "مصروف · منذ ساعتين",
    status: "ينتظر اعتمادك",
    tone: "coral",
    icon: WalletCards,
  },
  {
    id: "call",
    time: "١١:٣٠",
    eyebrow: "موعد قادم",
    title: "اتصال فريق التصميم",
    detail: "بعد ٤٨ دقيقة",
    meta: "مكالمة · القاهرة",
    status: "مجدول",
    tone: "blue",
    icon: CalendarDays,
  },
  {
    id: "draft",
    time: "١٦:٠٠",
    eyebrow: "مسودة اليوم",
    title: "ملف الربع الثالث",
    detail: "مستحق اليوم",
    meta: "مستند · آخر تعديل ٣٥ دقيقة",
    status: "مسودة",
    tone: "mint",
    icon: FileText,
  },
];

const records = [
  { id: "expense", title: "غداء العمل مع محمود", kind: "مصروف", meta: "١٬٢٥٠ ج.م · اليوم", tone: "coral", icon: WalletCards },
  { id: "person", title: "محمود", kind: "شخص", meta: "آخر تفاعل اليوم", tone: "blue", icon: MessageCircle },
  { id: "draft", title: "ملف الربع الثالث", kind: "مستند", meta: "مسودة · مستحق اليوم", tone: "mint", icon: FileText },
];

const starterChat: ChatLine[] = [
  { id: 1, role: "assistant", text: "رتّبت يومك على شكل مسار واضح. هناك قرار واحد يحتاجك الآن، ثم مكالمة في ١١:٣٠." },
  { id: 2, role: "assistant", text: "أبدأ بالمصروف أم أفتح لك تفاصيل اتصال التصميم؟" },
];

export default function SecretaryDaybookMobile() {
  const [view, setView] = useState<ViewId>("day");
  const [selected, setSelected] = useState<EntryId>("expense");
  const [approved, setApproved] = useState(false);
  const [recordOpen, setRecordOpen] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [chat, setChat] = useState<ChatLine[]>(starterChat);
  const [notice, setNotice] = useState("");

  const activeEntry = entries.find((entry) => entry.id === selected) ?? entries[0];
  const ActiveIcon = activeEntry.icon;
  const visibleRecords = records.filter((record) => `${record.title} ${record.kind}`.includes(query.trim()));

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2500);
  };

  const send = () => {
    const clean = draft.trim();
    if (!clean) return;
    const answer = clean.includes("مصروف")
      ? "تمام. جهّزت المصروف للمراجعة، ولن أحفظه قبل اعتمادك."
      : clean.includes("اتصال") || clean.includes("مكالمة")
        ? "اتصال فريق التصميم الساعة ١١:٣٠. سأذكّرك قبل الموعد بعشر دقائق."
        : "حاضر. أضفت طلبك إلى سياق اليوم وسأرتّب الخطوة التالية.";
    const id = Date.now();
    setChat((current) => [...current, { id, role: "user", text: clean }, { id: id + 1, role: "assistant", text: answer }]);
    setDraft("");
    setComposerOpen(false);
    showNotice("تم تحديث سياق اليوم");
  };

  const chooseEntry = (id: EntryId) => {
    setSelected(id);
    setView("day");
  };

  return (
    <main className="sdm-shell" dir="rtl">
      <style>{`
        .sdm-shell {
          --sdm-ink:#26363b; --sdm-muted:#78878a; --sdm-paper:#f0eee8; --sdm-card:#fffdf8;
          --sdm-line:#deddd5; --sdm-coral:#c9674f; --sdm-coral-soft:#f7e4dc; --sdm-blue:#4e7588;
          --sdm-blue-soft:#e2edf0; --sdm-mint:#4b8272; --sdm-mint-soft:#e3efe9; --sdm-shadow:0 18px 45px rgba(52,65,61,.09);
          min-height:100dvh; width:100%; overflow-x:hidden; color:var(--sdm-ink);
          background:radial-gradient(circle at 90% 0%, rgba(224,204,177,.42), transparent 34%), var(--sdm-paper);
          font-family:"IBM Plex Sans Arabic","Noto Sans Arabic",sans-serif; letter-spacing:-.018em;
        }
        .sdm-shell *, .sdm-shell *::before, .sdm-shell *::after { box-sizing:border-box; }
        .sdm-app { width:100%; min-height:100dvh; padding:0 14px 112px; }
        .sdm-topbar { position:sticky; top:0; z-index:5; display:flex; align-items:center; justify-content:space-between; min-height:68px; margin:0 -14px; padding:0 14px; border-bottom:1px solid rgba(222,221,213,.92); background:rgba(240,238,232,.94); backdrop-filter:blur(15px); }
        .sdm-brand, .sdm-tools, .sdm-brand-copy small, .sdm-date-row, .sdm-day-label, .sdm-entry-head, .sdm-entry-meta, .sdm-detail-head, .sdm-detail-kicker, .sdm-stat-row, .sdm-record-head, .sdm-record-meta { display:flex; align-items:center; }
        .sdm-brand { gap:9px; }
        .sdm-mark { display:grid; width:36px; height:36px; place-items:center; color:#fff9f1; border-radius:12px; background:var(--sdm-coral); box-shadow:0 8px 17px rgba(201,103,79,.19); }
        .sdm-brand-copy strong { display:block; font-size:13px; font-weight:850; }
        .sdm-brand-copy small { gap:5px; margin-top:2px; color:var(--sdm-muted); font-size:9px; }
        .sdm-dot { width:5px; height:5px; border-radius:50%; background:var(--sdm-mint); }
        .sdm-tools { gap:6px; }
        .sdm-icon { display:grid; width:37px; height:37px; place-items:center; padding:0; color:var(--sdm-muted); border:1px solid var(--sdm-line); border-radius:12px; background:rgba(255,253,248,.65); cursor:pointer; transition:transform .16s ease, background .16s ease; }
        .sdm-icon:active, .sdm-entry:active, .sdm-action:active, .sdm-record:active, .sdm-nav:active, .sdm-ask:active { transform:scale(.97); }
        .sdm-date-row { justify-content:space-between; padding:20px 2px 15px; }
        .sdm-date-row strong { display:block; font-size:20px; letter-spacing:-.055em; }
        .sdm-date-row span { display:block; margin-top:4px; color:var(--sdm-muted); font-size:10px; }
        .sdm-count { display:inline-flex; align-items:center; gap:6px; padding:8px 10px; color:var(--sdm-blue); border:1px solid #cbdde2; border-radius:11px; background:var(--sdm-blue-soft); font-size:9px; font-weight:850; }
        .sdm-count i { width:5px; height:5px; border-radius:50%; background:var(--sdm-blue); }
        .sdm-switcher { display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:4px; border:1px solid var(--sdm-line); border-radius:13px; background:rgba(222,221,213,.58); }
        .sdm-tab { display:flex; align-items:center; justify-content:center; gap:6px; min-height:38px; color:var(--sdm-muted); border:0; border-radius:9px; background:transparent; font:inherit; font-size:10px; cursor:pointer; }
        .sdm-tab.active { color:var(--sdm-ink); background:var(--sdm-card); box-shadow:0 4px 11px rgba(52,65,61,.08); font-weight:850; }
        .sdm-section-head { display:flex; align-items:end; justify-content:space-between; margin:18px 2px 9px; }
        .sdm-section-head strong { font-size:13px; }
        .sdm-section-head span { color:var(--sdm-muted); font-size:9px; }
        .sdm-daybook { position:relative; padding:2px 0 2px; }
        .sdm-daybook::before { position:absolute; top:14px; bottom:20px; right:34px; width:1px; background:#d8d8d0; content:""; }
        .sdm-day-label { gap:8px; margin:0 0 10px; color:var(--sdm-muted); font-size:9px; font-weight:850; }
        .sdm-day-label::before { width:9px; height:9px; border:2px solid var(--sdm-coral); border-radius:50%; background:var(--sdm-paper); content:""; }
        .sdm-entry { position:relative; display:grid; grid-template-columns:45px 1fr; gap:8px; width:100%; padding:0; color:var(--sdm-ink); border:0; background:transparent; font:inherit; text-align:right; cursor:pointer; }
        .sdm-time { padding-top:17px; color:var(--sdm-muted); font-size:9px; font-variant-numeric:tabular-nums; }
        .sdm-entry-card { position:relative; z-index:1; margin-bottom:9px; padding:12px; border:1px solid var(--sdm-line); border-radius:17px; background:rgba(255,253,248,.83); box-shadow:0 5px 14px rgba(52,65,61,.035); text-align:right; transition:transform .16s ease, border-color .16s ease, background .16s ease; }
        .sdm-entry.selected .sdm-entry-card { border-color:#e2b8aa; background:#fff8f3; box-shadow:var(--sdm-shadow); }
        .sdm-entry-head { justify-content:space-between; gap:7px; }
        .sdm-entry-title { display:flex; align-items:center; min-width:0; gap:8px; }
        .sdm-entry-icon { display:grid; flex:0 0 auto; width:31px; height:31px; place-items:center; border-radius:10px; }
        .sdm-entry-icon.coral, .sdm-record-icon.coral { color:var(--sdm-coral); background:var(--sdm-coral-soft); }
        .sdm-entry-icon.blue, .sdm-record-icon.blue { color:var(--sdm-blue); background:var(--sdm-blue-soft); }
        .sdm-entry-icon.mint, .sdm-record-icon.mint { color:var(--sdm-mint); background:var(--sdm-mint-soft); }
        .sdm-entry-title strong { display:block; overflow:hidden; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
        .sdm-status { color:var(--sdm-coral); font-size:8px; font-weight:850; white-space:nowrap; }
        .sdm-entry-eyebrow { margin:8px 0 0; color:var(--sdm-muted); font-size:8px; }
        .sdm-entry-meta { justify-content:space-between; gap:8px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(222,221,213,.82); color:var(--sdm-muted); font-size:8px; }
        .sdm-entry-meta strong { color:var(--sdm-coral); font-size:11px; }
        .sdm-detail { margin-top:14px; padding:14px; border:1px solid var(--sdm-line); border-radius:18px; background:rgba(255,253,248,.84); animation:sdm-rise .22s ease both; }
        .sdm-detail-head { justify-content:space-between; gap:9px; }
        .sdm-detail-kicker { gap:6px; color:var(--sdm-coral); font-size:9px; font-weight:850; }
        .sdm-detail-kicker i { width:6px; height:6px; border-radius:50%; background:currentColor; }
        .sdm-detail h2 { margin:7px 0 0; font-size:16px; letter-spacing:-.04em; }
        .sdm-detail-copy { margin:5px 0 0; color:var(--sdm-muted); font-size:9px; line-height:1.75; }
        .sdm-detail-footer { display:flex; align-items:end; justify-content:space-between; margin-top:13px; padding-top:11px; border-top:1px solid var(--sdm-line); }
        .sdm-detail-footer strong { font-size:21px; letter-spacing:-.06em; }
        .sdm-detail-footer span { color:var(--sdm-muted); font-size:9px; }
        .sdm-actions { display:flex; gap:6px; margin-top:11px; }
        .sdm-action { display:inline-flex; align-items:center; justify-content:center; gap:5px; min-height:38px; padding:0 11px; border-radius:10px; font:inherit; font-size:9px; font-weight:850; cursor:pointer; transition:transform .16s ease; }
        .sdm-action.primary { flex:1; color:#fff9f1; border:1px solid var(--sdm-coral); background:var(--sdm-coral); }
        .sdm-action.secondary { color:var(--sdm-muted); border:1px solid var(--sdm-line); background:var(--sdm-card); }
        .sdm-approved { display:flex; align-items:center; gap:6px; margin-top:11px; padding:10px; color:var(--sdm-mint); border-radius:10px; background:var(--sdm-mint-soft); font-size:9px; font-weight:850; }
        .sdm-records { display:grid; gap:8px; }
        .sdm-record-search { display:flex; align-items:center; gap:7px; margin-bottom:10px; padding:0 10px; border:1px solid var(--sdm-line); border-radius:11px; background:var(--sdm-card); }
        .sdm-record-search input { min-width:0; flex:1; height:35px; color:var(--sdm-ink); border:0; outline:0; background:transparent; font:inherit; font-size:10px; text-align:right; }
        .sdm-record { display:flex; align-items:center; gap:9px; width:100%; min-height:65px; padding:9px; color:var(--sdm-ink); border:1px solid var(--sdm-line); border-radius:15px; background:rgba(255,253,248,.82); font:inherit; text-align:right; cursor:pointer; }
        .sdm-record-icon { display:grid; flex:0 0 auto; width:35px; height:35px; place-items:center; border-radius:11px; }
        .sdm-record-copy { min-width:0; flex:1; }
        .sdm-record-copy strong { display:block; overflow:hidden; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
        .sdm-record-copy span { display:block; margin-top:4px; color:var(--sdm-muted); font-size:9px; }
        .sdm-record-meta { gap:5px; color:var(--sdm-muted); font-size:8px; }
        .sdm-record-empty { padding:22px 12px; color:var(--sdm-muted); border:1px dashed var(--sdm-line); border-radius:15px; font-size:10px; text-align:center; }
        .sdm-chat-note { display:flex; align-items:center; gap:8px; margin-top:15px; padding:11px; color:var(--sdm-blue); border:1px solid #cbdde2; border-radius:14px; background:var(--sdm-blue-soft); font-size:9px; line-height:1.65; }
        .sdm-chat-note strong { display:block; font-size:10px; }
        .sdm-chat-note span { display:block; margin-top:2px; }
        .sdm-bottom { position:fixed; z-index:6; right:0; bottom:0; left:0; display:grid; grid-template-columns:repeat(3,1fr); min-height:61px; padding:5px 9px max(5px,env(safe-area-inset-bottom)); border-top:1px solid var(--sdm-line); background:rgba(255,253,248,.97); box-shadow:0 -6px 20px rgba(52,65,61,.06); }
        .sdm-nav { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; color:#98a2a1; border:0; border-radius:11px; background:transparent; font:inherit; font-size:9px; cursor:pointer; }
        .sdm-nav.active { color:var(--sdm-coral); background:var(--sdm-coral-soft); font-weight:850; }
        .sdm-ask { position:fixed; z-index:7; right:15px; bottom:76px; display:flex; align-items:center; gap:7px; min-height:42px; padding:0 13px; color:#fff9f1; border:0; border-radius:14px; background:var(--sdm-blue); box-shadow:0 11px 24px rgba(78,117,136,.25); font:inherit; font-size:9px; font-weight:850; cursor:pointer; transition:transform .16s ease; }
        .sdm-overlay { position:fixed; z-index:9; inset:0; border:0; background:rgba(38,54,59,.26); }
        .sdm-sheet { position:fixed; z-index:10; right:0; bottom:0; left:0; padding:12px 14px calc(76px + env(safe-area-inset-bottom)); border-radius:23px 23px 0 0; background:var(--sdm-card); box-shadow:0 -18px 42px rgba(38,54,59,.17); animation:sdm-rise .2s ease both; }
        .sdm-sheet-handle { width:37px; height:4px; margin:0 auto 14px; border-radius:4px; background:#d4d1c7; }
        .sdm-sheet-head { display:flex; align-items:center; justify-content:space-between; }
        .sdm-sheet-head strong { font-size:15px; }
        .sdm-sheet-sub { margin:5px 0 10px; color:var(--sdm-muted); font-size:9px; }
        .sdm-chat-list { display:grid; gap:7px; max-height:175px; overflow:auto; padding:2px 0 7px; }
        .sdm-chat-line { width:fit-content; max-width:88%; padding:8px 10px; border-radius:12px; color:var(--sdm-ink); border:1px solid var(--sdm-line); background:#fbfaf6; font-size:10px; line-height:1.65; }
        .sdm-chat-line.user { justify-self:end; color:#fff9f1; border-color:var(--sdm-blue); background:var(--sdm-blue); }
        .sdm-suggestions { display:flex; gap:6px; overflow:auto; padding:2px 0 8px; scrollbar-width:none; }
        .sdm-suggestion { flex:0 0 auto; min-height:30px; padding:0 9px; color:var(--sdm-blue); border:1px solid #cbdde2; border-radius:9px; background:var(--sdm-blue-soft); font:inherit; font-size:8px; cursor:pointer; }
        .sdm-composer { display:flex; align-items:center; gap:3px; padding:4px; border:1px solid var(--sdm-line); border-radius:13px; background:#f8f7f2; }
        .sdm-composer input { min-width:0; flex:1; height:38px; padding:0 7px; color:var(--sdm-ink); border:0; outline:0; background:transparent; font:inherit; font-size:10px; text-align:right; }
        .sdm-compose-tool { display:grid; width:32px; height:36px; place-items:center; color:var(--sdm-muted); border:0; background:transparent; cursor:pointer; }
        .sdm-send { display:grid; width:37px; height:37px; place-items:center; color:#fff9f1; border:0; border-radius:10px; background:var(--sdm-coral); cursor:pointer; }
        .sdm-menu { position:fixed; z-index:12; top:0; right:0; bottom:0; width:min(82vw,300px); padding:20px 14px; background:var(--sdm-card); box-shadow:-18px 0 34px rgba(38,54,59,.16); animation:sdm-slide .2s ease both; }
        .sdm-menu-head { display:flex; align-items:center; justify-content:space-between; padding-bottom:16px; border-bottom:1px solid var(--sdm-line); }
        .sdm-menu-head strong { font-size:15px; }
        .sdm-menu-list { display:grid; gap:5px; margin-top:15px; }
        .sdm-menu-list button { display:flex; align-items:center; gap:10px; min-height:47px; padding:0 10px; color:var(--sdm-muted); border:0; border-radius:11px; background:transparent; font:inherit; font-size:11px; text-align:right; cursor:pointer; }
        .sdm-menu-list button:hover { color:var(--sdm-coral); background:var(--sdm-coral-soft); }
        .sdm-toast { position:fixed; z-index:15; right:14px; bottom:77px; left:14px; padding:10px; color:#fff9f1; border-radius:11px; background:var(--sdm-ink); font-size:10px; text-align:center; box-shadow:0 9px 24px rgba(38,54,59,.18); animation:sdm-rise .18s ease both; }
        @keyframes sdm-rise { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes sdm-slide { from { opacity:0; transform:translateX(18px); } to { opacity:1; transform:translateX(0); } }
        @media (min-width:640px) {
          .sdm-shell { display:grid; place-items:center; padding:22px; }
          .sdm-app { width:min(100%,430px); min-height:min(920px,100dvh - 44px); padding-bottom:112px; border:1px solid #d9d7cf; border-radius:30px; box-shadow:0 22px 65px rgba(52,65,61,.14); }
          .sdm-topbar { border-radius:30px 30px 0 0; }
          .sdm-bottom { right:50%; left:50%; width:min(430px,100%); transform:translateX(50%); }
          .sdm-ask { right:calc(50% - 199px); }
          .sdm-sheet { right:50%; left:50%; width:min(430px,100%); transform:translateX(50%); }
          .sdm-overlay { background:rgba(38,54,59,.18); }
        }
      `}</style>

      <div className="sdm-app">
        <header className="sdm-topbar">
          <div className="sdm-brand">
            <span className="sdm-mark"><Sparkles size={17} /></span>
            <span className="sdm-brand-copy"><strong>سكرتيري</strong><small><i className="sdm-dot" /> متاح الآن</small></span>
          </div>
          <div className="sdm-tools">
            <button className="sdm-icon" aria-label="التنبيهات" onClick={() => showNotice("لا توجد تنبيهات فائتة")}><Bell size={16} /></button>
            <button className="sdm-icon" aria-label="فتح القائمة" onClick={() => setMenuOpen(true)}><Menu size={18} /></button>
          </div>
        </header>

        <section className="sdm-date-row">
          <div><strong>يومك على الخريطة</strong><span>الخميس، ٢٤ أكتوبر · القاهرة</span></div>
          <span className="sdm-count"><i /> ٣ محطات اليوم</span>
        </section>

        <div className="sdm-switcher" role="tablist" aria-label="مساحة السكرتير">
          <button className={`sdm-tab ${view === "day" ? "active" : ""}`} onClick={() => setView("day")}><Clock3 size={13} /> دفتر اليوم</button>
          <button className={`sdm-tab ${view === "records" ? "active" : ""}`} onClick={() => setView("records")}><Archive size={13} /> المرجع</button>
        </div>

        {view === "day" ? (
          <>
            <div className="sdm-section-head"><strong>مسار الخميس</strong><span>مرتب حسب الوقت، لا حسب النوع</span></div>
            <section className="sdm-daybook" aria-label="دفتر اليوم">
              <div className="sdm-day-label">الآن · قرار يحتاجك</div>
              {entries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button className={`sdm-entry ${selected === entry.id ? "selected" : ""}`} key={entry.id} onClick={() => chooseEntry(entry.id)}>
                    <span className="sdm-time">{entry.time}</span>
                    <span className="sdm-entry-card">
                      <span className="sdm-entry-head">
                        <span className="sdm-entry-title"><span className={`sdm-entry-icon ${entry.tone}`}><Icon size={15} /></span><strong>{entry.title}</strong></span>
                        <span className="sdm-status">{entry.status}</span>
                      </span>
                      <span className="sdm-entry-eyebrow">{entry.eyebrow} · {entry.meta}</span>
                      <span className="sdm-entry-meta"><span>{entry.id === "expense" ? "مرتبط بالمحادثة الحالية" : "ضمن خطة اليوم"}</span><strong>{entry.detail}</strong></span>
                    </span>
                  </button>
                );
              })}
            </section>

            <article className="sdm-detail" key={activeEntry.id}>
              <div className="sdm-detail-head">
                <div><div className="sdm-detail-kicker"><i /> {activeEntry.eyebrow}</div><h2>{activeEntry.title}</h2><p className="sdm-detail-copy">{activeEntry.meta} · يمكنك العودة للسياق بعد الحفظ.</p></div>
                <span className={`sdm-entry-icon ${activeEntry.tone}`}><ActiveIcon size={16} /></span>
              </div>
              <div className="sdm-detail-footer"><strong>{activeEntry.detail}</strong><span>{activeEntry.id === "expense" ? "محمود · غداء العمل" : activeEntry.status}</span></div>
              {activeEntry.id === "expense" && !approved ? (
                <div className="sdm-actions">
                  <button className="sdm-action secondary" onClick={() => setComposerOpen(true)}><MoreHorizontal size={13} /> تعديل</button>
                  <button className="sdm-action primary" onClick={() => { setApproved(true); showNotice("تم اعتماد المصروف وحفظه في السجل"); }}><Check size={13} /> اعتماد وحفظ</button>
                </div>
              ) : activeEntry.id === "expense" ? (
                <div className="sdm-approved"><CheckCircle2 size={14} /> تم الاعتماد — أضيف إلى سجلاتك <button className="sdm-action secondary" onClick={() => setApproved(false)}>تراجع</button></div>
              ) : (
                <button className="sdm-action primary" onClick={() => showNotice(activeEntry.id === "call" ? "سأذكّرك قبل الاتصال بعشر دقائق" : "فتحت المسودة في سياق اليوم")}><TimerReset size={13} /> {activeEntry.id === "call" ? "فعّل التذكير" : "تابع المسودة"}</button>
              )}
            </article>

            <button className="sdm-chat-note" onClick={() => setComposerOpen(true)}>
              <MessageCircle size={16} />
              <span><strong>آخر ما قاله السكرتير</strong><span>{chat[chat.length - 1]?.text ?? "اكتب طلبك كما تتكلم."}</span></span>
              <ChevronLeft size={14} />
            </button>
          </>
        ) : (
          <>
            <div className="sdm-section-head"><strong>مرجعك المرتبط اليوم</strong><span>افتح السجل مع سياقه</span></div>
            <div className="sdm-record-search"><Search size={14} color="#78878a" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في السجلات..." aria-label="البحث في السجلات" /><Filter size={13} color="#78878a" /></div>
            <section className="sdm-records" aria-label="السجلات">
              {visibleRecords.length ? visibleRecords.map((record) => {
                const Icon = record.icon;
                return <button className="sdm-record" key={record.id} onClick={() => setRecordOpen(record.id)}><span className={`sdm-record-icon ${record.tone}`}><Icon size={16} /></span><span className="sdm-record-copy"><strong>{record.title}</strong><span>{record.kind} · {record.meta}</span></span><span className="sdm-record-meta"><ChevronLeft size={14} /> فتح</span></button>;
              }) : <div className="sdm-record-empty">لا توجد سجلات تطابق بحثك.</div>}
            </section>
            <button className="sdm-chat-note" onClick={() => { setComposerOpen(true); setDraft("سجّل شيء جديد"); }}><Sparkles size={16} /><span><strong>أضف سجلاً بصياغتك</strong><span>السكرتير سيجهزه للمراجعة قبل الحفظ.</span></span><ChevronLeft size={14} /></button>
          </>
        )}
      </div>

      <button className="sdm-ask" onClick={() => setComposerOpen(true)}><MessageCircle size={15} /> اسأل السكرتير</button>

      <nav className="sdm-bottom" aria-label="التنقل السفلي">
        <button className={`sdm-nav ${view === "day" ? "active" : ""}`} onClick={() => setView("day")}><LayoutList size={18} /> اليوم</button>
        <button className={`sdm-nav ${view === "records" ? "active" : ""}`} onClick={() => setView("records")}><Archive size={18} /> السجلات</button>
        <button className="sdm-nav" onClick={() => setComposerOpen(true)}><MessageCircle size={18} /> المحادثة</button>
      </nav>

      {recordOpen && (
        <>
          <button className="sdm-overlay" aria-label="إغلاق تفاصيل السجل" onClick={() => setRecordOpen(null)} />
          <section className="sdm-sheet">
            <div className="sdm-sheet-handle" />
            <div className="sdm-sheet-head"><strong>{records.find((record) => record.id === recordOpen)?.title}</strong><button className="sdm-icon" aria-label="إغلاق" onClick={() => setRecordOpen(null)}><X size={16} /></button></div>
            <p className="sdm-sheet-sub">هذا السجل مرتبط بمسار اليوم. قل «عدّل السجل» لأكمل من نفس السياق.</p>
            <button className="sdm-action primary" onClick={() => { setRecordOpen(null); setComposerOpen(true); setDraft("عدّل السجل"); }}>تحدث عن هذا السجل</button>
          </section>
        </>
      )}

      {composerOpen && (
        <>
          <button className="sdm-overlay" aria-label="إغلاق المحادثة" onClick={() => setComposerOpen(false)} />
          <section className="sdm-sheet">
            <div className="sdm-sheet-handle" />
            <div className="sdm-sheet-head"><strong>محادثة سياق اليوم</strong><button className="sdm-icon" aria-label="إغلاق" onClick={() => setComposerOpen(false)}><X size={16} /></button></div>
            <p className="sdm-sheet-sub">اطلب ما تريد بطريقتك، وسأبقي القرار في يدك قبل أي حفظ.</p>
            <div className="sdm-chat-list">{chat.slice(-4).map((line) => <div className={`sdm-chat-line ${line.role}`} key={line.id}>{line.text}</div>)}</div>
            <div className="sdm-suggestions">{["ما الأولوية؟", "سجّل مصروفاً", "ذكّرني بالاتصال"].map((item) => <button className="sdm-suggestion" key={item} onClick={() => setDraft(item)}>{item}</button>)}</div>
            <div className="sdm-composer">
              <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="اكتب طلبك كما تتكلم..." aria-label="اكتب طلبك" />
              <button className="sdm-compose-tool" aria-label="إرفاق ملف" onClick={() => showNotice("إرفاق ملف سيكون ضمن الرسالة التالية")}><Paperclip size={15} /></button>
              <button className="sdm-send" aria-label="إرسال الرسالة" onClick={send}><Send size={14} /></button>
            </div>
          </section>
        </>
      )}

      {menuOpen && (
        <>
          <button className="sdm-overlay" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} />
          <aside className="sdm-menu">
            <div className="sdm-menu-head"><strong>مساحات سكرتيرك</strong><button className="sdm-icon" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={16} /></button></div>
            <div className="sdm-menu-list">
              <button onClick={() => { setMenuOpen(false); setView("day"); }}><Clock3 size={16} /> دفتر اليوم</button>
              <button onClick={() => { setMenuOpen(false); setView("records"); }}><Archive size={16} /> المرجع والسجلات</button>
              <button onClick={() => { setMenuOpen(false); showNotice("تفضيلات المراجعة مفعّلة: لا حفظ بلا اعتماد"); }}><Settings2 size={16} /> تفضيلات المراجعة</button>
            </div>
          </aside>
        </>
      )}

      {notice && <button className="sdm-toast" role="status" onClick={() => setNotice("")}>{notice}</button>}
    </main>
  );
}