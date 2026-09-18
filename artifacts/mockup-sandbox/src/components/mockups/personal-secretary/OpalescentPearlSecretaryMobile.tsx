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
  note?: string;
};

type SheetTab = "records" | "context";

const prompts = ["رتّب لي يومي", "سجّل مصروفاً", "ماذا فاتني؟"];

const records = [
  {
    id: "expense",
    title: "غداء العمل",
    meta: "محمود · منذ ساعتين",
    detail: "١٬٢٥٠ ج.م",
    tone: "rose",
    icon: WalletCards,
  },
  {
    id: "meeting",
    title: "اتصال فريق التصميم",
    meta: "اليوم · ١١:٣٠ ص",
    detail: "بعد ٤٨ دقيقة",
    tone: "sky",
    icon: CalendarClock,
  },
  {
    id: "file",
    title: "ملف الربع الثالث",
    meta: "مستحق اليوم · مسودة",
    detail: "قبل ٣٥ دقيقة",
    tone: "lilac",
    icon: FileText,
  },
] as const;

const initialMessages: Message[] = [
  {
    id: 1,
    role: "assistant",
    text: "صباح الخير يا كريم. خذ وقتك — ما الشيء الذي يشغل بالك الآن؟",
    time: "٠٩:٤٢",
    note: "أتتبع من هنا",
  },
  {
    id: 2,
    role: "user",
    text: "أحتاج أن أرتب مصروف الغداء وألا أنسى اتصال التصميم.",
    time: "٠٩:٤٣",
  },
  {
    id: 3,
    role: "assistant",
    text: "وصلت. سأحفظ المصروف بعد موافقتك، وأبقي الاتصال أمامك حتى ينتهي. هل تريد أن أذكّرك قبله بعشر دقائق؟",
    time: "٠٩:٤٣",
    note: "فهمت نيتين",
  },
];

const snapPoints = [0, 43, 80];

