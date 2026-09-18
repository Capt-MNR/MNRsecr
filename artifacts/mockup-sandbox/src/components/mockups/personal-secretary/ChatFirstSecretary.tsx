import {
  Archive,
  ArrowDownLeft,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  FileText,
  LayoutDashboard,
  Menu,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";

type ChatMessage = {
  id: number;
  role: "assistant" | "user";
  text: string;
  time: string;
};

type RecordItem = {
  id: string;
  type: "expense" | "note" | "meeting";
  title: string;
  meta: string;
  amount?: string;
  accent: "coral" | "blue" | "mint";
};

const quickPrompts = [
  "إيه اللي محتاجه مني النهارده؟",
  "سجّل مصروف جديد",
  "فكّرني بمكالمة التصميم",
];

const initialMessages: ChatMessage[] = [
  {
    id: 1,
    role: "assistant",
    text: "صباح الخير يا كريم. أنا رتّبت لك يومك، ونبدأ من هنا بأي شيء في بالك.",
    time: "09:42",
  },
  {
    id: 2,
    role: "assistant",
    text: "في انتظار اعتماد مصروف غداء العمل بقيمة ١٬٢٥٠ ج.م، وبعدها عندك اتصال التصميم الساعة ١١:٣٠.",
    time: "09:43",
  },
];

const records: RecordItem[] = [
  {
    id: "lunch",
    type: "expense",
    title: "غداء العمل",
    meta: "محمود · منذ ساعتين",
    amount: "١٬٢٥٠ ج.م",
    accent: "coral",
  },
  {
    id: "design",
    type: "meeting",
    title: "اتصال فريق التصميم",
    meta: "اليوم · ١١:٣٠ ص",
    accent: "blue",
  },
  {
    id: "q3",
    type: "note",
    title: "ملف الربع الثالث",
    meta: "مستحق اليوم · مسودة",
    accent: "mint",
  },
];

const navItems = [
  { id: "assistant", label: "المساعد", icon: Sparkles },
  { id: "records", label: "السجلات", icon: Archive },
  { id: "today", label: "اليوم", icon: LayoutDashboard },
];

export default function ChatFirstSecretary() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [activeNav, setActiveNav] = useState("assistant");
  const [menuOpen, setMenuOpen] = useState(false);
  const [approved, setApproved] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);
  const [showAllMessages, setShowAllMessages] = useState(false);

  const choosePrompt = (prompt: string) => {
    setDraft(prompt);
    setActiveNav("assistant");
  };

  const sendMessage = () => {
    const cleanDraft = draft.trim();
    if (!cleanDraft) return;
    const answer = cleanDraft.includes("مصروف")
      ? "تمام. اكتب المبلغ والوصف، وأنا أجهز التسجيل للمراجعة قبل الحفظ."
      : cleanDraft.includes("مكالمة")
        ? "مكالمة فريق التصميم اليوم الساعة ١١:٣٠ ص. أضيف لك تذكيراً قبلها؟"
        : "حاضر. سأرتّب هذا لك وأرجع بالنتيجة هنا.";
    setMessages((current) => [
      ...current,
      { id: Date.now(), role: "user", text: cleanDraft, time: "الآن" },
      { id: Date.now() + 1, role: "assistant", text: answer, time: "الآن" },
    ]);
    setDraft("");
    setShowAllMessages(true);
  };

  const jumpToRecords = () => {
    setActiveNav("records");
    document.getElementById("chat-records")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const renderRecordIcon = (record: RecordItem) => {
    if (record.type === "expense") return <WalletCards size={17} />;
    if (record.type === "meeting") return <CalendarClock size={17} />;
    return <FileText size={17} />;
  };

  return (
    <main className="chat-first-shell" dir="rtl">
      <style>{`
        .chat-first-shell {
          --cf-ink: #1e2b35;
          --cf-sub: #71808a;
          --cf-paper: #f4f1ea;
          --cf-card: #fffcf7;
          --cf-line: #e3ddd3;
          --cf-coral: #de6d50;
          --cf-coral-soft: #fbe7df;
          --cf-blue: #416b8f;
          --cf-blue-soft: #e4edf3;
          --cf-mint: #3f8775;
          --cf-mint-soft: #e3f0e9;
          --cf-yellow: #e9b44c;
          min-height: 100dvh;
          color: var(--cf-ink);
          background:
            radial-gradient(circle at 8% 8%, rgba(222,109,80,.10), transparent 24rem),
            radial-gradient(circle at 85% 92%, rgba(63,135,117,.08), transparent 23rem),
            var(--cf-paper);
          font-family: "IBM Plex Sans Arabic", "Avenir Next", "Noto Sans Arabic", sans-serif;
          letter-spacing: -.015em;
        }
        .chat-first-shell *, .chat-first-shell *::before, .chat-first-shell *::after { box-sizing: border-box; }
        .cf-frame { width: min(100%, 1440px); min-height: 100dvh; margin: 0 auto; padding: 18px; }
        .cf-grid { display: grid; grid-template-columns: 214px minmax(0, 1fr); gap: 18px; min-height: calc(100dvh - 36px); direction: ltr; }
        .cf-main, .cf-rail { direction: rtl; }
        .cf-main { min-width: 0; }
        .cf-rail {
          display: flex;
          flex-direction: column;
          min-height: 100%;
          padding: 18px 14px;
          border: 1px solid rgba(227,221,211,.9);
          border-radius: 24px;
          background: rgba(255,252,247,.72);
          box-shadow: 0 16px 40px rgba(77,65,49,.055);
        }
        .cf-brand { display: flex; align-items: center; gap: 10px; padding: 3px 5px 28px; }
        .cf-brand-mark { display: grid; width: 38px; height: 38px; place-items: center; color: #fff9f2; border-radius: 13px; background: var(--cf-coral); box-shadow: 0 8px 20px rgba(222,109,80,.22); }
        .cf-brand strong { display: block; font-size: 14px; font-weight: 800; }
        .cf-brand small { display: flex; align-items: center; gap: 5px; margin-top: 3px; color: var(--cf-sub); font-size: 9px; }
        .cf-online { width: 6px; height: 6px; border-radius: 50%; background: var(--cf-mint); }
        .cf-rail-label { margin: 0 8px 9px; color: #a2a09a; font-size: 9px; font-weight: 800; letter-spacing: .10em; }
        .cf-nav { display: grid; gap: 5px; }
        .cf-nav-button {
          display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 0 11px;
          color: var(--cf-sub); border: 1px solid transparent; border-radius: 13px; background: transparent;
          font: inherit; font-size: 11px; text-align: right; cursor: pointer; transition: transform .18s ease, background .18s ease, color .18s ease;
        }
        .cf-nav-button:hover { transform: translateX(-2px); color: var(--cf-ink); background: rgba(244,241,234,.8); }
        .cf-nav-button.active { color: var(--cf-coral); border-color: #f0d8ce; background: var(--cf-coral-soft); font-weight: 800; }
        .cf-nav-icon { display: grid; width: 27px; height: 27px; place-items: center; border-radius: 9px; background: rgba(255,255,255,.65); }
        .cf-nav-button.active .cf-nav-icon { background: rgba(255,255,255,.62); }
        .cf-rail-spacer { flex: 1; min-height: 22px; }
        .cf-rail-note { padding: 12px 11px; border: 1px solid #e5ded4; border-radius: 16px; background: #f8f4ee; }
        .cf-rail-note-top { display: flex; align-items: center; justify-content: space-between; color: var(--cf-sub); font-size: 9px; }
        .cf-rail-note strong { display: block; margin-top: 9px; font-size: 12px; line-height: 1.55; }
        .cf-rail-note p { margin: 6px 0 0; color: var(--cf-sub); font-size: 9px; line-height: 1.55; }
        .cf-rail-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 15px; padding: 0 4px; color: var(--cf-sub); font-size: 9px; }
        .cf-rail-user { display: flex; align-items: center; gap: 7px; }
        .cf-avatar { display: grid; width: 25px; height: 25px; place-items: center; color: #fff9f2; border-radius: 9px; background: var(--cf-blue); font-size: 10px; font-weight: 800; }
        .cf-icon-button {
          display: grid; width: 34px; height: 34px; place-items: center; padding: 0; color: var(--cf-sub);
          border: 1px solid var(--cf-line); border-radius: 11px; background: rgba(255,252,247,.78); cursor: pointer;
          transition: transform .18s ease, background .18s ease;
        }
        .cf-icon-button:hover { transform: translateY(-2px); background: var(--cf-card); }
        .cf-topbar { display: flex; align-items: center; justify-content: space-between; min-height: 52px; margin-bottom: 14px; }
        .cf-breadcrumb { display: flex; align-items: center; gap: 9px; color: var(--cf-sub); font-size: 10px; }
        .cf-breadcrumb strong { color: var(--cf-ink); font-size: 13px; }
        .cf-top-actions { display: flex; align-items: center; gap: 7px; }
        .cf-menu-button { display: none; }
        .cf-live { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; color: var(--cf-mint); border: 1px solid #c9e0d7; border-radius: 9px; background: var(--cf-mint-soft); font-size: 9px; font-weight: 800; }
        .cf-live i { width: 5px; height: 5px; border-radius: 50%; background: var(--cf-mint); }
        .cf-chat-stage { overflow: hidden; border: 1px solid var(--cf-line); border-radius: 26px; background: rgba(255,252,247,.89); box-shadow: 0 19px 55px rgba(72,62,49,.08); }
        .cf-stage-head { display: flex; align-items: center; justify-content: space-between; padding: 19px 22px 15px; border-bottom: 1px solid var(--cf-line); }
        .cf-stage-title { display: flex; align-items: center; gap: 11px; }
        .cf-stage-orb { display: grid; width: 38px; height: 38px; place-items: center; color: #fff9f2; border-radius: 13px; background: var(--cf-blue); box-shadow: 0 7px 16px rgba(65,107,143,.2); }
        .cf-stage-title strong { display: block; font-size: 15px; font-weight: 800; }
        .cf-stage-title span { display: block; margin-top: 3px; color: var(--cf-sub); font-size: 10px; }
        .cf-stage-tools { display: flex; align-items: center; gap: 7px; }
        .cf-stage-body { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(230px, .7fr); gap: 0; direction: ltr; }
        .cf-conversation { min-width: 0; padding: 21px 23px 23px; direction: rtl; }
        .cf-context { padding: 21px 19px; border-right: 1px solid var(--cf-line); direction: rtl; background: rgba(248,244,238,.66); }
        .cf-context-kicker { margin: 0; color: var(--cf-coral); font-size: 9px; font-weight: 800; letter-spacing: .10em; }
        .cf-context h2 { margin: 7px 0 0; font-size: 18px; line-height: 1.45; }
        .cf-context-copy { margin: 8px 0 18px; color: var(--cf-sub); font-size: 10px; line-height: 1.75; }
        .cf-context-list { display: grid; gap: 9px; }
        .cf-context-item { display: flex; gap: 8px; padding: 10px; border: 1px solid var(--cf-line); border-radius: 13px; background: rgba(255,252,247,.72); }
        .cf-context-item-mark { display: grid; flex: 0 0 auto; width: 25px; height: 25px; place-items: center; color: var(--cf-blue); border-radius: 8px; background: var(--cf-blue-soft); }
        .cf-context-item strong { display: block; font-size: 10px; }
        .cf-context-item span { display: block; margin-top: 3px; color: var(--cf-sub); font-size: 9px; line-height: 1.45; }
        .cf-context-foot { display: flex; align-items: center; gap: 5px; margin-top: 15px; color: var(--cf-sub); font-size: 9px; }
        .cf-context-foot svg { color: var(--cf-mint); }
        .cf-message-list { display: grid; gap: 11px; min-height: 290px; max-height: 355px; overflow-y: auto; padding: 0 3px 8px; scrollbar-width: thin; scrollbar-color: #d9d0c5 transparent; }
        .cf-message { max-width: min(84%, 610px); padding: 12px 14px; border-radius: 16px; font-size: 12px; line-height: 1.8; }
        .cf-message.assistant { justify-self: start; color: var(--cf-ink); border: 1px solid var(--cf-line); border-top-right-radius: 5px; background: #fbf9f5; }
        .cf-message.user { justify-self: end; color: #fff9f2; border: 1px solid var(--cf-blue); border-top-left-radius: 5px; background: var(--cf-blue); }
        .cf-message-meta { display: flex; align-items: center; gap: 6px; margin-top: 6px; opacity: .56; font-size: 8px; }
        .cf-message-meta svg { flex: 0 0 auto; }
        .cf-message-badge { display: inline-flex; align-items: center; gap: 5px; margin-bottom: 8px; color: var(--cf-coral); font-size: 9px; font-weight: 800; }
        .cf-message-badge i { display: block; width: 5px; height: 5px; border-radius: 50%; background: var(--cf-coral); }
        .cf-action-card { margin-top: 9px; padding: 13px; border: 1px solid #efd4ca; border-radius: 14px; background: #fff7f2; }
        .cf-action-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .cf-action-card-head strong { font-size: 11px; }
        .cf-awaiting { color: var(--cf-coral); font-size: 9px; font-weight: 800; }
        .cf-action-card p { margin: 8px 0 11px; color: var(--cf-sub); font-size: 10px; line-height: 1.65; }
        .cf-action-row { display: flex; align-items: center; justify-content: space-between; padding-top: 10px; border-top: 1px solid #f0ddd5; }
        .cf-action-row strong { font-size: 15px; }
        .cf-action-row span { color: var(--cf-sub); font-size: 9px; }
        .cf-action-actions { display: flex; gap: 6px; margin-top: 10px; }
        .cf-action-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 32px; padding: 0 11px; border-radius: 9px; font: inherit; font-size: 10px; font-weight: 800; cursor: pointer; transition: transform .18s ease, opacity .18s ease; }
        .cf-action-button:hover { transform: translateY(-1px); }
        .cf-action-button.primary { color: #fff9f2; border: 1px solid var(--cf-coral); background: var(--cf-coral); }
        .cf-action-button.secondary { color: var(--cf-sub); border: 1px solid var(--cf-line); background: var(--cf-card); }
        .cf-approved { display: inline-flex; align-items: center; gap: 6px; color: var(--cf-mint); font-size: 10px; font-weight: 800; }
        .cf-composer { display: flex; align-items: center; gap: 6px; margin-top: 12px; padding: 6px 7px 6px 6px; border: 1px solid var(--cf-line); border-radius: 14px; background: #f8f5ef; }
        .cf-composer input { min-width: 0; flex: 1; height: 32px; padding: 0 6px; color: var(--cf-ink); border: 0; outline: 0; background: transparent; font: inherit; font-size: 11px; text-align: right; }
        .cf-composer input::placeholder { color: #9aa4a7; }
        .cf-composer-tools { display: flex; gap: 1px; }
        .cf-composer-tool { display: grid; width: 27px; height: 27px; place-items: center; color: var(--cf-sub); border: 0; background: transparent; cursor: pointer; }
        .cf-send { display: grid; width: 31px; height: 31px; place-items: center; color: #fff9f2; border: 0; border-radius: 10px; background: var(--cf-coral); cursor: pointer; }
        .cf-prompt-line { display: flex; align-items: center; gap: 7px; margin-top: 13px; color: var(--cf-sub); font-size: 9px; font-weight: 800; }
        .cf-prompt-line svg { color: var(--cf-yellow); }
        .cf-prompt-list { display: flex; gap: 6px; overflow-x: auto; padding: 8px 0 1px; scrollbar-width: none; }
        .cf-prompt-list::-webkit-scrollbar { display: none; }
        .cf-prompt { flex: 0 0 auto; padding: 7px 10px; color: var(--cf-blue); border: 1px solid #ccdce7; border-radius: 9px; background: var(--cf-blue-soft); font: inherit; font-size: 9px; cursor: pointer; transition: transform .18s ease, background .18s ease; }
        .cf-prompt:hover { transform: translateY(-1px); background: #d8e7ef; }
        .cf-record-section { margin-top: 17px; scroll-margin-top: 14px; }
        .cf-record-head { display: flex; align-items: end; justify-content: space-between; margin-bottom: 10px; }
        .cf-record-head h2 { margin: 0; font-size: 15px; }
        .cf-record-head p { margin: 4px 0 0; color: var(--cf-sub); font-size: 10px; }
        .cf-record-link { display: inline-flex; align-items: center; gap: 3px; padding: 0; color: var(--cf-coral); border: 0; background: transparent; font: inherit; font-size: 10px; font-weight: 800; cursor: pointer; }
        .cf-record-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
        .cf-record {
          display: flex; align-items: center; gap: 9px; min-height: 73px; width: 100%; padding: 10px 11px; color: var(--cf-ink);
          border: 1px solid var(--cf-line); border-radius: 15px; background: rgba(255,252,247,.92); font: inherit; text-align: right; cursor: pointer;
          transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
        }
        .cf-record:hover, .cf-record.expanded { transform: translateY(-2px); border-color: #d5c9bb; box-shadow: 0 9px 20px rgba(80,68,52,.08); }
        .cf-record-mark { display: grid; flex: 0 0 auto; width: 33px; height: 33px; place-items: center; border-radius: 11px; }
        .cf-record-mark.coral { color: var(--cf-coral); background: var(--cf-coral-soft); }
        .cf-record-mark.blue { color: var(--cf-blue); background: var(--cf-blue-soft); }
        .cf-record-mark.mint { color: var(--cf-mint); background: var(--cf-mint-soft); }
        .cf-record-copy { min-width: 0; flex: 1; }
        .cf-record-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
        .cf-record-copy span { display: block; margin-top: 4px; overflow: hidden; color: var(--cf-sub); text-overflow: ellipsis; white-space: nowrap; font-size: 9px; }
        .cf-record-meta { display: flex; align-items: center; gap: 5px; margin-top: 5px; color: var(--cf-coral); font-size: 9px; font-weight: 800; }
        .cf-record-arrow { color: #a3a9a6; }
        .cf-record-expand { grid-column: 1 / -1; padding: 10px 14px; color: var(--cf-sub); border: 1px solid var(--cf-line); border-radius: 12px; background: rgba(248,244,238,.75); font-size: 10px; line-height: 1.7; }
        .cf-record-expand strong { color: var(--cf-ink); }
        .cf-mobile-drawer { display: none; }
        @media (max-width: 920px) {
          .cf-stage-body { grid-template-columns: minmax(0, 1fr); }
          .cf-context { display: none; }
        }
        @media (max-width: 720px) {
          .cf-frame { padding: 0; }
          .cf-grid { display: block; min-height: 100dvh; }
          .cf-rail { display: none; }
          .cf-main { min-height: 100dvh; padding: 0 13px 18px; }
          .cf-topbar { min-height: 68px; margin-bottom: 10px; }
          .cf-menu-button { display: grid; }
          .cf-breadcrumb strong { font-size: 12px; }
          .cf-live { display: none; }
          .cf-chat-stage { border-radius: 21px; }
          .cf-stage-head { padding: 15px 15px 13px; }
          .cf-conversation { padding: 16px 14px 18px; }
          .cf-message-list { min-height: 325px; }
          .cf-record-grid { grid-template-columns: 1fr; }
          .cf-record { min-height: 62px; }
          .cf-mobile-drawer { position: fixed; z-index: 20; inset: 0; display: block; pointer-events: none; }
          .cf-mobile-drawer.open { pointer-events: auto; }
          .cf-mobile-scrim { position: absolute; inset: 0; border: 0; background: rgba(30,43,53,.22); opacity: 0; cursor: pointer; transition: opacity .18s ease; }
          .cf-mobile-drawer.open .cf-mobile-scrim { opacity: 1; }
          .cf-mobile-panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(82vw, 310px); padding: 20px 16px; border-left: 1px solid var(--cf-line); background: var(--cf-card); box-shadow: -18px 0 35px rgba(30,43,53,.13); transform: translateX(104%); transition: transform .2s ease; }
          .cf-mobile-drawer.open .cf-mobile-panel { transform: translateX(0); }
          .cf-mobile-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 17px; border-bottom: 1px solid var(--cf-line); }
          .cf-mobile-head strong { font-size: 15px; }
          .cf-mobile-nav { display: grid; gap: 6px; margin-top: 17px; }
        }
      `}</style>

      <div className="cf-frame">
        <div className="cf-grid">
          <aside className="cf-rail">
            <div className="cf-brand">
              <span className="cf-brand-mark"><Sparkles size={18} /></span>
              <span><strong>سكرتيري</strong><small><i className="cf-online" /> متاح الآن</small></span>
            </div>
            <p className="cf-rail-label">مساحتك</p>
            <nav className="cf-nav" aria-label="التنقل الرئيسي">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={`cf-nav-button ${activeNav === item.id ? "active" : ""}`}
                    key={item.id}
                    onClick={() => item.id === "records" ? jumpToRecords() : setActiveNav(item.id)}
                  >
                    <span className="cf-nav-icon"><Icon size={16} /></span>{item.label}
                  </button>
                );
              })}
            </nav>
            <div className="cf-rail-spacer" />
            <div className="cf-rail-note">
              <div className="cf-rail-note-top"><span>اقتراح السكرتير</span><Zap size={13} color="var(--cf-yellow)" /></div>
              <strong>اسألني بصوتك أو اكتب كما تتكلم.</strong>
              <p>سأفهم السياق وأحفظه في المكان الصحيح.</p>
            </div>
            <div className="cf-rail-footer">
              <span className="cf-rail-user"><i className="cf-avatar">ك</i> كريم</span>
              <button className="cf-icon-button" aria-label="التفضيلات"><Settings2 size={15} /></button>
            </div>
          </aside>

          <section className="cf-main">
            <header className="cf-topbar">
              <div className="cf-breadcrumb">
                <button className="cf-icon-button cf-menu-button" aria-label="فتح القائمة" onClick={() => setMenuOpen(true)}><Menu size={17} /></button>
                <span><strong>صباح هادئ، كريم</strong><br />الخميس، ٢٤ أكتوبر · القاهرة</span>
              </div>
              <div className="cf-top-actions">
                <span className="cf-live"><i /> كل شيء يعمل</span>
                <button className="cf-icon-button" aria-label="البحث"><Search size={15} /></button>
                <button className="cf-icon-button" aria-label="الإشعارات"><Bell size={15} /></button>
              </div>
            </header>

            <section className="cf-chat-stage" aria-label="محادثة المساعد">
              <div className="cf-stage-head">
                <div className="cf-stage-title">
                  <span className="cf-stage-orb"><Sparkles size={18} /></span>
                  <span><strong>المساعد الشخصي</strong><span>يفهم سياقك، وليس فقط كلماتك</span></span>
                </div>
                <div className="cf-stage-tools">
                  <span className="cf-live"><i /> مباشر</span>
                  <button className="cf-icon-button" aria-label="خيارات المحادثة"><MoreHorizontal size={16} /></button>
                </div>
              </div>
              <div className="cf-stage-body">
                <div className="cf-conversation">
                  <div className="cf-message-list">
                    {(showAllMessages ? messages : messages.slice(-2)).map((message) => (
                      <div className={`cf-message ${message.role}`} key={message.id}>
                        {message.role === "assistant" && <span className="cf-message-badge"><i /> سكرتيري</span>}
                        {message.text}
                        <div className="cf-message-meta">
                          {message.role === "assistant" ? <Sparkles size={10} /> : <Check size={10} />}
                          {message.time}
                        </div>
                      </div>
                    ))}
                    {messages.length === 2 && (
                      <div className="cf-action-card">
                        <div className="cf-action-card-head"><strong>تسجيل مصروف بانتظارك</strong>{approved ? <span className="cf-approved"><CheckCircle2 size={13} /> تم الاعتماد</span> : <span className="cf-awaiting">قرارك أولاً</span>}</div>
                        {!approved ? (
                          <>
                            <p>ذكرت أن محمود دفع معك في غداء العمل. راجع التفاصيل قبل أن أضيفها إلى سجلاتك.</p>
                            <div className="cf-action-row"><strong>١٬٢٥٠ ج.م</strong><span>غداء العمل · محمود</span></div>
                            <div className="cf-action-actions">
                              <button className="cf-action-button primary" onClick={() => setApproved(true)}><Check size={13} /> اعتماد وحفظ</button>
                              <button className="cf-action-button secondary" onClick={() => choosePrompt("عدّل مصروف غداء العمل")}><MoreHorizontal size={14} /> تعديل</button>
                            </div>
                          </>
                        ) : <p style={{ marginBottom: 0 }}>أضفته إلى السجلات. يمكنك الرجوع إليه من الأسفل في أي وقت.</p>}
                      </div>
                    )}
                  </div>
                  <div className="cf-composer">
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") sendMessage(); }}
                      placeholder="اكتب طلبك كما تتكلم..."
                      aria-label="اكتب طلبك"
                    />
                    <div className="cf-composer-tools">
                      <button className="cf-composer-tool" aria-label="إرفاق ملف"><Paperclip size={14} /></button>
                      <button className="cf-composer-tool" aria-label="تسجيل صوتي"><Mic size={14} /></button>
                    </div>
                    <button className="cf-send" aria-label="إرسال الرسالة" onClick={sendMessage}><Send size={14} /></button>
                  </div>
                  <div className="cf-prompt-line"><Zap size={13} /> ابدأ من هنا</div>
                  <div className="cf-prompt-list">
                    {quickPrompts.map((prompt) => <button className="cf-prompt" key={prompt} onClick={() => choosePrompt(prompt)}>{prompt}</button>)}
                  </div>
                </div>
                <aside className="cf-context">
                  <p className="cf-context-kicker">الصورة الأكبر</p>
                  <h2>أنا متابع الخيط.</h2>
                  <p className="cf-context-copy">أبقي التفاصيل المهمة قريبة، حتى لا تضطر لفتح شاشة أخرى لتتذكر ما بدأته.</p>
                  <div className="cf-context-list">
                    <div className="cf-context-item"><span className="cf-context-item-mark"><ShieldCheck size={14} /></span><span><strong>قرار واحد</strong><span>مصروف ينتظر اعتمادك</span></span></div>
                    <div className="cf-context-item"><span className="cf-context-item-mark"><CalendarClock size={14} /></span><span><strong>موعد قادم</strong><span>اتصال التصميم بعد ٤٨ دقيقة</span></span></div>
                    <div className="cf-context-item"><span className="cf-context-item-mark"><Archive size={14} /></span><span><strong>ثلاثة سجلات</strong><span>جاهزة للرجوع إليها بالأسفل</span></span></div>
                  </div>
                  <div className="cf-context-foot"><CheckCircle2 size={13} /> لا توجد تنبيهات فائتة</div>
                </aside>
              </div>
            </section>

            <section className="cf-record-section" id="chat-records">
              <div className="cf-record-head">
                <div><h2>السجلات، تحت المحادثة</h2><p>كل ما حفظته مع سكرتيرك — في لمحة واحدة.</p></div>
                <button className="cf-record-link" onClick={() => setActiveNav("records")}>عرض الكل <ChevronLeft size={13} /></button>
              </div>
              <div className="cf-record-grid">
                {records.map((record) => (
                  <button className={`cf-record ${expandedRecord === record.id ? "expanded" : ""}`} key={record.id} onClick={() => setExpandedRecord(expandedRecord === record.id ? null : record.id)}>
                    <span className={`cf-record-mark ${record.accent}`}>{renderRecordIcon(record)}</span>
                    <span className="cf-record-copy">
                      <strong>{record.title}</strong>
                      <span>{record.meta}</span>
                      {record.amount && <span className="cf-record-meta">{record.amount} <ArrowDownLeft size={11} /></span>}
                    </span>
                    <ChevronDown className="cf-record-arrow" size={15} style={{ transform: expandedRecord === record.id ? "rotate(180deg)" : "none" }} />
                  </button>
                ))}
                {expandedRecord && (
                  <div className="cf-record-expand">
                    <strong>{records.find((record) => record.id === expandedRecord)?.title}</strong> — هذا السجل مرتبط بالمحادثة الحالية. يمكنك أن تقول «عدّل السجل» وسأفتح التفاصيل مع الحفاظ على السياق.
                  </div>
                )}
              </div>
            </section>
          </section>
        </div>
      </div>

      <div className={`cf-mobile-drawer ${menuOpen ? "open" : ""}`}>
        <button className="cf-mobile-scrim" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} />
        <aside className="cf-mobile-panel">
          <div className="cf-mobile-head"><strong>مساحات سكرتيرك</strong><button className="cf-icon-button" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={16} /></button></div>
          <nav className="cf-mobile-nav" aria-label="التنقل على الهاتف">
            {navItems.map((item) => {
              const Icon = item.icon;
              return <button className={`cf-nav-button ${activeNav === item.id ? "active" : ""}`} key={item.id} onClick={() => { item.id === "records" ? jumpToRecords() : setActiveNav(item.id); setMenuOpen(false); }}><span className="cf-nav-icon"><Icon size={16} /></span>{item.label}</button>;
            })}
          </nav>
          <p className="cf-rail-note" style={{ marginTop: 24 }}>أبقي تفاصيلك قريبة، وأترك لك مساحة الكلام.</p>
        </aside>
      </div>
    </main>
  );
}