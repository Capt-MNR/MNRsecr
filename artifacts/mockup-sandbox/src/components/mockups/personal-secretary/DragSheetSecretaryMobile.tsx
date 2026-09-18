import {
  Archive,
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
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";

type Message = {
  id: number;
  role: "assistant" | "user";
  text: string;
  time: string;
};

type SheetTab = "records" | "context";

const prompts = ["ما الأولوية الآن؟", "سجّل مصروفاً", "ذكّرني بالاتصال"];

const records = [
  {
    id: "expense",
    title: "غداء العمل",
    meta: "محمود · منذ ساعتين",
    detail: "١٬٢٥٠ ج.م",
    tone: "coral",
    icon: WalletCards,
  },
  {
    id: "meeting",
    title: "اتصال فريق التصميم",
    meta: "اليوم · ١١:٣٠ ص",
    detail: "بعد ٤٨ دقيقة",
    tone: "blue",
    icon: CalendarClock,
  },
  {
    id: "file",
    title: "ملف الربع الثالث",
    meta: "مستحق اليوم · مسودة",
    detail: "آخر تعديل منذ ٣٥ دقيقة",
    tone: "mint",
    icon: FileText,
  },
] as const;

const initialMessages: Message[] = [
  {
    id: 1,
    role: "assistant",
    text: "صباح الخير يا كريم. أنا هنا، ونقدر نبدأ من أي شيء في بالك.",
    time: "٠٩:٤٢",
  },
  {
    id: 2,
    role: "assistant",
    text: "عندك قرار واحد ينتظر اعتمادك، وبعده اتصال التصميم الساعة ١١:٣٠.",
    time: "٠٩:٤٣",
  },
];

const snapPoints = [0, 35, 76];

export default function DragSheetSecretaryMobile() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [approved, setApproved] = useState(false);
  const [sheetTab, setSheetTab] = useState<SheetTab>("records");
  const [sheetPosition, setSheetPosition] = useState(76);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const [activeRecord, setActiveRecord] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const dragState = useRef({ startY: 0, startPosition: 76, dragging: false });

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
  };

  const snapSheet = (position: number) => {
    setDragPosition(null);
    setSheetPosition(position);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const sheetHeight = sheetRef.current?.offsetHeight ?? 520;
    dragState.current = {
      startY: event.clientY,
      startPosition: sheetPosition,
      dragging: true,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.sheetHeight = String(sheetHeight);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.dragging) return;
    const sheetHeight = Number(event.currentTarget.dataset.sheetHeight) || 520;
    const movement = ((event.clientY - dragState.current.startY) / sheetHeight) * 100;
    const next = Math.max(0, Math.min(82, dragState.current.startPosition + movement));
    setDragPosition(next);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.dragging) return;
    dragState.current.dragging = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const current = dragPosition ?? sheetPosition;
    const nearest = snapPoints.reduce((closest, point) =>
      Math.abs(point - current) < Math.abs(closest - current) ? point : closest,
    );
    snapSheet(nearest);
  };

  const openRecord = (recordId: string) => {
    setActiveRecord(recordId);
    setSheetTab("records");
    setSheetPosition(35);
  };

  const selectedRecord = records.find((record) => record.id === activeRecord);
  const visiblePosition = dragPosition ?? sheetPosition;

  return (
    <main className="dss-shell" dir="rtl">
      <style>{`
        .dss-shell {
          --ink: #20333b;
          --sub: #77878a;
          --paper: #edf0eb;
          --card: #fbfcf8;
          --line: #d9e0da;
          --coral: #c85e4c;
          --coral-soft: #f8e5de;
          --blue: #456d83;
          --blue-soft: #e2edf0;
          --mint: #3f7d70;
          --mint-soft: #e2f0eb;
          width: 100%;
          min-height: 100dvh;
          overflow: hidden;
          color: var(--ink);
          background:
            radial-gradient(circle at 100% 0%, rgba(207, 225, 218, .56), transparent 32%),
            var(--paper);
          font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", sans-serif;
          letter-spacing: -.018em;
        }
        .dss-shell *, .dss-shell *::before, .dss-shell *::after { box-sizing: border-box; }
        .dss-app {
          width: 100%;
          min-height: 100dvh;
          padding: 0 15px 178px;
        }
        .dss-header {
          position: sticky;
          z-index: 2;
          top: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 68px;
          margin: 0 -15px;
          padding: 0 15px;
          border-bottom: 1px solid rgba(217, 224, 218, .86);
          background: rgba(237, 240, 235, .9);
          backdrop-filter: blur(15px);
        }
        .dss-header-side, .dss-header-actions, .dss-chat-tools { display: flex; align-items: center; gap: 8px; }
        .dss-avatar {
          display: grid;
          width: 36px;
          height: 36px;
          place-items: center;
          color: #fff9f2;
          border-radius: 13px;
          background: var(--coral);
          box-shadow: 0 8px 18px rgba(200, 94, 76, .17);
        }
        .dss-header-copy strong { display: block; font-size: 13px; font-weight: 850; }
        .dss-header-copy small { display: flex; align-items: center; gap: 5px; margin-top: 2px; color: var(--sub); font-size: 9px; }
        .dss-online { width: 5px; height: 5px; border-radius: 50%; background: var(--mint); }
        .dss-icon {
          display: grid;
          width: 39px;
          height: 39px;
          place-items: center;
          color: var(--sub);
          border: 1px solid var(--line);
          border-radius: 12px;
          background: rgba(251, 252, 248, .62);
          cursor: pointer;
        }
        .dss-icon:active, .dss-action:active, .dss-prompt:active, .dss-record:active, .dss-nav-button:active { transform: scale(.97); }
        .dss-date-strip { display: flex; align-items: center; justify-content: space-between; padding: 16px 1px 14px; }
        .dss-date-copy { color: var(--sub); font-size: 10px; }
        .dss-date-copy strong { display: block; margin-bottom: 2px; color: var(--ink); font-size: 14px; }
        .dss-live { display: inline-flex; align-items: center; gap: 6px; padding: 8px 9px; color: var(--mint); border: 1px solid #c4ded7; border-radius: 10px; background: var(--mint-soft); font-size: 9px; font-weight: 850; }
        .dss-live i { width: 5px; height: 5px; border-radius: 50%; background: var(--mint); }
        .dss-chat {
          overflow: hidden;
          min-height: calc(100dvh - 183px);
          border: 1px solid var(--line);
          border-radius: 23px;
          background: rgba(251, 252, 248, .84);
          box-shadow: 0 17px 36px rgba(57, 74, 67, .08);
        }
        .dss-chat-head { display: flex; align-items: center; justify-content: space-between; padding: 15px 14px 13px; border-bottom: 1px solid var(--line); }
        .dss-chat-person { display: flex; align-items: center; gap: 9px; }
        .dss-orb { display: grid; width: 37px; height: 37px; place-items: center; color: #fff9f2; border-radius: 12px; background: var(--blue); box-shadow: 0 7px 15px rgba(69, 109, 131, .18); }
        .dss-chat-person strong { display: block; font-size: 13px; }
        .dss-chat-person span span { display: block; margin-top: 2px; color: var(--sub); font-size: 9px; }
        .dss-chat-tools .dss-icon { width: 34px; height: 34px; border: 0; background: transparent; }
        .dss-messages { display: flex; flex-direction: column; gap: 13px; min-height: 355px; max-height: calc(100dvh - 328px); overflow-y: auto; padding: 20px 13px 16px; overscroll-behavior: contain; }
        .dss-message { width: fit-content; max-width: 88%; padding: 11px 12px; border-radius: 17px; font-size: 12px; line-height: 1.85; animation: dss-rise .25s ease both; }
        .dss-message.assistant { align-self: flex-start; border: 1px solid var(--line); border-top-right-radius: 5px; background: #f8faf6; }
        .dss-message.user { align-self: flex-end; color: #fff9f2; border: 1px solid var(--blue); border-top-left-radius: 5px; background: var(--blue); }
        .dss-message-label { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; color: var(--coral); font-size: 9px; font-weight: 850; }
        .dss-message-label i { width: 5px; height: 5px; border-radius: 50%; background: var(--coral); }
        .dss-message-meta { display: flex; align-items: center; gap: 5px; margin-top: 6px; opacity: .58; font-size: 8px; }
        .dss-approval { margin: 0 12px 15px; padding: 13px; border: 1px solid #edd0c7; border-radius: 15px; background: #fff5f0; }
        .dss-approval-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; font-weight: 850; }
        .dss-pending { color: var(--coral); font-size: 9px; }
        .dss-approval p { margin: 8px 0 10px; color: var(--sub); font-size: 10px; line-height: 1.7; }
        .dss-amount { display: flex; align-items: end; justify-content: space-between; padding-top: 9px; border-top: 1px solid #f0ddd7; }
        .dss-amount strong { font-size: 19px; letter-spacing: -.05em; }
        .dss-amount span { color: var(--sub); font-size: 9px; }
        .dss-approval-actions { display: flex; gap: 7px; margin-top: 12px; }
        .dss-action { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 43px; padding: 0 12px; border-radius: 11px; font: inherit; font-size: 10px; font-weight: 850; cursor: pointer; transition: transform .16s ease; }
        .dss-action.primary { color: #fff9f2; border: 1px solid var(--coral); background: var(--coral); }
        .dss-action.secondary { color: var(--sub); border: 1px solid var(--line); background: var(--card); }
        .dss-approved { display: flex; align-items: center; gap: 6px; padding-top: 9px; color: var(--mint); font-size: 10px; font-weight: 850; }
        .dss-suggestion-row { display: flex; gap: 7px; overflow-x: auto; padding: 11px 1px 1px; scrollbar-width: none; }
        .dss-suggestion-row::-webkit-scrollbar { display: none; }
        .dss-prompt { flex: 0 0 auto; min-height: 38px; padding: 0 11px; color: var(--blue); border: 1px solid #cbdde2; border-radius: 11px; background: var(--blue-soft); font: inherit; font-size: 9px; cursor: pointer; }
        .dss-composer-wrap { position: fixed; z-index: 6; right: 0; bottom: 62px; left: 0; padding: 8px 15px 9px; border-top: 1px solid rgba(217, 224, 218, .93); background: rgba(237, 240, 235, .91); backdrop-filter: blur(15px); }
        .dss-composer { display: flex; align-items: center; gap: 5px; width: 100%; min-height: 53px; padding: 5px; border: 1px solid #d1dbd4; border-radius: 16px; background: var(--card); box-shadow: 0 8px 19px rgba(57, 74, 67, .07); }
        .dss-composer input { min-width: 0; flex: 1; height: 41px; padding: 0 7px; color: var(--ink); border: 0; outline: 0; background: transparent; font: inherit; font-size: 11px; text-align: right; }
        .dss-composer input::placeholder { color: #95a4a2; }
        .dss-composer-tool { display: grid; width: 37px; height: 41px; place-items: center; color: var(--sub); border: 0; background: transparent; cursor: pointer; }
        .dss-send { display: grid; width: 42px; height: 42px; place-items: center; color: #fff9f2; border: 0; border-radius: 12px; background: var(--coral); cursor: pointer; }
        .dss-bottom-nav { position: fixed; z-index: 7; right: 0; bottom: 0; left: 0; display: grid; grid-template-columns: repeat(3, 1fr); min-height: 62px; padding: 5px 9px max(5px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: rgba(251, 252, 248, .97); box-shadow: 0 -5px 20px rgba(57, 74, 67, .06); }
        .dss-nav-button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #91a09e; border: 0; border-radius: 12px; background: transparent; font: inherit; font-size: 9px; cursor: pointer; transition: transform .16s ease; }
        .dss-nav-button.active { color: var(--coral); background: var(--coral-soft); font-weight: 850; }
        .dss-nav-button svg { width: 18px; height: 18px; }
        .dss-sheet {
          position: fixed;
          z-index: 9;
          right: 0;
          bottom: 0;
          left: 0;
          height: min(75dvh, 610px);
          padding: 10px 14px calc(76px + env(safe-area-inset-bottom));
          border-radius: 24px 24px 0 0;
          background: rgba(251, 252, 248, .98);
          box-shadow: 0 -19px 45px rgba(32, 51, 59, .18);
          transform: translateY(${visiblePosition}%);
          transition: ${dragPosition === null ? "transform .3s cubic-bezier(.2,.8,.2,1)" : "none"};
          touch-action: none;
        }
        .dss-sheet-handle-zone { display: flex; justify-content: center; height: 31px; padding-top: 3px; cursor: grab; }
        .dss-sheet-handle-zone:active { cursor: grabbing; }
        .dss-sheet-handle { width: 39px; height: 4px; border-radius: 5px; background: #c8d1cc; }
        .dss-sheet-heading { display: flex; align-items: center; justify-content: space-between; padding: 0 1px 12px; }
        .dss-sheet-heading strong { font-size: 15px; }
        .dss-sheet-heading span { color: var(--sub); font-size: 9px; }
        .dss-sheet-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 4px; border: 1px solid var(--line); border-radius: 13px; background: #f0f4ef; }
        .dss-sheet-tab { min-height: 35px; color: var(--sub); border: 0; border-radius: 9px; background: transparent; font: inherit; font-size: 10px; cursor: pointer; }
        .dss-sheet-tab.active { color: var(--ink); background: var(--card); box-shadow: 0 3px 8px rgba(57, 74, 67, .08); font-weight: 850; }
        .dss-record-list { display: grid; gap: 8px; margin-top: 12px; }
        .dss-record { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 58px; padding: 8px; color: var(--ink); border: 1px solid var(--line); border-radius: 13px; background: #fdfefa; font: inherit; text-align: right; cursor: pointer; transition: transform .16s ease, border-color .16s ease; }
        .dss-record.selected { border-color: #cf9d8f; background: #fff8f3; }
        .dss-record-copy { min-width: 0; flex: 1; }
        .dss-record-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
        .dss-record-copy span { display: block; margin-top: 3px; color: var(--sub); font-size: 9px; }
        .dss-record-mark { display: grid; width: 33px; height: 33px; place-items: center; border-radius: 10px; }
        .dss-record-mark.coral { color: var(--coral); background: var(--coral-soft); }
        .dss-record-mark.blue { color: var(--blue); background: var(--blue-soft); }
        .dss-record-mark.mint { color: var(--mint); background: var(--mint-soft); }
        .dss-record-price { color: var(--coral); font-size: 9px; font-weight: 850; }
        .dss-context { margin-top: 13px; padding: 13px; border: 1px solid #c9dfd8; border-radius: 15px; background: var(--mint-soft); }
        .dss-context-title { display: flex; align-items: center; gap: 8px; color: var(--mint); font-size: 11px; font-weight: 850; }
        .dss-context p { margin: 9px 0 0; color: #66817d; font-size: 10px; line-height: 1.85; }
        .dss-context-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(63, 125, 112, .16); color: #66817d; font-size: 9px; }
        .dss-selected-detail { margin-top: 10px; padding: 10px 11px; border-right: 3px solid var(--coral); border-radius: 10px; background: #fff1e9; color: var(--sub); font-size: 10px; line-height: 1.75; }
        .dss-menu-scrim { position: fixed; z-index: 11; inset: 0; border: 0; background: rgba(32, 51, 59, .24); }
        .dss-menu { position: fixed; z-index: 12; top: 0; right: 0; bottom: 0; width: min(82vw, 300px); padding: 20px 14px; background: var(--card); box-shadow: -17px 0 32px rgba(32, 51, 59, .15); animation: dss-menu-in .22s ease both; }
        .dss-menu-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
        .dss-menu-head strong { font-size: 15px; }
        .dss-menu-list { display: grid; gap: 7px; margin-top: 16px; }
        .dss-menu-list button { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 11px; color: var(--sub); border: 0; border-radius: 12px; background: transparent; font: inherit; font-size: 11px; text-align: right; cursor: pointer; }
        .dss-menu-list button:hover { color: var(--coral); background: var(--coral-soft); }
        .dss-toast { position: fixed; z-index: 14; right: 15px; bottom: 140px; left: 15px; padding: 11px 13px; color: var(--mint); border: 1px solid #c9dfd8; border-radius: 12px; background: var(--mint-soft); font-size: 10px; text-align: center; animation: dss-rise .22s ease both; }
        @keyframes dss-rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes dss-menu-in { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: translateX(0); } }
        @media (min-width: 640px) {
          .dss-shell { display: grid; place-items: center; min-height: 100dvh; padding: 22px; }
          .dss-app { width: min(100%, 430px); min-height: min(920px, 100dvh - 44px); border: 1px solid #d5ddd6; border-radius: 30px; box-shadow: 0 22px 65px rgba(57, 74, 67, .14); }
          .dss-header { border-radius: 30px 30px 0 0; }
          .dss-composer-wrap, .dss-bottom-nav, .dss-sheet { right: auto; left: 50%; width: min(100%, 430px); transform: translateX(-50%) translateY(${visiblePosition}%); }
          .dss-composer-wrap { bottom: 84px; }
          .dss-bottom-nav { bottom: 22px; border-radius: 0 0 30px 30px; }
          .dss-sheet { bottom: 22px; border-radius: 24px 24px 0 0; }
          .dss-menu, .dss-menu-scrim, .dss-toast { display: none; }
        }
      `}</style>

      <div className="dss-app">
        <header className="dss-header">
          <div className="dss-header-side">
            <span className="dss-avatar"><Sparkles size={17} /></span>
            <span className="dss-header-copy"><strong>سكرتيري</strong><small><i className="dss-online" /> متاح الآن</small></span>
          </div>
          <div className="dss-header-actions">
            <button className="dss-icon" aria-label="الإشعارات" onClick={() => setShowNotice(true)}><Bell size={17} /></button>
            <button className="dss-icon" aria-label="فتح القائمة" onClick={() => setMenuOpen(true)}><Menu size={18} /></button>
          </div>
        </header>

        <div className="dss-date-strip">
          <div className="dss-date-copy"><strong>صباح هادئ، كريم</strong>الخميس، ٢٤ أكتوبر · القاهرة</div>
          <span className="dss-live"><i /> مباشر</span>
        </div>

        <section className="dss-chat" aria-label="محادثة المساعد">
          <div className="dss-chat-head">
            <div className="dss-chat-person">
              <span className="dss-orb"><Sparkles size={17} /></span>
              <span><strong>المساعد الشخصي</strong><span>يفهم سياقك، وليس فقط كلماتك</span></span>
            </div>
            <div className="dss-chat-tools">
              <button className="dss-icon" aria-label="بحث" onClick={() => setShowNotice(true)}><Search size={15} /></button>
              <button className="dss-icon" aria-label="خيارات المحادثة" onClick={() => setSheetPosition(35)}><ChevronDown size={16} /></button>
            </div>
          </div>

          <div className="dss-messages">
            {messages.map((message) => (
              <div className={`dss-message ${message.role}`} key={message.id}>
                {message.role === "assistant" && <span className="dss-message-label"><i /> سكرتيري</span>}
                {message.text}
                <span className="dss-message-meta">{message.role === "assistant" ? <Sparkles size={10} /> : <Check size={10} />}{message.time}</span>
              </div>
            ))}
          </div>

          <div className="dss-approval">
            <div className="dss-approval-head">
              <span>تسجيل مصروف بانتظارك</span>
              {approved ? <span className="dss-approved"><CheckCircle2 size={13} /> تم الاعتماد</span> : <span className="dss-pending">قرارك أولاً</span>}
            </div>
            {!approved ? (
              <>
                <p>ذكرت أن محمود دفع معك في غداء العمل. راجع التفاصيل قبل أن أضيفها إلى سجلاتك.</p>
                <div className="dss-amount"><strong>١٬٢٥٠ ج.م</strong><span>غداء العمل · محمود</span></div>
                <div className="dss-approval-actions">
                  <button className="dss-action primary" onClick={() => { setApproved(true); setShowNotice(true); }}><Check size={14} /> اعتماد وحفظ</button>
                  <button className="dss-action secondary" onClick={() => choosePrompt("عدّل مصروف غداء العمل")}><ChevronLeft size={14} /> تعديل</button>
                </div>
              </>
            ) : <p style={{ marginBottom: 0 }}>أضفته إلى السجلات. اسحب اللوحة من الأسفل لتراجع التفاصيل والسياق.</p>}
          </div>
        </section>

        <div className="dss-suggestion-row">
          {prompts.map((prompt) => <button className="dss-prompt" key={prompt} onClick={() => choosePrompt(prompt)}>{prompt}</button>)}
        </div>
      </div>

      <div className="dss-composer-wrap">
        <div className="dss-composer">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="اكتب طلبك كما تتكلم..." aria-label="اكتب طلبك" />
          <button className="dss-composer-tool" aria-label="إرفاق ملف" onClick={() => setShowNotice(true)}><Paperclip size={16} /></button>
          <button className="dss-composer-tool" aria-label="تسجيل صوتي" onClick={() => setShowNotice(true)}><Mic size={17} /></button>
          <button className="dss-send" aria-label="إرسال الرسالة" onClick={send}><Send size={15} /></button>
        </div>
      </div>

      <nav className="dss-bottom-nav" aria-label="التنقل السفلي">
        <button className="dss-nav-button active" onClick={() => snapSheet(76)}><Sparkles size={18} />المساعد</button>
        <button className="dss-nav-button" onClick={() => { setSheetTab("records"); snapSheet(35); }}><Archive size={18} />السجلات</button>
        <button className="dss-nav-button" onClick={() => { setSheetTab("context"); snapSheet(35); }}><LayoutDashboard size={18} />اليوم</button>
      </nav>

      <section
        ref={sheetRef}
        className="dss-sheet"
        aria-label="السجلات والسياق"
        style={{ transform: `translateY(${visiblePosition}%)` }}
      >
        <div className="dss-sheet-handle-zone" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
          <span className="dss-sheet-handle" />
        </div>
        <div className="dss-sheet-heading">
          <div><strong>السجلات والسياق</strong><span> اسحب للأعلى للتفاصيل</span></div>
          <span>{records.length} عناصر مرتبطة</span>
        </div>
        <div className="dss-sheet-tabs">
          <button className={`dss-sheet-tab ${sheetTab === "records" ? "active" : ""}`} onClick={() => setSheetTab("records")}>السجلات</button>
          <button className={`dss-sheet-tab ${sheetTab === "context" ? "active" : ""}`} onClick={() => setSheetTab("context")}>الصورة الأكبر</button>
        </div>
        {sheetTab === "records" ? (
          <>
            <div className="dss-record-list">
              {records.map((record) => {
                const Icon = record.icon;
                return (
                  <button className={`dss-record ${activeRecord === record.id ? "selected" : ""}`} key={record.id} onClick={() => openRecord(record.id)}>
                    <span className={`dss-record-mark ${record.tone}`}><Icon size={15} /></span>
                    <span className="dss-record-copy"><strong>{record.title}</strong><span>{record.meta}</span></span>
                    <span className="dss-record-price">{record.detail}</span>
                    <ChevronLeft size={14} color="#a1aaa8" />
                  </button>
                );
              })}
            </div>
            {selectedRecord && <div className="dss-selected-detail">هذا السجل مرتبط بالمحادثة الحالية. قل «عدّل السجل» وسأحافظ على السياق.</div>}
          </>
        ) : (
          <div className="dss-context">
            <div className="dss-context-title"><ShieldCheck size={16} /> الصورة الأكبر لليوم</div>
            <p>مصروف واحد ينتظر اعتمادك. لا توجد تنبيهات فائتة، واتصال التصميم هو موعدك التالي.</p>
            <div className="dss-context-row"><CheckCircle2 size={14} /> آخر مزامنة قبل ٣ دقائق</div>
          </div>
        )}
      </section>

      {menuOpen && (
        <>
          <button className="dss-menu-scrim" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} />
          <aside className="dss-menu">
            <div className="dss-menu-head"><strong>مساحات سكرتيرك</strong><button className="dss-icon" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={16} /></button></div>
            <div className="dss-menu-list">
              <button onClick={() => setMenuOpen(false)}><Sparkles size={16} /> المحادثة</button>
              <button onClick={() => { setSheetTab("records"); snapSheet(35); setMenuOpen(false); }}><Archive size={16} /> السجلات</button>
              <button onClick={() => { setSheetTab("context"); snapSheet(35); setMenuOpen(false); }}><ShieldCheck size={16} /> الصورة الأكبر</button>
            </div>
          </aside>
        </>
      )}
      {showNotice && <button className="dss-toast" onClick={() => setShowNotice(false)}>تم تحديث المساحة الحالية — اضغط للإخفاء</button>}
    </main>
  );
}