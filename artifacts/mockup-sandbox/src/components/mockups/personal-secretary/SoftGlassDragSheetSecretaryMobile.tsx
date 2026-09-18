import {
  Archive,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  FileText,
  LayoutDashboard,
  Menu,
  Mic,
  Paperclip,
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

export default function SoftGlassDragSheetSecretaryMobile() {
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

  const snapSheet = (position: number) => {
    setDragPosition(null);
    setSheetPosition(position);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const sheetHeight = sheetRef.current?.offsetHeight ?? 520;
    dragState.current = { startY: event.clientY, startPosition: sheetPosition, dragging: true };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.sheetHeight = String(sheetHeight);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.dragging) return;
    const sheetHeight = Number(event.currentTarget.dataset.sheetHeight) || 520;
    const movement = ((event.clientY - dragState.current.startY) / sheetHeight) * 100;
    setDragPosition(Math.max(0, Math.min(82, dragState.current.startPosition + movement)));
  };

  const handlePointerUp = () => {
    if (!dragState.current.dragging) return;
    dragState.current.dragging = false;
    const current = dragPosition ?? sheetPosition;
    const closest = snapPoints.reduce((best, point) =>
      Math.abs(point - current) < Math.abs(best - current) ? point : best,
    );
    snapSheet(closest);
  };

  const selectRecord = (id: string) => {
    setActiveRecord(id);
    setShowNotice(true);
  };

  const visiblePosition = dragPosition ?? sheetPosition;
  const selectedRecord = records.find((record) => record.id === activeRecord);

  return (
    <main className="sgd-shell" dir="rtl">
      <style>{`
        .sgd-shell {
          --ink: #263a3b;
          --sub: #75888a;
          --paper: #edf3ef;
          --card: rgba(250, 253, 249, .74);
          --line: rgba(157, 181, 176, .34);
          --coral: #ca735f;
          --coral-soft: #f5e3dc;
          --blue: #597f91;
          --blue-soft: #e2edf0;
          --mint: #5e8a7d;
          --mint-soft: #e3f0eb;
          width: 100%;
          min-height: 100dvh;
          overflow: hidden;
          color: var(--ink);
          background:
            radial-gradient(circle at 12% 7%, rgba(255, 244, 223, .72), transparent 28%),
            radial-gradient(circle at 108% 16%, rgba(186, 219, 211, .8), transparent 36%),
            linear-gradient(145deg, #eff4ef 0%, #e6efeb 54%, #edf2eb 100%);
          font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", sans-serif;
          letter-spacing: -.018em;
        }
        .sgd-shell *, .sgd-shell *::before, .sgd-shell *::after { box-sizing: border-box; }
        .sgd-app { min-height: 100dvh; padding: 0 15px 180px; }
        .sgd-header {
          position: sticky;
          top: 0;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 70px;
          margin: 0 -15px;
          padding: 0 15px;
          border-bottom: 1px solid rgba(178, 198, 190, .28);
          background: rgba(235, 242, 237, .66);
          backdrop-filter: blur(23px) saturate(1.15);
        }
        .sgd-header-side, .sgd-header-actions, .sgd-chat-tools { display: flex; align-items: center; gap: 8px; }
        .sgd-avatar {
          display: grid;
          width: 37px;
          height: 37px;
          place-items: center;
          color: #fffaf3;
          border: 1px solid rgba(255,255,255,.42);
          border-radius: 14px;
          background: linear-gradient(145deg, #d58670, #b76355);
          box-shadow: 0 9px 23px rgba(190, 104, 86, .17), inset 0 1px rgba(255,255,255,.36);
        }
        .sgd-header-copy strong { display: block; font-size: 13px; font-weight: 850; }
        .sgd-header-copy small { display: flex; align-items: center; gap: 5px; margin-top: 2px; color: var(--sub); font-size: 9px; }
        .sgd-online { width: 5px; height: 5px; border-radius: 50%; background: var(--mint); box-shadow: 0 0 0 3px rgba(94,138,125,.11); }
        .sgd-icon {
          display: grid;
          width: 39px;
          height: 39px;
          place-items: center;
          color: var(--sub);
          border: 1px solid rgba(157,181,176,.36);
          border-radius: 13px;
          background: rgba(252, 254, 250, .48);
          cursor: pointer;
          transition: transform .18s ease, background .18s ease;
        }
        .sgd-icon:hover { background: rgba(255,255,255,.72); }
        .sgd-icon:active, .sgd-action:active, .sgd-prompt:active, .sgd-record:active, .sgd-nav-button:active { transform: scale(.97); }
        .sgd-date-strip { display: flex; align-items: center; justify-content: space-between; padding: 17px 1px 14px; }
        .sgd-date-copy { color: var(--sub); font-size: 10px; }
        .sgd-date-copy strong { display: block; margin-bottom: 2px; color: var(--ink); font-size: 14px; }
        .sgd-live { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; color: var(--mint); border: 1px solid rgba(125,174,158,.3); border-radius: 11px; background: rgba(227,240,235,.67); font-size: 9px; font-weight: 850; }
        .sgd-live i { width: 5px; height: 5px; border-radius: 50%; background: var(--mint); }
        .sgd-chat {
          position: relative;
          overflow: hidden;
          min-height: calc(100dvh - 186px);
          border: 1px solid rgba(255,255,255,.68);
          border-radius: 25px;
          background: rgba(250, 253, 249, .53);
          box-shadow: 0 23px 55px rgba(79, 111, 101, .09), inset 0 1px rgba(255,255,255,.7);
          backdrop-filter: blur(17px) saturate(1.06);
        }
        .sgd-chat::after { content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit; box-shadow: inset 0 0 0 1px rgba(214,233,226,.25); }
        .sgd-chat-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 14px 13px; border-bottom: 1px solid rgba(157,181,176,.23); }
        .sgd-chat-title { display: flex; align-items: center; gap: 9px; }
        .sgd-spark { display: grid; width: 31px; height: 31px; place-items: center; color: #b86757; border: 1px solid rgba(255,255,255,.7); border-radius: 11px; background: rgba(247,226,218,.78); }
        .sgd-chat-title strong { display: block; font-size: 12px; font-weight: 850; }
        .sgd-chat-title span { display: block; margin-top: 2px; color: var(--sub); font-size: 9px; }
        .sgd-chat-tools button { border: 0; background: transparent; color: #9aacaa; cursor: pointer; }
        .sgd-messages { display: flex; flex-direction: column; gap: 11px; padding: 17px 14px 148px; }
        .sgd-message { max-width: 89%; animation: sgd-rise .32s ease both; }
        .sgd-message.assistant { align-self: flex-start; }
        .sgd-message.user { align-self: flex-end; }
        .sgd-bubble { padding: 12px 13px; border: 1px solid rgba(255,255,255,.65); border-radius: 16px 16px 4px 16px; background: rgba(255,255,255,.72); box-shadow: 0 8px 18px rgba(76,104,95,.06); font-size: 12px; line-height: 1.8; }
        .sgd-message.user .sgd-bubble { border-color: rgba(194,221,216,.5); border-radius: 16px 16px 16px 4px; background: rgba(222,239,234,.84); }
        .sgd-time { display: block; margin: 4px 7px 0; color: #9aabaa; font-size: 8px; }
        .sgd-message.user .sgd-time { text-align: left; }
        .sgd-approval { margin: 3px 0 5px; padding: 14px; border: 1px solid rgba(220, 198, 179, .5); border-radius: 17px; background: linear-gradient(135deg, rgba(255,248,239,.83), rgba(250,240,225,.72)); box-shadow: 0 9px 19px rgba(138,101,70,.06); animation: sgd-rise .4s .12s ease both; }
        .sgd-approval-head { display: flex; align-items: center; gap: 8px; margin-bottom: 11px; color: #926c4e; font-size: 11px; font-weight: 850; }
        .sgd-approval-head svg { color: #b78660; }
        .sgd-approval-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0 12px; border-top: 1px solid rgba(191,153,121,.2); border-bottom: 1px solid rgba(191,153,121,.2); }
        .sgd-approval-row strong { display: block; font-size: 12px; }
        .sgd-approval-row span { display: block; margin-top: 3px; color: #9a8270; font-size: 9px; }
        .sgd-amount { color: #8d654a; font-size: 16px; font-weight: 900; }
        .sgd-approval-actions { display: flex; gap: 7px; margin-top: 11px; }
        .sgd-action { flex: 1; min-height: 35px; border: 0; border-radius: 10px; font-family: inherit; font-size: 10px; font-weight: 850; cursor: pointer; transition: transform .18s ease, opacity .18s ease; }
        .sgd-action.approve { color: #fffaf4; background: #bf795d; box-shadow: 0 6px 13px rgba(191,121,93,.16); }
        .sgd-action.later { color: #926c54; border: 1px solid rgba(197,162,131,.34); background: rgba(255,253,248,.54); }
        .sgd-approved { display: flex; align-items: center; gap: 7px; color: var(--mint); font-size: 10px; font-weight: 800; }
        .sgd-composer-wrap { position: absolute; right: 12px; bottom: 12px; left: 12px; z-index: 1; }
        .sgd-composer { display: flex; align-items: center; gap: 7px; padding: 7px 8px 7px 7px; border: 1px solid rgba(255,255,255,.8); border-radius: 16px; background: rgba(253,255,252,.78); box-shadow: 0 11px 23px rgba(72,103,94,.1), inset 0 1px rgba(255,255,255,.76); backdrop-filter: blur(18px); }
        .sgd-composer input { min-width: 0; flex: 1; padding: 8px 5px; border: 0; outline: 0; color: var(--ink); background: transparent; font-family: inherit; font-size: 11px; }
        .sgd-composer input::placeholder { color: #9aabaa; }
        .sgd-chat-tool { display: grid; width: 31px; height: 31px; place-items: center; color: #93a5a2; border: 0; background: transparent; cursor: pointer; }
        .sgd-send { display: grid; width: 34px; height: 34px; place-items: center; color: #fffaf4; border: 0; border-radius: 11px; background: #bf795d; cursor: pointer; box-shadow: 0 5px 11px rgba(191,121,93,.18); }
        .sgd-prompts { display: flex; gap: 7px; overflow: auto; padding: 12px 14px 0; scrollbar-width: none; }
        .sgd-prompts::-webkit-scrollbar { display: none; }
        .sgd-prompt { flex: 0 0 auto; padding: 8px 11px; color: #6c817f; border: 1px solid rgba(158,184,177,.34); border-radius: 10px; background: rgba(251,254,250,.48); font-family: inherit; font-size: 9px; cursor: pointer; transition: transform .18s ease, background .18s ease; }
        .sgd-prompt:hover { background: rgba(255,255,255,.74); }
        .sgd-bottom-nav { position: fixed; right: 15px; bottom: 17px; left: 15px; z-index: 4; display: flex; justify-content: space-around; padding: 8px 7px; border: 1px solid rgba(255,255,255,.8); border-radius: 18px; background: rgba(247,252,247,.72); box-shadow: 0 16px 34px rgba(70,103,94,.13), inset 0 1px rgba(255,255,255,.8); backdrop-filter: blur(23px) saturate(1.15); }
        .sgd-nav-button { display: flex; min-width: 75px; flex-direction: column; align-items: center; gap: 3px; padding: 5px 12px; color: #94a5a1; border: 0; border-radius: 12px; background: transparent; font-family: inherit; font-size: 8px; cursor: pointer; transition: transform .18s ease, color .18s ease, background .18s ease; }
        .sgd-nav-button.active { color: #ad6756; background: rgba(246,226,218,.66); font-weight: 850; }
        .sgd-sheet { position: fixed; right: 0; bottom: -1px; left: 0; z-index: 5; min-height: 63dvh; padding: 0 15px 94px; border: 1px solid rgba(255,255,255,.78); border-bottom: 0; border-radius: 29px 29px 0 0; background: linear-gradient(150deg, rgba(249,253,249,.78), rgba(235,247,241,.61)); box-shadow: 0 -18px 52px rgba(70,104,95,.14), inset 0 1px rgba(255,255,255,.9); backdrop-filter: blur(32px) saturate(1.18); transition: transform .36s cubic-bezier(.22,.8,.24,1); }
        .sgd-sheet::before { content: ""; position: absolute; right: 14px; top: 10px; left: 14px; height: 72px; pointer-events: none; border-radius: 25px; background: radial-gradient(ellipse at 50% 0%, rgba(255,255,255,.66), transparent 67%); }
        .sgd-sheet-handle-zone { position: relative; z-index: 1; display: flex; justify-content: center; padding: 11px 0 10px; cursor: grab; touch-action: none; }
        .sgd-sheet-handle-zone:active { cursor: grabbing; }
        .sgd-sheet-handle { width: 43px; height: 4px; border-radius: 9px; background: rgba(117,147,141,.45); box-shadow: 0 1px rgba(255,255,255,.8); }
        .sgd-sheet-heading { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 5px 1px 13px; }
        .sgd-sheet-heading strong { display: block; font-size: 13px; font-weight: 900; }
        .sgd-sheet-heading span { color: var(--sub); font-size: 9px; }
        .sgd-sheet-heading > span { padding: 5px 8px; border: 1px solid rgba(149,181,171,.26); border-radius: 8px; background: rgba(237,247,241,.58); color: #69817b; }
        .sgd-sheet-tabs { position: relative; z-index: 1; display: flex; gap: 5px; padding: 0 0 10px; border-bottom: 1px solid rgba(149,181,171,.25); }
        .sgd-sheet-tab { padding: 7px 10px; color: #8da09c; border: 0; border-radius: 8px; background: transparent; font-family: inherit; font-size: 9px; cursor: pointer; }
        .sgd-sheet-tab.active { color: #527d70; background: rgba(219,239,231,.66); font-weight: 850; }
        .sgd-record-list { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 7px; padding-top: 11px; }
        .sgd-record { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px 9px; text-align: right; border: 1px solid rgba(255,255,255,.63); border-radius: 14px; background: rgba(255,255,255,.48); box-shadow: 0 5px 13px rgba(69,105,94,.035); font-family: inherit; cursor: pointer; transition: transform .18s ease, background .18s ease; }
        .sgd-record:hover, .sgd-record.selected { background: rgba(255,255,255,.76); transform: translateX(-2px); }
        .sgd-record-mark { display: grid; width: 31px; height: 31px; flex: 0 0 auto; place-items: center; border-radius: 10px; }
        .sgd-record-mark.coral { color: var(--coral); background: var(--coral-soft); }
        .sgd-record-mark.blue { color: var(--blue); background: var(--blue-soft); }
        .sgd-record-mark.mint { color: var(--mint); background: var(--mint-soft); }
        .sgd-record-copy { min-width: 0; flex: 1; }
        .sgd-record-copy strong, .sgd-record-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sgd-record-copy strong { color: var(--ink); font-size: 10px; }
        .sgd-record-copy span { margin-top: 2px; color: #8a9c99; font-size: 8px; }
        .sgd-record-price { color: #6e8580; font-size: 9px; font-weight: 850; }
        .sgd-selected-detail { position: relative; z-index: 1; margin-top: 9px; padding: 9px 10px; color: #638077; border: 1px solid rgba(139,181,164,.26); border-radius: 10px; background: rgba(225,243,235,.48); font-size: 9px; line-height: 1.7; }
        .sgd-context { position: relative; z-index: 1; margin-top: 12px; padding: 14px; border: 1px solid rgba(255,255,255,.68); border-radius: 15px; background: rgba(255,255,255,.48); }
        .sgd-context-title { display: flex; align-items: center; gap: 7px; color: #588175; font-size: 11px; font-weight: 850; }
        .sgd-context p { margin: 10px 0; color: #6e8580; font-size: 10px; line-height: 1.8; }
        .sgd-context-row { display: flex; align-items: center; gap: 6px; color: #7f9992; font-size: 9px; }
        .sgd-menu-scrim { position: fixed; inset: 0; z-index: 7; border: 0; background: rgba(48,73,67,.14); backdrop-filter: blur(4px); cursor: pointer; }
        .sgd-menu { position: fixed; top: 0; right: 0; bottom: 0; z-index: 8; width: min(82vw, 320px); padding: 16px; border-left: 1px solid rgba(255,255,255,.82); background: rgba(246,252,247,.88); box-shadow: -17px 0 35px rgba(67,97,88,.12); backdrop-filter: blur(25px); animation: sgd-slide .28s ease both; }
        .sgd-menu-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 21px; border-bottom: 1px solid rgba(157,181,176,.25); }
        .sgd-menu-head strong { font-size: 13px; }
        .sgd-menu-list { display: flex; flex-direction: column; gap: 6px; padding-top: 19px; }
        .sgd-menu-list button { display: flex; align-items: center; gap: 10px; padding: 13px 11px; color: #607975; border: 1px solid transparent; border-radius: 12px; background: transparent; font-family: inherit; font-size: 11px; text-align: right; cursor: pointer; }
        .sgd-menu-list button:hover { border-color: rgba(157,181,176,.23); background: rgba(255,255,255,.57); }
        .sgd-toast { position: fixed; right: 18px; bottom: 94px; left: 18px; z-index: 9; padding: 11px 13px; color: #52786d; border: 1px solid rgba(255,255,255,.8); border-radius: 12px; background: rgba(239,250,244,.9); box-shadow: 0 12px 28px rgba(62,101,88,.14); font-family: inherit; font-size: 10px; cursor: pointer; animation: sgd-rise .25s ease both; }
        @keyframes sgd-rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes sgd-slide { from { opacity: 0; transform: translateX(15px); } to { opacity: 1; transform: translateX(0); } }
        @media (min-width: 600px) { .sgd-shell { max-width: 450px; margin: 0 auto; } .sgd-bottom-nav { right: calc(50% - 210px); left: calc(50% - 210px); } }
      `}</style>

      <div className="sgd-app">
        <header className="sgd-header">
          <div className="sgd-header-side">
            <div className="sgd-avatar"><Sparkles size={17} /></div>
            <div className="sgd-header-copy">
              <strong>سكرتير كريم</strong>
              <small><i className="sgd-online" /> متاح الآن · يحفظ السياق</small>
            </div>
          </div>
          <div className="sgd-header-actions">
            <button className="sgd-icon" aria-label="التنبيهات" onClick={() => setShowNotice(true)}><Bell size={16} /></button>
            <button className="sgd-icon" aria-label="فتح القائمة" onClick={() => setMenuOpen(true)}><Menu size={17} /></button>
          </div>
        </header>

        <div className="sgd-date-strip">
          <div className="sgd-date-copy"><strong>الأربعاء، ٢٤ أبريل</strong>يوم هادئ يبدأ بخطوة واحدة</div>
          <span className="sgd-live"><i /> متزامن</span>
        </div>

        <section className="sgd-chat" aria-label="محادثة السكرتير">
          <div className="sgd-chat-head">
            <div className="sgd-chat-title">
              <div className="sgd-spark"><Sparkles size={15} /></div>
              <div><strong>مساحة الحديث</strong><span>مرجعك اليومي في مكان واحد</span></div>
            </div>
            <div className="sgd-chat-tools"><button aria-label="البحث" onClick={() => setShowNotice(true)}><Archive size={15} /></button></div>
          </div>
          <div className="sgd-prompts">
            {prompts.map((prompt) => <button className="sgd-prompt" key={prompt} onClick={() => setDraft(prompt)}>{prompt}</button>)}
          </div>
          <div className="sgd-messages">
            {messages.map((message) => (
              <div className={`sgd-message ${message.role}`} key={message.id}>
                <div className="sgd-bubble">{message.text}</div>
                <span className="sgd-time">{message.time}</span>
              </div>
            ))}
            <div className="sgd-approval">
              {!approved ? (
                <>
                  <div className="sgd-approval-head"><ShieldCheck size={15} /> يحتاج موافقتك قبل الحفظ</div>
                  <div className="sgd-approval-row">
                    <div><strong>غداء العمل</strong><span>محمود · مصروف مقترح</span></div>
                    <span className="sgd-amount">١٬٢٥٠ ج.م</span>
                  </div>
                  <div className="sgd-approval-actions">
                    <button className="sgd-action approve" onClick={() => { setApproved(true); setShowNotice(true); }}>اعتماد المصروف</button>
                    <button className="sgd-action later" onClick={() => setShowNotice(true)}>لاحقاً</button>
                  </div>
                </>
              ) : (
                <div className="sgd-approved"><CheckCircle2 size={16} /> تم اعتماد غداء العمل وحفظه في السجلات</div>
              )}
            </div>
          </div>
          <div className="sgd-composer-wrap">
            <div className="sgd-composer">
              <button className="sgd-chat-tool" aria-label="إرفاق ملف" onClick={() => setShowNotice(true)}><Paperclip size={16} /></button>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="اكتب ما تريد إنجازه..." aria-label="اكتب رسالة" />
              <button className="sgd-chat-tool" aria-label="تسجيل صوتي" onClick={() => setShowNotice(true)}><Mic size={16} /></button>
              <button className="sgd-send" aria-label="إرسال الرسالة" onClick={send}><Send size={15} /></button>
            </div>
          </div>
        </section>
      </div>

      <nav className="sgd-bottom-nav" aria-label="التنقل السفلي">
        <button className="sgd-nav-button active" onClick={() => snapSheet(76)}><Sparkles size={18} />المساعد</button>
        <button className="sgd-nav-button" onClick={() => { setSheetTab("records"); snapSheet(35); }}><Archive size={18} />السجلات</button>
        <button className="sgd-nav-button" onClick={() => { setSheetTab("context"); snapSheet(35); }}><LayoutDashboard size={18} />اليوم</button>
      </nav>

      <section
        ref={sheetRef}
        className="sgd-sheet"
        aria-label="السجلات والسياق"
        style={{ transform: `translateY(${visiblePosition}%)` }}
      >
        <div className="sgd-sheet-handle-zone" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
          <span className="sgd-sheet-handle" />
        </div>
        <div className="sgd-sheet-heading">
          <div><strong>السجلات والسياق</strong><span>اسحب للأعلى للتفاصيل</span></div>
          <span>{records.length} عناصر مرتبطة</span>
        </div>
        <div className="sgd-sheet-tabs">
          <button className={`sgd-sheet-tab ${sheetTab === "records" ? "active" : ""}`} onClick={() => setSheetTab("records")}>السجلات</button>
          <button className={`sgd-sheet-tab ${sheetTab === "context" ? "active" : ""}`} onClick={() => setSheetTab("context")}>الصورة الأكبر</button>
        </div>
        {sheetTab === "records" ? (
          <>
            <div className="sgd-record-list">
              {records.map((record) => {
                const Icon = record.icon;
                return (
                  <button className={`sgd-record ${activeRecord === record.id ? "selected" : ""}`} key={record.id} onClick={() => selectRecord(record.id)}>
                    <span className={`sgd-record-mark ${record.tone}`}><Icon size={15} /></span>
                    <span className="sgd-record-copy"><strong>{record.title}</strong><span>{record.meta}</span></span>
                    <span className="sgd-record-price">{record.detail}</span>
                    <ChevronLeft size={14} color="#9aacaa" />
                  </button>
                );
              })}
            </div>
            {selectedRecord && <div className="sgd-selected-detail">هذا السجل مرتبط بالمحادثة الحالية. قل «عدّل السجل» وسأحافظ على السياق.</div>}
          </>
        ) : (
          <div className="sgd-context">
            <div className="sgd-context-title"><ShieldCheck size={16} /> الصورة الأكبر لليوم</div>
            <p>مصروف واحد ينتظر اعتمادك. لا توجد تنبيهات فائتة، واتصال التصميم هو موعدك التالي.</p>
            <div className="sgd-context-row"><Check size={14} /> آخر مزامنة قبل ٣ دقائق</div>
          </div>
        )}
      </section>

      {menuOpen && (
        <>
          <button className="sgd-menu-scrim" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} />
          <aside className="sgd-menu">
            <div className="sgd-menu-head"><strong>مساحات سكرتيرك</strong><button className="sgd-icon" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={16} /></button></div>
            <div className="sgd-menu-list">
              <button onClick={() => { setMenuOpen(false); snapSheet(76); }}><Sparkles size={16} /> المحادثة</button>
              <button onClick={() => { setSheetTab("records"); snapSheet(35); setMenuOpen(false); }}><Archive size={16} /> السجلات</button>
              <button onClick={() => { setSheetTab("context"); snapSheet(35); setMenuOpen(false); }}><ShieldCheck size={16} /> الصورة الأكبر</button>
            </div>
          </aside>
        </>
      )}
      {showNotice && <button className="sgd-toast" onClick={() => setShowNotice(false)}>تم تحديث المساحة الحالية — اضغط للإخفاء</button>}
    </main>
  );
}