export default function OpalescentPearlSecretaryMobile() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [approved, setApproved] = useState(false);
  const [sheetTab, setSheetTab] = useState<SheetTab>("records");
  const [sheetPosition, setSheetPosition] = useState(80);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const [activeRecord, setActiveRecord] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [recordCount, setRecordCount] = useState(3);
  const sheetRef = useRef<HTMLElement>(null);
  const dragState = useRef({ startY: 0, startPosition: 80, dragging: false });

  const send = () => {
    const clean = draft.trim();
    if (!clean) return;
    const answer = clean.includes("مصروف")
      ? "تمام. أعطني المبلغ والوصف، وسأجهزه للمراجعة قبل أن ألمس السجل."
      : clean.includes("فات") || clean.includes("يومي")
        ? "سأراجع يومك: اتصال التصميم هو التالي، ويوجد مصروف واحد ينتظر اعتمادك."
        : clean.includes("اتصال") || clean.includes("مكالمة")
          ? "اتصال فريق التصميم اليوم الساعة ١١:٣٠. أذكّرك قبلها بعشر دقائق؟"
          : "حاضر. أحتفظ بهذا في سياقنا وأرجع لك بخطوة واضحة.";
    const now = Date.now();
    setMessages((current) => [
      ...current,
      { id: now, role: "user", text: clean, time: "الآن" },
      { id: now + 1, role: "assistant", text: answer, time: "الآن", note: "السياق محفوظ" },
    ]);
    setDraft("");
  };

  const snapSheet = (position: number) => {
    setDragPosition(null);
    setSheetPosition(position);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const sheetHeight = sheetRef.current?.offsetHeight ?? 530;
    dragState.current = { startY: event.clientY, startPosition: sheetPosition, dragging: true };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.sheetHeight = String(sheetHeight);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.dragging) return;
    const sheetHeight = Number(event.currentTarget.dataset.sheetHeight) || 530;
    const movement = ((event.clientY - dragState.current.startY) / sheetHeight) * 100;
    setDragPosition(Math.max(0, Math.min(84, dragState.current.startPosition + movement)));
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
    <main className="ops-shell" dir="rtl">
      <style>{`
        .ops-shell {
          --ops-ink: #303446;
          --ops-muted: #7a7b8e;
          --ops-paper: #f0edf2;
          --ops-pearl: rgba(253, 250, 252, .68);
          --ops-line: rgba(178, 173, 194, .36);
          --ops-rose: #b87087;
          --ops-rose-soft: #f1dce4;
          --ops-sky: #6c8fa6;
          --ops-sky-soft: #dcebf0;
          --ops-lilac: #8e82aa;
          --ops-lilac-soft: #e8e1f1;
          width: 100%;
          min-height: 100dvh;
          overflow: hidden;
          color: var(--ops-ink);
          background:
            radial-gradient(circle at 10% 5%, rgba(255, 220, 225, .78), transparent 27%),
            radial-gradient(circle at 105% 18%, rgba(195, 222, 238, .72), transparent 32%),
            radial-gradient(circle at 44% 114%, rgba(222, 208, 238, .7), transparent 34%),
            linear-gradient(140deg, #f2eff1 0%, #e8edf0 48%, #eee9f2 100%);
          font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", sans-serif;
          letter-spacing: -.018em;
        }
        .ops-shell *, .ops-shell *::before, .ops-shell *::after { box-sizing: border-box; }
        .ops-app { min-height: 100dvh; padding: 0 15px 185px; }
        .ops-header {
          position: sticky;
          top: 0;
          z-index: 3;
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 70px;
          margin: 0 -15px;
          padding: 0 15px;
          border-bottom: 1px solid rgba(255,255,255,.5);
          background: rgba(242, 239, 242, .56);
          backdrop-filter: blur(24px) saturate(1.15);
        }
        .ops-header-side, .ops-header-actions, .ops-chat-tools { display: flex; align-items: center; gap: 8px; }
        .ops-avatar {
          position: relative;
          display: grid;
          width: 38px;
          height: 38px;
          place-items: center;
          color: #fff8f6;
          border: 1px solid rgba(255,255,255,.7);
          border-radius: 14px 14px 14px 6px;
          background:
            linear-gradient(135deg, rgba(255,255,255,.45), transparent 40%),
            linear-gradient(145deg, #cf8ca0, #9b718d);
          box-shadow: 0 10px 24px rgba(147, 101, 127, .18), inset 0 1px rgba(255,255,255,.64);
        }
        .ops-avatar::after { content: ""; position: absolute; right: -4px; bottom: -3px; width: 9px; height: 9px; border: 2px solid #f3edef; border-radius: 50%; background: #739b8d; }
        .ops-header-copy strong { display: block; font-size: 13px; font-weight: 900; }
        .ops-header-copy small { display: flex; align-items: center; gap: 5px; margin-top: 2px; color: var(--ops-muted); font-size: 9px; }
        .ops-online { width: 5px; height: 5px; border-radius: 50%; background: #769b8d; box-shadow: 0 0 0 3px rgba(118,155,141,.13); }
        .ops-icon {
          display: grid;
          width: 39px;
          height: 39px;
          place-items: center;
          color: #85869a;
          border: 1px solid rgba(184, 178, 197, .34);
          border-radius: 13px;
          background: rgba(255, 253, 255, .42);
          cursor: pointer;
          transition: transform .18s ease, background .18s ease;
        }
        .ops-icon:hover { background: rgba(255,255,255,.7); }
        .ops-icon:active, .ops-action:active, .ops-prompt:active, .ops-record:active, .ops-nav-button:active { transform: scale(.97); }
        .ops-date-strip { display: flex; align-items: center; justify-content: space-between; padding: 17px 1px 14px; }
        .ops-date-copy { color: var(--ops-muted); font-size: 10px; }
        .ops-date-copy strong { display: block; margin-bottom: 2px; color: var(--ops-ink); font-size: 14px; }
        .ops-live { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; color: #6c8a82; border: 1px solid rgba(124,163,151,.3); border-radius: 11px; background: rgba(226,240,235,.58); font-size: 9px; font-weight: 850; }
        .ops-live i { width: 5px; height: 5px; border-radius: 50%; background: #769c8e; }
        .ops-chat {
          position: relative;
          overflow: hidden;
          min-height: calc(100dvh - 186px);
          border: 1px solid rgba(255,255,255,.74);
          border-radius: 27px;
          background:
            radial-gradient(ellipse at 14% 0%, rgba(255,255,255,.86), transparent 38%),
            linear-gradient(155deg, rgba(255,250,253,.7), rgba(238, 239, 247, .46) 54%, rgba(240,232,243,.51));
          box-shadow: 0 26px 65px rgba(100, 91, 121, .12), inset 0 1px rgba(255,255,255,.88);
          backdrop-filter: blur(19px) saturate(1.2);
        }
        .ops-chat::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .5; background: linear-gradient(112deg, transparent 21%, rgba(255,255,255,.53) 38%, transparent 47%, rgba(214,195,226,.2) 68%, transparent 78%); }
        .ops-chat::after { content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit; box-shadow: inset 0 0 0 1px rgba(255,255,255,.25); }
        .ops-chat-head { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 16px 14px 13px; border-bottom: 1px solid rgba(178,173,194,.24); }
        .ops-chat-title { display: flex; align-items: center; gap: 9px; }
        .ops-spark { display: grid; width: 32px; height: 32px; place-items: center; color: #a86f87; border: 1px solid rgba(255,255,255,.86); border-radius: 11px 11px 11px 5px; background: linear-gradient(145deg, rgba(251,225,235,.9), rgba(232,218,241,.77)); box-shadow: inset 0 1px rgba(255,255,255,.8); }
        .ops-chat-title strong { display: block; font-size: 12px; font-weight: 900; }
        .ops-chat-title span { display: block; margin-top: 2px; color: var(--ops-muted); font-size: 9px; }
        .ops-chat-tools button { border: 0; background: transparent; color: #a7a5b5; cursor: pointer; }
        .ops-prompts { position: relative; z-index: 1; display: flex; gap: 7px; overflow: auto; padding: 12px 14px 0; scrollbar-width: none; }
        .ops-prompts::-webkit-scrollbar { display: none; }
        .ops-prompt { flex: 0 0 auto; padding: 8px 11px; color: #777b91; border: 1px solid rgba(172,174,197,.38); border-radius: 10px; background: rgba(255,253,255,.43); font-family: inherit; font-size: 9px; cursor: pointer; transition: transform .18s ease, background .18s ease; }
        .ops-prompt:hover { background: rgba(255,255,255,.72); }
        .ops-messages { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 11px; padding: 17px 14px 174px; }
        .ops-message { max-width: 91%; animation: ops-rise .32s ease both; }
        .ops-message.assistant { align-self: flex-start; }
        .ops-message.user { align-self: flex-end; }
        .ops-bubble { padding: 12px 13px; border: 1px solid rgba(255,255,255,.77); border-radius: 17px 17px 5px 17px; background: rgba(255,255,255,.68); box-shadow: 0 8px 20px rgba(99,91,119,.06); font-size: 12px; line-height: 1.85; }
        .ops-message.user .ops-bubble { border-color: rgba(196,213,228,.62); border-radius: 17px 17px 17px 5px; background: rgba(222,235,242,.74); }
        .ops-time { display: block; margin: 4px 7px 0; color: #a09eae; font-size: 8px; }
        .ops-message.user .ops-time { text-align: left; }
        .ops-note { display: inline-flex; align-items: center; gap: 4px; margin: 4px 7px 0; color: #a5748a; font-size: 8px; }
        .ops-approval { margin: 3px 0 5px; padding: 14px; border: 1px solid rgba(213,184,198,.55); border-radius: 18px; background: linear-gradient(135deg, rgba(255,244,246,.78), rgba(244,236,246,.66)); box-shadow: 0 10px 23px rgba(133, 99, 123, .07), inset 0 1px rgba(255,255,255,.75); animation: ops-rise .4s .12s ease both; }
        .ops-approval-head { display: flex; align-items: center; gap: 8px; margin-bottom: 11px; color: #8f6179; font-size: 11px; font-weight: 900; }
        .ops-approval-head svg { color: #ad7890; }
        .ops-approval-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0 12px; border-top: 1px solid rgba(187,145,166,.22); border-bottom: 1px solid rgba(187,145,166,.22); }
        .ops-approval-row strong { display: block; font-size: 12px; }
        .ops-approval-row span { display: block; margin-top: 3px; color: #9b8291; font-size: 9px; }
        .ops-amount { color: #8e6278; font-size: 16px; font-weight: 900; }
        .ops-approval-actions { display: flex; gap: 7px; margin-top: 11px; }
        .ops-action { flex: 1; min-height: 35px; border: 0; border-radius: 10px; font-family: inherit; font-size: 10px; font-weight: 850; cursor: pointer; transition: transform .18s ease, opacity .18s ease; }
        .ops-action.approve { color: #fff9fa; background: #ae7188; box-shadow: 0 7px 14px rgba(174,113,136,.18); }
        .ops-action.later { color: #8d687e; border: 1px solid rgba(185,148,169,.37); background: rgba(255,253,255,.52); }
        .ops-approved { display: flex; align-items: center; gap: 7px; color: #66897d; font-size: 10px; font-weight: 850; }
        .ops-composer-wrap { position: fixed; right: 12px; bottom: calc(78px + env(safe-area-inset-bottom, 0px)); left: 12px; z-index: 10; }
        .ops-composer { display: flex; align-items: center; gap: 7px; padding: 7px 8px 7px 7px; border: 1px solid rgba(255,255,255,.89); border-radius: 17px; background: rgba(255,253,255,.72); box-shadow: 0 13px 27px rgba(91,88,113,.12), inset 0 1px rgba(255,255,255,.88); backdrop-filter: blur(20px) saturate(1.12); }
        .ops-composer input { min-width: 0; flex: 1; padding: 8px 5px; border: 0; outline: 0; color: var(--ops-ink); background: transparent; font-family: inherit; font-size: 11px; }
        .ops-composer input::placeholder { color: #a09faf; }
        .ops-chat-tool { display: grid; width: 31px; height: 31px; place-items: center; color: #9999aa; border: 0; background: transparent; cursor: pointer; }
        .ops-send { display: grid; width: 34px; height: 34px; place-items: center; color: #fff9fa; border: 0; border-radius: 11px; background: #ae7188; cursor: pointer; box-shadow: 0 6px 13px rgba(174,113,136,.2); }
        .ops-bottom-nav { position: fixed; right: 15px; bottom: 17px; left: 15px; z-index: 4; display: flex; justify-content: space-around; padding: 8px 7px; border: 1px solid rgba(255,255,255,.88); border-radius: 19px; background: rgba(248,246,251,.68); box-shadow: 0 18px 36px rgba(88,87,110,.15), inset 0 1px rgba(255,255,255,.9); backdrop-filter: blur(24px) saturate(1.2); }
        .ops-nav-button { display: flex; min-width: 75px; flex-direction: column; align-items: center; gap: 3px; padding: 5px 12px; color: #9999aa; border: 0; border-radius: 12px; background: transparent; font-family: inherit; font-size: 8px; cursor: pointer; transition: transform .18s ease, color .18s ease, background .18s ease; }
        .ops-nav-button.active { color: #a26781; background: rgba(244,222,233,.72); font-weight: 900; }
        .ops-sheet { position: fixed; right: 0; bottom: -1px; left: 0; z-index: 5; min-height: 66dvh; padding: 0 15px 94px; border: 1px solid rgba(255,255,255,.91); border-bottom: 0; border-radius: 30px 30px 0 0; background:
          radial-gradient(ellipse at 50% -5%, rgba(255,255,255,.91), transparent 43%),
          linear-gradient(135deg, rgba(255,248,253,.8), rgba(231,238,247,.66) 49%, rgba(243,232,246,.71));
          box-shadow: 0 -20px 58px rgba(91,84,115,.18), inset 0 1px rgba(255,255,255,.98);
          backdrop-filter: blur(35px) saturate(1.22);
          transition: transform .36s cubic-bezier(.22,.8,.24,1);
        }
        .ops-sheet::after { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; border-radius: inherit; opacity: .36; background: linear-gradient(108deg, transparent 16%, rgba(255,255,255,.74) 34%, transparent 45%, rgba(215,191,227,.28) 69%, transparent 83%); }
        .ops-sheet-handle-zone { position: relative; z-index: 1; display: flex; justify-content: center; padding: 11px 0 10px; cursor: grab; touch-action: none; }
        .ops-sheet-handle-zone:active { cursor: grabbing; }
        .ops-sheet-handle { width: 43px; height: 4px; border-radius: 9px; background: rgba(127,128,153,.43); box-shadow: 0 1px rgba(255,255,255,.95); }
        .ops-sheet-heading { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 5px 1px 13px; }
        .ops-sheet-heading strong { display: block; font-size: 13px; font-weight: 900; }
        .ops-sheet-heading span { color: var(--ops-muted); font-size: 9px; }
        .ops-sheet-heading > span { padding: 5px 8px; color: #707b91; border: 1px solid rgba(165,166,193,.3); border-radius: 8px; background: rgba(244,242,249,.58); }
        .ops-sheet-tabs { position: relative; z-index: 1; display: flex; gap: 5px; padding: 0 0 10px; border-bottom: 1px solid rgba(165,166,193,.25); }
        .ops-sheet-tab { padding: 7px 10px; color: #9795aa; border: 0; border-radius: 8px; background: transparent; font-family: inherit; font-size: 9px; cursor: pointer; }
        .ops-sheet-tab.active { color: #765d7f; background: rgba(233,221,242,.75); font-weight: 900; }
        .ops-record-list { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 7px; padding-top: 11px; }
        .ops-record { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px 9px; text-align: right; border: 1px solid rgba(255,255,255,.71); border-radius: 14px; background: rgba(255,255,255,.48); box-shadow: 0 6px 15px rgba(95,87,114,.045); font-family: inherit; cursor: pointer; transition: transform .18s ease, background .18s ease; }
        .ops-record:hover, .ops-record.selected { background: rgba(255,255,255,.76); transform: translateX(-2px); }
        .ops-record-mark { display: grid; width: 31px; height: 31px; flex: 0 0 auto; place-items: center; border-radius: 10px; }
        .ops-record-mark.rose { color: var(--ops-rose); background: var(--ops-rose-soft); }
        .ops-record-mark.sky { color: var(--ops-sky); background: var(--ops-sky-soft); }
        .ops-record-mark.lilac { color: var(--ops-lilac); background: var(--ops-lilac-soft); }
        .ops-record-copy { min-width: 0; flex: 1; }
        .ops-record-copy strong, .ops-record-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ops-record-copy strong { color: var(--ops-ink); font-size: 10px; }
        .ops-record-copy span { margin-top: 2px; color: #9594a6; font-size: 8px; }
        .ops-record-price { color: #778397; font-size: 9px; font-weight: 850; }
        .ops-selected-detail { position: relative; z-index: 1; margin-top: 9px; padding: 9px 10px; color: #6e7d90; border: 1px solid rgba(148,164,195,.3); border-radius: 10px; background: rgba(228,237,247,.53); font-size: 9px; line-height: 1.7; }
        .ops-context { position: relative; z-index: 1; margin-top: 12px; padding: 14px; border: 1px solid rgba(255,255,255,.76); border-radius: 15px; background: rgba(255,255,255,.5); }
        .ops-context-title { display: flex; align-items: center; gap: 7px; color: #766486; font-size: 11px; font-weight: 900; }
        .ops-context p { margin: 10px 0; color: #707d91; font-size: 10px; line-height: 1.8; }
        .ops-context-row { display: flex; align-items: center; gap: 6px; color: #7a8e8d; font-size: 9px; }
        .ops-menu-scrim { position: fixed; inset: 0; z-index: 7; border: 0; background: rgba(71,68,92,.14); backdrop-filter: blur(4px); cursor: pointer; }
        .ops-menu { position: fixed; top: 0; right: 0; bottom: 0; z-index: 8; width: min(82vw, 320px); padding: 16px; border-left: 1px solid rgba(255,255,255,.88); background: rgba(248,245,250,.88); box-shadow: -18px 0 37px rgba(81,76,105,.15); backdrop-filter: blur(26px); animation: ops-slide .28s ease both; }
        .ops-menu-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 21px; border-bottom: 1px solid rgba(174,171,191,.25); }
        .ops-menu-head strong { font-size: 13px; }
        .ops-menu-list { display: flex; flex-direction: column; gap: 6px; padding-top: 19px; }
        .ops-menu-list button { display: flex; align-items: center; gap: 10px; padding: 13px 11px; color: #73758a; border: 1px solid transparent; border-radius: 12px; background: transparent; font-family: inherit; font-size: 11px; text-align: right; cursor: pointer; }
        .ops-menu-list button:hover { border-color: rgba(174,171,191,.25); background: rgba(255,255,255,.57); }
        .ops-toast { position: fixed; right: 18px; bottom: 94px; left: 18px; z-index: 9; padding: 11px 13px; color: #697f84; border: 1px solid rgba(255,255,255,.88); border-radius: 12px; background: rgba(237,247,246,.91); box-shadow: 0 12px 28px rgba(70,91,104,.16); font-family: inherit; font-size: 10px; cursor: pointer; animation: ops-rise .25s ease both; }
        @keyframes ops-rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ops-slide { from { opacity: 0; transform: translateX(15px); } to { opacity: 1; transform: translateX(0); } }
        @media (min-width: 600px) { .ops-shell { max-width: 450px; margin: 0 auto; } .ops-bottom-nav, .ops-composer-wrap { right: calc(50% - 210px); left: calc(50% - 210px); } }
      `}</style>

      <div className="ops-app">
        <header className="ops-header">
          <div className="ops-header-side">
            <div className="ops-avatar"><Sparkles size={17} /></div>
            <div className="ops-header-copy">
              <strong>سكرتير كريم</strong>
              <small><i className="ops-online" /> حاضر في سياقك · يتعلم من الحديث</small>
            </div>
          </div>
          <div className="ops-header-actions">
            <button className="ops-icon" aria-label="التنبيهات" onClick={() => setShowNotice(true)}><Bell size={16} /></button>
            <button className="ops-icon" aria-label="فتح القائمة" onClick={() => setMenuOpen(true)}><Menu size={17} /></button>
          </div>
        </header>

        <div className="ops-date-strip">
          <div className="ops-date-copy"><strong>الأربعاء، ٢٤ أبريل</strong>نتقدم من آخر ما قلته، لا من شاشة جديدة</div>
          <span className="ops-live"><i /> السياق حي</span>
        </div>

        <section className="ops-chat" aria-label="محادثة السكرتير">
          <div className="ops-chat-head">
            <div className="ops-chat-title">
              <div className="ops-spark"><Sparkles size={15} /></div>
              <div><strong>حديثنا اليوم</strong><span>مكان واحد للفكرة والخطوة التالية</span></div>
            </div>
            <div className="ops-chat-tools"><button aria-label="فتح السجلات" onClick={() => { setSheetTab("records"); snapSheet(43); }}><Archive size={15} /></button></div>
          </div>
          <div className="ops-prompts">
            {prompts.map((prompt) => <button className="ops-prompt" key={prompt} onClick={() => setDraft(prompt)}>{prompt}</button>)}
          </div>
          <div className="ops-messages">
            {messages.map((message) => (
              <div className={`ops-message ${message.role}`} key={message.id}>
                <div className="ops-bubble">{message.text}</div>
                <span className="ops-time">{message.time}</span>
                {message.note && <span className="ops-note"><Check size={10} /> {message.note}</span>}
              </div>
            ))}
            <div className="ops-approval">
              {!approved ? (
                <>
                  <div className="ops-approval-head"><ShieldCheck size={15} /> خطوة محفوظة بانتظار موافقتك</div>
                  <div className="ops-approval-row">
                    <div><strong>غداء العمل</strong><span>محمود · مصروف اقترحه حديثنا</span></div>
                    <span className="ops-amount">١٬٢٥٠ ج.م</span>
                  </div>
                  <div className="ops-approval-actions">
                    <button className="ops-action approve" onClick={() => { setApproved(true); setRecordCount(4); setShowNotice(true); }}>اعتماد المصروف</button>
                    <button className="ops-action later" onClick={() => setShowNotice(true)}>أبقيه هنا</button>
                  </div>
                </>
              ) : (
                <div className="ops-approved"><CheckCircle2 size={16} /> تم اعتماد غداء العمل — واصلنا من نفس الحديث</div>
              )}
            </div>
          </div>
        </section>
        <div className="ops-composer-wrap">
          <div className="ops-composer">
            <button className="ops-chat-tool" aria-label="إرفاق ملف" onClick={() => setShowNotice(true)}><Paperclip size={16} /></button>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="أكمل حديثك هنا..." aria-label="اكتب رسالة" />
            <button className="ops-chat-tool" aria-label="تسجيل صوتي" onClick={() => setShowNotice(true)}><Mic size={16} /></button>
            <button className="ops-send" aria-label="إرسال الرسالة" onClick={send}><Send size={15} /></button>
          </div>
        </div>
      </div>

      <nav className="ops-bottom-nav" aria-label="التنقل السفلي">
        <button className="ops-nav-button active" onClick={() => snapSheet(80)}><Sparkles size={18} />المحادثة</button>
        <button className="ops-nav-button" onClick={() => { setSheetTab("records"); snapSheet(43); }}><Archive size={18} />السجلات</button>
        <button className="ops-nav-button" onClick={() => { setSheetTab("context"); snapSheet(43); }}><LayoutDashboard size={18} />الصورة الأكبر</button>
      </nav>

      <section
        ref={sheetRef}
        className="ops-sheet"
        aria-label="السجلات والسياق"
        style={{ transform: `translateY(${visiblePosition}%)` }}
      >
        <div className="ops-sheet-handle-zone" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
          <span className="ops-sheet-handle" />
        </div>
        <div className="ops-sheet-heading">
          <div><strong>السجلات والسياق</strong><span>اسحب للأعلى لربط ما قيل بما حُفظ</span></div>
          <span>{recordCount} عناصر مرتبطة</span>
        </div>
        <div className="ops-sheet-tabs">
          <button className={`ops-sheet-tab ${sheetTab === "records" ? "active" : ""}`} onClick={() => setSheetTab("records")}>السجلات</button>
          <button className={`ops-sheet-tab ${sheetTab === "context" ? "active" : ""}`} onClick={() => setSheetTab("context")}>الصورة الأكبر</button>
        </div>
        {sheetTab === "records" ? (
          <>
            <div className="ops-record-list">
              {records.map((record) => {
                const Icon = record.icon;
                return (
                  <button className={`ops-record ${activeRecord === record.id ? "selected" : ""}`} key={record.id} onClick={() => selectRecord(record.id)}>
                    <span className={`ops-record-mark ${record.tone}`}><Icon size={15} /></span>
                    <span className="ops-record-copy"><strong>{record.title}</strong><span>{record.meta}</span></span>
                    <span className="ops-record-price">{record.detail}</span>
                    <ChevronLeft size={14} color="#a09faf" />
                  </button>
                );
              })}
            </div>
            {selectedRecord && <div className="ops-selected-detail">هذا السجل داخل سياق الحديث الحالي. قل «عدّل السجل» وسأبدأ من تفاصيله لا من الصفر.</div>}
          </>
        ) : (
          <div className="ops-context">
            <div className="ops-context-title"><ShieldCheck size={16} /> خريطة اليوم كما فهمتها</div>
            <p>أنت توازن بين مصروف الغداء واتصال التصميم. المصروف ينتظر اعتمادك، والاتصال هو خطوتك التالية — سأبقي الاثنين قريبين من بعضهما.</p>
            <div className="ops-context-row"><Check size={14} /> آخر مزامنة قبل ٣ دقائق · ٣ روابط من الحديث</div>
          </div>
        )}
      </section>

      {menuOpen && (
        <>
          <button className="ops-menu-scrim" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} />
          <aside className="ops-menu">
            <div className="ops-menu-head"><strong>مساحات سكرتيرك</strong><button className="ops-icon" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={16} /></button></div>
            <div className="ops-menu-list">
              <button onClick={() => { setMenuOpen(false); snapSheet(80); }}><Sparkles size={16} /> المحادثة</button>
              <button onClick={() => { setSheetTab("records"); snapSheet(43); setMenuOpen(false); }}><Archive size={16} /> السجلات</button>
              <button onClick={() => { setSheetTab("context"); snapSheet(43); setMenuOpen(false); }}><ShieldCheck size={16} /> الصورة الأكبر</button>
            </div>
          </aside>
        </>
      )}
      {showNotice && <button className="ops-toast" onClick={() => setShowNotice(false)}>تم تحديث السياق — اضغط للإخفاء</button>}
    </main>
  );
}