import {
  Archive,
  ArrowUpLeft,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Keyboard,
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
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

type Message = {
  id: number;
  role: "assistant" | "user";
  text: string;
  time: string;
  note?: string;
};

type SheetTab = "records" | "context";

const quickPrompts = ["رتّب لي يومي", "سجّل مصروفاً", "ماذا فاتني؟"];
const snapPoints = [0, 43, 80];
const keyboardRows = [
  ["ض", "ص", "ث", "ق", "ف", "غ", "ع", "ه", "خ", "ح"],
  ["ش", "س", "ي", "ب", "ل", "ا", "ت", "ن", "م", "ك"],
  ["ئ", "ء", "ؤ", "ر", "لا", "ى", "ة", "و", "ز", "ظ"],
];

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

export default function OpalescentPearlSecretaryElevatedKeyboard() {
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
  const [keyboardOpen, setKeyboardOpen] = useState(true);
  const [nativeInset, setNativeInset] = useState(0);
  const sheetRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragState = useRef({ startY: 0, startPosition: 80, dragging: false });

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const syncInset = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setNativeInset(inset);
    };
    syncInset();
    viewport.addEventListener("resize", syncInset);
    viewport.addEventListener("scroll", syncInset);
    window.addEventListener("resize", syncInset);
    return () => {
      viewport.removeEventListener("resize", syncInset);
      viewport.removeEventListener("scroll", syncInset);
      window.removeEventListener("resize", syncInset);
    };
  }, []);

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
    setShowNotice(true);
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

  const openKeyboard = () => {
    setKeyboardOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 40);
  };

  const selectRecord = (id: string) => {
    setActiveRecord(id);
    setShowNotice(true);
  };

  const visiblePosition = dragPosition ?? sheetPosition;
  const selectedRecord = records.find((record) => record.id === activeRecord);
  const keyboardHeight = keyboardOpen ? 240 : 0;

  return (
    <main
      className="pearl-elevated-shell"
      dir="rtl"
      style={
        {
          "--keyboard-height": `${Math.max(keyboardHeight, nativeInset)}px`,
        } as CSSProperties
      }
    >
      <style>{`
        .pearl-elevated-shell {
          --pearl-ink: #303446;
          --pearl-muted: #7b7d91;
          --pearl-rose: #ad7188;
          --pearl-plum: #786483;
          width: 100%;
          min-height: 100dvh;
          overflow: hidden;
          color: var(--pearl-ink);
          background:
            radial-gradient(circle at 8% 4%, rgba(255, 218, 226, .82), transparent 28%),
            radial-gradient(circle at 105% 16%, rgba(189, 220, 237, .7), transparent 33%),
            radial-gradient(circle at 45% 114%, rgba(222, 206, 239, .72), transparent 36%),
            linear-gradient(140deg, #f3eff2 0%, #e8eef1 48%, #eee8f2 100%);
          font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", sans-serif;
          letter-spacing: -.018em;
        }
        .pearl-elevated-shell *, .pearl-elevated-shell *::before, .pearl-elevated-shell *::after { box-sizing: border-box; }
        .pearl-elevated-app { min-height: 100dvh; padding: 0 15px 278px; }
        .pearl-elevated-header {
          position: sticky; top: 0; z-index: 4; display: flex; align-items: center; justify-content: space-between;
          min-height: 70px; margin: 0 -15px; padding: 0 15px; border-bottom: 1px solid rgba(255,255,255,.52);
          background: rgba(242,239,242,.58); backdrop-filter: blur(24px) saturate(1.15);
        }
        .pearl-header-side, .pearl-header-actions, .pearl-chat-tools { display: flex; align-items: center; gap: 8px; }
        .pearl-elevated-avatar {
          position: relative; display: grid; width: 38px; height: 38px; place-items: center; color: #fff8f6;
          border: 1px solid rgba(255,255,255,.7); border-radius: 14px 14px 14px 6px;
          background: linear-gradient(135deg, rgba(255,255,255,.46), transparent 40%), linear-gradient(145deg, #d28ca1, #9d718e);
          box-shadow: 0 10px 24px rgba(147,101,127,.18), inset 0 1px rgba(255,255,255,.64);
        }
        .pearl-elevated-avatar::after { content: ""; position: absolute; right: -4px; bottom: -3px; width: 9px; height: 9px; border: 2px solid #f3edef; border-radius: 50%; background: #739b8d; }
        .pearl-header-copy strong { display: block; font-size: 13px; font-weight: 900; }
        .pearl-header-copy small { display: flex; align-items: center; gap: 5px; margin-top: 2px; color: var(--pearl-muted); font-size: 9px; }
        .pearl-online { width: 5px; height: 5px; border-radius: 50%; background: #769b8d; box-shadow: 0 0 0 3px rgba(118,155,141,.13); }
        .pearl-icon {
          display: grid; width: 39px; height: 39px; place-items: center; color: #85869a; border: 1px solid rgba(184,178,197,.34);
          border-radius: 13px; background: rgba(255,253,255,.42); cursor: pointer; transition: transform .18s ease, background .18s ease;
        }
        .pearl-icon:hover { background: rgba(255,255,255,.7); }
        .pearl-icon:active, .pearl-action:active, .pearl-prompt:active, .pearl-record:active, .pearl-nav-button:active, .pearl-key:active { transform: scale(.97); }
        .pearl-date-strip { display: flex; align-items: center; justify-content: space-between; padding: 17px 1px 14px; }
        .pearl-date-copy { color: var(--pearl-muted); font-size: 10px; }
        .pearl-date-copy strong { display: block; margin-bottom: 2px; color: var(--pearl-ink); font-size: 14px; }
        .pearl-live { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; color: #6c8a82; border: 1px solid rgba(124,163,151,.3); border-radius: 11px; background: rgba(226,240,235,.58); font-size: 9px; font-weight: 850; }
        .pearl-live i { width: 5px; height: 5px; border-radius: 50%; background: #769c8e; }
        .pearl-chat {
          position: relative; overflow: hidden; min-height: calc(100dvh - 188px); border: 1px solid rgba(255,255,255,.74);
          border-radius: 27px; background: radial-gradient(ellipse at 14% 0%, rgba(255,255,255,.86), transparent 38%), linear-gradient(155deg, rgba(255,250,253,.7), rgba(238,239,247,.46) 54%, rgba(240,232,243,.51));
          box-shadow: 0 26px 65px rgba(100,91,121,.12), inset 0 1px rgba(255,255,255,.88); backdrop-filter: blur(19px) saturate(1.2);
        }
        .pearl-chat::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .5; background: linear-gradient(112deg, transparent 21%, rgba(255,255,255,.53) 38%, transparent 47%, rgba(214,195,226,.2) 68%, transparent 78%); }
        .pearl-chat-head { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 16px 14px 13px; border-bottom: 1px solid rgba(178,173,194,.24); }
        .pearl-chat-title { display: flex; align-items: center; gap: 9px; }
        .pearl-spark { display: grid; width: 32px; height: 32px; place-items: center; color: #a86f87; border: 1px solid rgba(255,255,255,.86); border-radius: 11px 11px 11px 5px; background: linear-gradient(145deg, rgba(251,225,235,.9), rgba(232,218,241,.77)); box-shadow: inset 0 1px rgba(255,255,255,.8); }
        .pearl-chat-title strong { display: block; font-size: 12px; font-weight: 900; }
        .pearl-chat-title span { display: block; margin-top: 2px; color: var(--pearl-muted); font-size: 9px; }
        .pearl-chat-tools button { border: 0; background: transparent; color: #a7a5b5; cursor: pointer; }
        .pearl-prompts { position: relative; z-index: 1; display: flex; gap: 7px; overflow: auto; padding: 12px 14px 0; scrollbar-width: none; }
        .pearl-prompts::-webkit-scrollbar { display: none; }
        .pearl-prompt { flex: 0 0 auto; padding: 8px 11px; color: #777b91; border: 1px solid rgba(172,174,197,.38); border-radius: 10px; background: rgba(255,253,255,.43); font-family: inherit; font-size: 9px; cursor: pointer; transition: transform .18s ease, background .18s ease; }
        .pearl-prompt:hover { background: rgba(255,255,255,.72); }
        .pearl-messages { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 11px; padding: 17px 14px 190px; }
        .pearl-message { max-width: 91%; animation: pearl-rise .32s ease both; }
        .pearl-message.assistant { align-self: flex-start; }
        .pearl-message.user { align-self: flex-end; }
        .pearl-bubble { padding: 12px 13px; border: 1px solid rgba(255,255,255,.77); border-radius: 17px 17px 5px 17px; background: rgba(255,255,255,.68); box-shadow: 0 8px 20px rgba(99,91,119,.06); font-size: 12px; line-height: 1.85; }
        .pearl-message.user .pearl-bubble { border-color: rgba(196,213,228,.62); border-radius: 17px 17px 17px 5px; background: rgba(222,235,242,.74); }
        .pearl-time { display: block; margin: 4px 7px 0; color: #a09eae; font-size: 8px; }
        .pearl-message.user .pearl-time { text-align: left; }
        .pearl-note { display: inline-flex; align-items: center; gap: 4px; margin: 4px 7px 0; color: #a5748a; font-size: 8px; }
        .pearl-approval { margin: 3px 0 5px; padding: 14px; border: 1px solid rgba(213,184,198,.55); border-radius: 18px; background: linear-gradient(135deg, rgba(255,244,246,.78), rgba(244,236,246,.66)); box-shadow: 0 10px 23px rgba(133,99,123,.07), inset 0 1px rgba(255,255,255,.75); animation: pearl-rise .4s .12s ease both; }
        .pearl-approval-head { display: flex; align-items: center; gap: 8px; margin-bottom: 11px; color: #8f6179; font-size: 11px; font-weight: 900; }
        .pearl-approval-head svg { color: #ad7890; }
        .pearl-approval-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0 12px; border-top: 1px solid rgba(187,145,166,.22); border-bottom: 1px solid rgba(187,145,166,.22); }
        .pearl-approval-row strong { display: block; font-size: 12px; }
        .pearl-approval-row span { display: block; margin-top: 3px; color: #9b8291; font-size: 9px; }
        .pearl-amount { color: #8e6278; font-size: 16px; font-weight: 900; }
        .pearl-approval-actions { display: flex; gap: 7px; margin-top: 11px; }
        .pearl-action { flex: 1; min-height: 35px; border: 0; border-radius: 10px; font-family: inherit; font-size: 10px; font-weight: 850; cursor: pointer; transition: transform .18s ease, opacity .18s ease; }
        .pearl-action.approve { color: #fff9fa; background: #ae7188; box-shadow: 0 7px 14px rgba(174,113,136,.18); }
        .pearl-action.later { color: #8d687e; border: 1px solid rgba(185,148,169,.37); background: rgba(255,253,255,.52); }
        .pearl-approved { display: flex; align-items: center; gap: 7px; color: #66897d; font-size: 10px; font-weight: 850; }
        .pearl-keyboard {
          position: fixed; right: 0; bottom: 0; left: 0; z-index: 8; padding: 12px 9px calc(12px + env(safe-area-inset-bottom, 0px));
          border-top: 1px solid rgba(255,255,255,.8); background: rgba(198, 209, 221, .58); box-shadow: 0 -14px 36px rgba(89,91,114,.14);
          backdrop-filter: blur(24px) saturate(1.12); animation: pearl-keyboard-in .3s ease both;
        }
        .pearl-keyboard-top { display: flex; align-items: center; justify-content: space-between; padding: 0 5px 8px; color: #77788c; font-size: 8px; }
        .pearl-keyboard-top strong { color: #707284; font-size: 9px; }
        .pearl-keyboard-top button { display: inline-flex; align-items: center; gap: 5px; color: #77788c; border: 0; background: transparent; font-family: inherit; font-size: 8px; cursor: pointer; }
        .pearl-key-row { display: flex; gap: 4px; margin-top: 5px; direction: rtl; }
        .pearl-key { flex: 1; min-width: 0; height: 32px; color: #5e6173; border: 1px solid rgba(255,255,255,.74); border-radius: 7px; background: rgba(246,248,250,.64); box-shadow: 0 2px 3px rgba(88,91,109,.12), inset 0 1px rgba(255,255,255,.8); font-family: inherit; font-size: 11px; cursor: pointer; transition: transform .14s ease; }
        .pearl-key.space { flex: 3.7; color: #858697; font-size: 9px; }
        .pearl-key.special { flex: 1.4; color: #77798a; }
        .pearl-composer-wrap {
          position: fixed; right: 12px; bottom: calc(var(--keyboard-height) + 13px); left: 12px; z-index: 30;
          transition: bottom .22s ease-out;
        }
        .pearl-composer-wrap::before { content: "المسودة ترتفع فوق لوحة الكتابة"; position: absolute; right: 12px; bottom: calc(100% + 7px); padding: 4px 7px; color: #8b7a8a; border: 1px solid rgba(255,255,255,.72); border-radius: 7px; background: rgba(248,244,249,.78); font-size: 8px; opacity: 0; transform: translateY(3px); transition: opacity .18s ease, transform .18s ease; pointer-events: none; }
        .pearl-composer-wrap:focus-within::before { opacity: 1; transform: translateY(0); }
        .pearl-composer { display: flex; align-items: center; gap: 7px; padding: 7px 8px 7px 7px; border: 1px solid rgba(255,255,255,.92); border-radius: 17px; background: rgba(255,253,255,.82); box-shadow: 0 13px 27px rgba(91,88,113,.18), 0 0 0 4px rgba(255,255,255,.12), inset 0 1px rgba(255,255,255,.88); backdrop-filter: blur(22px) saturate(1.15); }
        .pearl-composer input { min-width: 0; flex: 1; padding: 8px 5px; border: 0; outline: 0; color: var(--pearl-ink); background: transparent; font-family: inherit; font-size: 11px; }
        .pearl-composer input::placeholder { color: #a09faf; }
        .pearl-chat-tool { display: grid; width: 31px; height: 31px; place-items: center; color: #9999aa; border: 0; background: transparent; cursor: pointer; }
        .pearl-send { display: grid; width: 34px; height: 34px; place-items: center; color: #fff9fa; border: 0; border-radius: 11px; background: #ae7188; cursor: pointer; box-shadow: 0 6px 13px rgba(174,113,136,.2); }
        .pearl-bottom-nav { position: fixed; right: 15px; bottom: 17px; left: 15px; z-index: 4; display: flex; justify-content: space-around; padding: 8px 7px; border: 1px solid rgba(255,255,255,.88); border-radius: 19px; background: rgba(248,246,251,.7); box-shadow: 0 18px 36px rgba(88,87,110,.15), inset 0 1px rgba(255,255,255,.9); backdrop-filter: blur(24px) saturate(1.2); opacity: .22; transform: translateY(8px); pointer-events: none; }
        .pearl-nav-button { display: flex; min-width: 75px; flex-direction: column; align-items: center; gap: 3px; padding: 5px 12px; color: #9999aa; border: 0; border-radius: 12px; background: transparent; font-family: inherit; font-size: 8px; cursor: pointer; }
        .pearl-nav-button.active { color: #a26781; background: rgba(244,222,233,.72); font-weight: 900; }
        .pearl-sheet { position: fixed; right: 0; bottom: -1px; left: 0; z-index: 20; min-height: 66dvh; padding: 0 15px 94px; border: 1px solid rgba(255,255,255,.91); border-bottom: 0; border-radius: 30px 30px 0 0; background: radial-gradient(ellipse at 50% -5%, rgba(255,255,255,.91), transparent 43%), linear-gradient(135deg, rgba(255,248,253,.8), rgba(231,238,247,.66) 49%, rgba(243,232,246,.71)); box-shadow: 0 -20px 58px rgba(91,84,115,.18), inset 0 1px rgba(255,255,255,.98); backdrop-filter: blur(35px) saturate(1.22); transition: transform .36s cubic-bezier(.22,.8,.24,1); }
        .pearl-sheet::after { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; border-radius: inherit; opacity: .36; background: linear-gradient(108deg, transparent 16%, rgba(255,255,255,.74) 34%, transparent 45%, rgba(215,191,227,.28) 69%, transparent 83%); }
        .pearl-sheet-handle-zone { position: relative; z-index: 1; display: flex; justify-content: center; padding: 11px 0 10px; cursor: grab; touch-action: none; }
        .pearl-sheet-handle-zone:active { cursor: grabbing; }
        .pearl-sheet-handle { width: 43px; height: 4px; border-radius: 9px; background: rgba(127,128,153,.43); box-shadow: 0 1px rgba(255,255,255,.95); }
        .pearl-sheet-heading { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 5px 1px 13px; }
        .pearl-sheet-heading strong { display: block; font-size: 13px; font-weight: 900; }
        .pearl-sheet-heading div span { color: var(--pearl-muted); font-size: 9px; }
        .pearl-sheet-heading > span { padding: 5px 8px; color: #707b91; border: 1px solid rgba(165,166,193,.3); border-radius: 8px; background: rgba(244,242,249,.58); font-size: 9px; }
        .pearl-sheet-tabs { position: relative; z-index: 1; display: flex; gap: 5px; padding: 0 0 10px; border-bottom: 1px solid rgba(165,166,193,.25); }
        .pearl-sheet-tab { padding: 7px 10px; color: #9795aa; border: 0; border-radius: 8px; background: transparent; font-family: inherit; font-size: 9px; cursor: pointer; }
        .pearl-sheet-tab.active { color: #765d7f; background: rgba(233,221,242,.75); font-weight: 900; }
        .pearl-record-list { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 7px; padding-top: 11px; }
        .pearl-record { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px 9px; text-align: right; border: 1px solid rgba(255,255,255,.71); border-radius: 14px; background: rgba(255,255,255,.48); box-shadow: 0 6px 15px rgba(95,87,114,.045); font-family: inherit; cursor: pointer; transition: transform .18s ease, background .18s ease; }
        .pearl-record:hover, .pearl-record.selected { background: rgba(255,255,255,.76); transform: translateX(-2px); }
        .pearl-record-mark { display: grid; width: 31px; height: 31px; flex: 0 0 auto; place-items: center; border-radius: 10px; }
        .pearl-record-mark.rose { color: #b87087; background: #f1dce4; }
        .pearl-record-mark.sky { color: #6c8fa6; background: #dcebf0; }
        .pearl-record-mark.lilac { color: #8e82aa; background: #e8e1f1; }
        .pearl-record-copy { min-width: 0; flex: 1; }
        .pearl-record-copy strong, .pearl-record-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pearl-record-copy strong { color: var(--pearl-ink); font-size: 10px; }
        .pearl-record-copy span { margin-top: 2px; color: #9594a6; font-size: 8px; }
        .pearl-record-price { color: #778397; font-size: 9px; font-weight: 850; }
        .pearl-selected-detail { position: relative; z-index: 1; margin-top: 9px; padding: 9px 10px; color: #6e7d90; border: 1px solid rgba(148,164,195,.3); border-radius: 10px; background: rgba(228,237,247,.53); font-size: 9px; line-height: 1.7; }
        .pearl-context { position: relative; z-index: 1; margin-top: 12px; padding: 14px; border: 1px solid rgba(255,255,255,.76); border-radius: 15px; background: rgba(255,255,255,.5); }
        .pearl-context-title { display: flex; align-items: center; gap: 7px; color: #766486; font-size: 11px; font-weight: 900; }
        .pearl-context p { margin: 10px 0; color: #707d91; font-size: 10px; line-height: 1.8; }
        .pearl-context-row { display: flex; align-items: center; gap: 6px; color: #7a8e8d; font-size: 9px; }
        .pearl-menu-scrim { position: fixed; inset: 0; z-index: 35; border: 0; background: rgba(71,68,92,.14); backdrop-filter: blur(4px); cursor: pointer; }
        .pearl-menu { position: fixed; top: 0; right: 0; bottom: 0; z-index: 36; width: min(82vw, 320px); padding: 16px; border-left: 1px solid rgba(255,255,255,.88); background: rgba(248,245,250,.9); box-shadow: -18px 0 37px rgba(81,76,105,.15); backdrop-filter: blur(26px); animation: pearl-slide .28s ease both; }
        .pearl-menu-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 21px; border-bottom: 1px solid rgba(174,171,191,.25); }
        .pearl-menu-head strong { font-size: 13px; }
        .pearl-menu-list { display: flex; flex-direction: column; gap: 6px; padding-top: 19px; }
        .pearl-menu-list button { display: flex; align-items: center; gap: 10px; padding: 13px 11px; color: #73758a; border: 1px solid transparent; border-radius: 12px; background: transparent; font-family: inherit; font-size: 11px; text-align: right; cursor: pointer; }
        .pearl-menu-list button:hover { border-color: rgba(174,171,191,.25); background: rgba(255,255,255,.57); }
        .pearl-toast { position: fixed; right: 18px; bottom: calc(var(--keyboard-height) + 82px); left: 18px; z-index: 34; padding: 11px 13px; color: #697f84; border: 1px solid rgba(255,255,255,.88); border-radius: 12px; background: rgba(237,247,246,.94); box-shadow: 0 12px 28px rgba(70,91,104,.16); font-family: inherit; font-size: 10px; cursor: pointer; animation: pearl-rise .25s ease both; transition: bottom .18s ease-out; }
        @keyframes pearl-rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pearl-slide { from { opacity: 0; transform: translateX(15px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes pearl-keyboard-in { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @media (min-width: 600px) {
          .pearl-elevated-shell { max-width: 450px; margin: 0 auto; }
          .pearl-bottom-nav, .pearl-composer-wrap, .pearl-toast { right: calc(50% - 210px); left: calc(50% - 210px); }
          .pearl-keyboard { right: calc(50% - 225px); left: calc(50% - 225px); }
        }
      `}</style>

      <div className="pearl-elevated-app">
        <header className="pearl-elevated-header">
          <div className="pearl-header-side">
            <div className="pearl-elevated-avatar"><Sparkles size={17} /></div>
            <div className="pearl-header-copy">
              <strong>سكرتير كريم</strong>
              <small><i className="pearl-online" /> حاضر في سياقك · يتعلم من الحديث</small>
            </div>
          </div>
          <div className="pearl-header-actions">
            <button className="pearl-icon" aria-label="التنبيهات" onClick={() => setShowNotice(true)}><Bell size={16} /></button>
            <button className="pearl-icon" aria-label="فتح القائمة" onClick={() => setMenuOpen(true)}><Menu size={17} /></button>
          </div>
        </header>

        <div className="pearl-date-strip">
          <div className="pearl-date-copy"><strong>الأربعاء، ٢٤ أبريل</strong>المسودة ترتفع فوق لوحة الكتابة، وحديثنا لا ينقطع</div>
          <span className="pearl-live"><i /> السياق حي</span>
        </div>

        <section className="pearl-chat" aria-label="محادثة السكرتير">
          <div className="pearl-chat-head">
            <div className="pearl-chat-title">
              <div className="pearl-spark"><Sparkles size={15} /></div>
              <div><strong>حديثنا اليوم</strong><span>مكان واحد للفكرة والخطوة التالية</span></div>
            </div>
            <div className="pearl-chat-tools">
              <button aria-label="فتح السجلات" onClick={() => { setSheetTab("records"); snapSheet(43); }}><Archive size={15} /></button>
            </div>
          </div>
          <div className="pearl-prompts">
            {quickPrompts.map((prompt) => <button className="pearl-prompt" key={prompt} onClick={() => { setDraft(prompt); openKeyboard(); }}>{prompt}</button>)}
          </div>
          <div className="pearl-messages">
            {messages.map((message) => (
              <div className={`pearl-message ${message.role}`} key={message.id}>
                <div className="pearl-bubble">{message.text}</div>
                <span className="pearl-time">{message.time}</span>
                {message.note && <span className="pearl-note"><Check size={10} /> {message.note}</span>}
              </div>
            ))}
            <div className="pearl-approval">
              {!approved ? (
                <>
                  <div className="pearl-approval-head"><ShieldCheck size={15} /> خطوة محفوظة بانتظار موافقتك</div>
                  <div className="pearl-approval-row">
                    <div><strong>غداء العمل</strong><span>محمود · مصروف اقترحه حديثنا</span></div>
                    <span className="pearl-amount">١٬٢٥٠ ج.م</span>
                  </div>
                  <div className="pearl-approval-actions">
                    <button className="pearl-action approve" onClick={() => { setApproved(true); setRecordCount(4); setShowNotice(true); }}>اعتماد المصروف</button>
                    <button className="pearl-action later" onClick={() => setShowNotice(true)}>أبقيه هنا</button>
                  </div>
                </>
              ) : (
                <div className="pearl-approved"><CheckCircle2 size={16} /> تم اعتماد غداء العمل — واصلنا من نفس الحديث</div>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="pearl-composer-wrap">
        <div className="pearl-composer">
          <button className="pearl-chat-tool" aria-label="إرفاق ملف" onClick={() => setShowNotice(true)}><Paperclip size={16} /></button>
          <input
            ref={inputRef}
            value={draft}
            onFocus={() => setKeyboardOpen(true)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") send(); }}
            placeholder="أكمل حديثك هنا..."
            aria-label="اكتب رسالة"
          />
          <button className="pearl-chat-tool" aria-label="تسجيل صوتي" onClick={() => setShowNotice(true)}><Mic size={16} /></button>
          <button className="pearl-send" aria-label="إرسال الرسالة" onClick={send}><Send size={15} /></button>
        </div>
      </div>

      {keyboardOpen && (
        <section className="pearl-keyboard" aria-label="لوحة كتابة شفافة">
          <div className="pearl-keyboard-top">
            <strong>لوحة كتابة شفافة</strong>
            <button onClick={() => { setKeyboardOpen(false); inputRef.current?.blur(); }}><Keyboard size={12} /> إخفاء</button>
          </div>
          {keyboardRows.map((row) => (
            <div className="pearl-key-row" key={row.join("-")}>
              {row.map((letter) => <button className="pearl-key" key={letter} onClick={() => setDraft((current) => `${current}${letter}`)}>{letter}</button>)}
            </div>
          ))}
          <div className="pearl-key-row">
            <button className="pearl-key special" onClick={() => setDraft((current) => current.slice(0, -1))}>حذف</button>
            <button className="pearl-key space" onClick={() => setDraft((current) => `${current} `)}>مسافة</button>
            <button className="pearl-key special" onClick={send}><ArrowUpLeft size={14} /></button>
          </div>
        </section>
      )}

      <nav className="pearl-bottom-nav" aria-label="التنقل السفلي">
        <button className="pearl-nav-button active" onClick={() => snapSheet(80)}><Sparkles size={18} />المحادثة</button>
        <button className="pearl-nav-button" onClick={() => { setSheetTab("records"); snapSheet(43); }}><Archive size={18} />السجلات</button>
        <button className="pearl-nav-button" onClick={() => { setSheetTab("context"); snapSheet(43); }}><LayoutDashboard size={18} />الصورة الأكبر</button>
      </nav>

      <section ref={sheetRef} className="pearl-sheet" aria-label="السجلات والسياق" style={{ transform: `translateY(${visiblePosition}%)` }}>
        <div className="pearl-sheet-handle-zone" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
          <span className="pearl-sheet-handle" />
        </div>
        <div className="pearl-sheet-heading">
          <div><strong>السجلات والسياق</strong><span>اسحب للأعلى لربط ما قيل بما حُفظ</span></div>
          <span>{recordCount} عناصر مرتبطة</span>
        </div>
        <div className="pearl-sheet-tabs">
          <button className={`pearl-sheet-tab ${sheetTab === "records" ? "active" : ""}`} onClick={() => setSheetTab("records")}>السجلات</button>
          <button className={`pearl-sheet-tab ${sheetTab === "context" ? "active" : ""}`} onClick={() => setSheetTab("context")}>الصورة الأكبر</button>
        </div>
        {sheetTab === "records" ? (
          <>
            <div className="pearl-record-list">
              {records.map((record) => {
                const Icon = record.icon;
                return (
                  <button className={`pearl-record ${activeRecord === record.id ? "selected" : ""}`} key={record.id} onClick={() => selectRecord(record.id)}>
                    <span className={`pearl-record-mark ${record.tone}`}><Icon size={15} /></span>
                    <span className="pearl-record-copy"><strong>{record.title}</strong><span>{record.meta}</span></span>
                    <span className="pearl-record-price">{record.detail}</span>
                    <ChevronLeft size={14} color="#a09faf" />
                  </button>
                );
              })}
            </div>
            {selectedRecord && <div className="pearl-selected-detail">هذا السجل داخل سياق الحديث الحالي. قل «عدّل السجل» وسأبدأ من تفاصيله لا من الصفر.</div>}
          </>
        ) : (
          <div className="pearl-context">
            <div className="pearl-context-title"><ShieldCheck size={16} /> خريطة اليوم كما فهمتها</div>
            <p>أنت توازن بين مصروف الغداء واتصال التصميم. المصروف ينتظر اعتمادك، والاتصال هو خطوتك التالية — سأبقي الاثنين قريبين من بعضهما.</p>
            <div className="pearl-context-row"><Check size={14} /> آخر مزامنة قبل ٣ دقائق · ٣ روابط من الحديث</div>
          </div>
        )}
      </section>

      {menuOpen && (
        <>
          <button className="pearl-menu-scrim" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} />
          <aside className="pearl-menu">
            <div className="pearl-menu-head"><strong>مساحات سكرتيرك</strong><button className="pearl-icon" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={16} /></button></div>
            <div className="pearl-menu-list">
              <button onClick={() => { setMenuOpen(false); snapSheet(80); }}><Sparkles size={16} /> المحادثة</button>
              <button onClick={() => { setSheetTab("records"); snapSheet(43); setMenuOpen(false); }}><Archive size={16} /> السجلات</button>
              <button onClick={() => { setSheetTab("context"); snapSheet(43); setMenuOpen(false); }}><ShieldCheck size={16} /> الصورة الأكبر</button>
            </div>
          </aside>
        </>
      )}
      {showNotice && <button className="pearl-toast" onClick={() => setShowNotice(false)}>تم تحديث السياق — اضغط للإخفاء</button>}
    </main>
  );
}