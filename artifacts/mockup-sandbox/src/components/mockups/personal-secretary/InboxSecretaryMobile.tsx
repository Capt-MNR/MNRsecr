import {
  Archive,
  ArrowDown,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Flag,
  Inbox,
  Menu,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

type QueueItem = {
  id: string;
  kind: "expense" | "meeting" | "file" | "reply";
  title: string;
  context: string;
  detail: string;
  age: string;
  tone: "coral" | "blue" | "green" | "gold";
  urgent?: boolean;
};

const queue: QueueItem[] = [
  {
    id: "expense",
    kind: "expense",
    title: "اعتماد غداء العمل",
    context: "محمود أرسل الإيصال في محادثة اليوم",
    detail: "١٬٢٥٠ ج.م",
    age: "منذ ساعتين",
    tone: "coral",
    urgent: true,
  },
  {
    id: "meeting",
    kind: "meeting",
    title: "اتصال فريق التصميم",
    context: "دعوة تنتظر تأكيد الوقت",
    detail: "١١:٣٠ ص",
    age: "بعد ٤٨ دقيقة",
    tone: "blue",
  },
  {
    id: "file",
    kind: "file",
    title: "مراجعة ملف الربع الثالث",
    context: "مسودة من سارة، تحتاج ملاحظة قصيرة",
    detail: "اليوم",
    age: "منذ ٣٥ دقيقة",
    tone: "green",
  },
  {
    id: "reply",
    kind: "reply",
    title: "الرد على فاطمة",
    context: "آخر رسالة في محادثة المشتريات",
    detail: "رسالة",
    age: "منذ ٥ ساعات",
    tone: "gold",
  },
];

const prompts = ["ماذا بعد؟", "راجع مصروفاً", "رتّب اجتماعاتي"];

const iconFor = (kind: QueueItem["kind"]) => {
  if (kind === "expense") return WalletCards;
  if (kind === "meeting") return CalendarClock;
  if (kind === "file") return FileText;
  return Bell;
};

export default function InboxSecretaryMobile() {
  const [items, setItems] = useState(queue);
  const [selectedId, setSelectedId] = useState(queue[0].id);
  const [filter, setFilter] = useState<"all" | "urgent" | "later">("all");
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const visibleItems = useMemo(
    () => items.filter((item) => filter === "all" || (filter === "urgent" ? item.urgent : !item.urgent)),
    [filter, items],
  );

  const advance = (message: string) => {
    if (!selected) return;
    const next = items.find((item) => item.id !== selected.id);
    setItems((current) => current.filter((item) => item.id !== selected.id));
    if (next) setSelectedId(next.id);
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2300);
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setNotice(`سأتعامل مع «${text}» كخطوة جديدة`);
    setDraft("");
    window.setTimeout(() => setNotice(""), 2300);
  };

  const resetInbox = () => {
    setItems(queue);
    setSelectedId(queue[0].id);
    setNotice("أعدت كل الخطوات إلى صندوقك");
    window.setTimeout(() => setNotice(""), 2300);
  };

  return (
    <main className="isx-shell" dir="rtl">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap');
        .isx-shell {
          --ink: #172b37;
          --ink-soft: #5f7077;
          --canvas: #e9e5dc;
          --paper: #f8f5ef;
          --paper-deep: #efeae1;
          --line: #ded9cf;
          --navy: #203e52;
          --navy-soft: #e1e9ec;
          --coral: #d86e50;
          --coral-soft: #f6e1d8;
          --green: #4e806c;
          --green-soft: #dfece5;
          --gold: #b4843d;
          --gold-soft: #f2e8d2;
          width: 100%;
          min-height: 100dvh;
          overflow-x: hidden;
          color: var(--ink);
          background:
            radial-gradient(circle at 12% 8%, rgba(216,110,80,.10), transparent 29%),
            linear-gradient(135deg, #eee9df 0%, var(--canvas) 54%, #e4e0d6 100%);
          font-family: "IBM Plex Sans Arabic", sans-serif;
          letter-spacing: -.025em;
        }
        .isx-shell *, .isx-shell *::before, .isx-shell *::after { box-sizing: border-box; }
        .isx-app { width: min(100%, 460px); min-height: 100dvh; margin: 0 auto; padding: 0 15px 145px; }
        .isx-header { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; height: 68px; margin: 0 -15px; padding: 0 15px; border-bottom: 1px solid rgba(222,217,207,.88); background: rgba(248,245,239,.91); backdrop-filter: blur(15px); }
        .isx-brand { display: flex; align-items: center; gap: 9px; }
        .isx-brand-mark { display: grid; width: 35px; height: 35px; place-items: center; color: #fff9f0; border-radius: 12px; background: var(--navy); box-shadow: 0 8px 18px rgba(32,62,82,.18); }
        .isx-brand-copy strong { display: block; font-size: 14px; line-height: 1.15; font-weight: 800; }
        .isx-brand-copy small { display: block; margin-top: 3px; color: var(--ink-soft); font-size: 10px; font-weight: 600; }
        .isx-header-actions { display: flex; align-items: center; gap: 7px; }
        .isx-round { display: grid; width: 33px; height: 33px; place-items: center; color: var(--ink-soft); border: 1px solid var(--line); border-radius: 12px; background: rgba(255,253,248,.74); cursor: pointer; transition: transform .18s ease, background .18s ease; }
        .isx-round:active, .isx-filter:active, .isx-action:active, .isx-nav:active { transform: scale(.96); }
        .isx-round:hover { background: #fffdf8; }
        .isx-greeting { padding: 21px 2px 13px; }
        .isx-kicker { display: flex; align-items: center; gap: 7px; color: var(--coral); font-size: 11px; font-weight: 800; }
        .isx-kicker i { display: block; width: 6px; height: 6px; border-radius: 50%; background: var(--coral); box-shadow: 0 0 0 4px var(--coral-soft); }
        .isx-greeting h1 { margin: 8px 0 3px; font-family: "Space Grotesk", "IBM Plex Sans Arabic", sans-serif; font-size: 29px; line-height: 1.12; letter-spacing: -.06em; }
        .isx-greeting p { margin: 0; color: var(--ink-soft); font-size: 13px; font-weight: 500; }
        .isx-progress { display: flex; align-items: center; gap: 11px; margin: 3px 0 16px; }
        .isx-progress-track { flex: 1; height: 6px; overflow: hidden; border-radius: 99px; background: #ddd9cf; }
        .isx-progress-fill { width: 25%; height: 100%; border-radius: inherit; background: var(--coral); transition: width .25s ease; }
        .isx-progress span { color: var(--ink-soft); font-size: 11px; font-weight: 700; white-space: nowrap; }
        .isx-hero { position: relative; overflow: hidden; padding: 17px 17px 15px; border: 1px solid rgba(216,110,80,.28); border-radius: 22px; background: var(--coral-soft); box-shadow: 0 14px 28px rgba(67,51,40,.08); }
        .isx-hero::after { content: ""; position: absolute; width: 112px; height: 112px; left: -42px; bottom: -53px; border: 1px solid rgba(216,110,80,.22); border-radius: 50%; box-shadow: 0 0 0 17px rgba(216,110,80,.05), 0 0 0 34px rgba(216,110,80,.04); }
        .isx-hero-top { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; }
        .isx-hero-label { display: flex; align-items: center; gap: 7px; color: #a6533e; font-size: 11px; font-weight: 800; }
        .isx-hero-label svg { color: var(--coral); }
        .isx-hero-top time { color: #a6533e; font-size: 10px; font-weight: 700; }
        .isx-hero h2 { position: relative; z-index: 1; max-width: 300px; margin: 14px 0 5px; font-size: 22px; line-height: 1.25; letter-spacing: -.045em; }
        .isx-hero-copy { position: relative; z-index: 1; margin: 0 0 13px; color: #80645b; font-size: 12px; line-height: 1.65; }
        .isx-value-row { position: relative; z-index: 1; display: flex; align-items: end; justify-content: space-between; gap: 12px; padding: 11px 12px; border: 1px solid rgba(216,110,80,.21); border-radius: 14px; background: rgba(255,253,248,.58); }
        .isx-value-row strong { display: block; color: #8d3f2d; font-family: "Space Grotesk", sans-serif; font-size: 23px; direction: ltr; letter-spacing: -.05em; }
        .isx-value-row span { display: block; margin-top: 3px; color: #98766b; font-size: 10px; font-weight: 600; }
        .isx-merchant { display: flex; align-items: center; gap: 7px; color: #76564d; font-size: 11px; font-weight: 700; }
        .isx-avatar { display: grid; width: 25px; height: 25px; place-items: center; color: #fff8ef; border-radius: 9px; background: var(--navy); font-size: 10px; font-weight: 800; }
        .isx-hero-actions { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
        .isx-action { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 39px; border: 0; border-radius: 12px; font-family: inherit; font-size: 12px; font-weight: 800; cursor: pointer; transition: transform .18s ease, background .18s ease; }
        .isx-action.primary { color: #fffaf2; background: var(--navy); box-shadow: 0 7px 14px rgba(32,62,82,.16); }
        .isx-action.primary:hover { background: #294d63; }
        .isx-action.secondary { color: #9a4f3c; border: 1px solid rgba(216,110,80,.29); background: rgba(255,253,248,.42); }
        .isx-action.secondary:hover { background: rgba(255,253,248,.8); }
        .isx-section-head { display: flex; align-items: center; justify-content: space-between; padding: 23px 1px 10px; }
        .isx-section-head h3 { margin: 0; font-size: 15px; font-weight: 800; }
        .isx-section-head span { color: var(--ink-soft); font-size: 11px; font-weight: 600; }
        .isx-filter-row { display: flex; gap: 7px; margin: 0 0 11px; overflow-x: auto; scrollbar-width: none; }
        .isx-filter-row::-webkit-scrollbar { display: none; }
        .isx-filter { display: flex; align-items: center; gap: 5px; min-height: 29px; padding: 0 11px; color: var(--ink-soft); border: 1px solid var(--line); border-radius: 99px; background: rgba(248,245,239,.6); font-family: inherit; font-size: 10px; font-weight: 700; white-space: nowrap; cursor: pointer; transition: transform .18s ease, background .18s ease, color .18s ease; }
        .isx-filter.active { color: var(--navy); border-color: var(--navy); background: var(--navy-soft); }
        .isx-filter b { display: grid; min-width: 16px; height: 16px; place-items: center; border-radius: 5px; background: rgba(32,62,82,.10); font-size: 9px; }
        .isx-queue { display: grid; gap: 8px; }
        .isx-queue-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 10px; color: inherit; text-align: right; border: 1px solid var(--line); border-radius: 16px; background: rgba(248,245,239,.76); cursor: pointer; transition: transform .18s ease, border-color .18s ease, background .18s ease; }
        .isx-queue-item:hover { background: #fffdf8; transform: translateY(-1px); }
        .isx-queue-item.selected { border-color: rgba(32,62,82,.48); background: #fffdf8; box-shadow: 0 9px 18px rgba(67,51,40,.06); }
        .isx-item-icon { display: grid; flex: 0 0 auto; width: 35px; height: 35px; place-items: center; border-radius: 11px; }
        .isx-item-icon.coral { color: var(--coral); background: var(--coral-soft); }
        .isx-item-icon.blue { color: var(--navy); background: var(--navy-soft); }
        .isx-item-icon.green { color: var(--green); background: var(--green-soft); }
        .isx-item-icon.gold { color: var(--gold); background: var(--gold-soft); }
        .isx-item-copy { min-width: 0; flex: 1; }
        .isx-item-copy strong { display: block; overflow: hidden; font-size: 12px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
        .isx-item-copy span { display: block; overflow: hidden; margin-top: 3px; color: var(--ink-soft); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .isx-item-side { display: flex; flex: 0 0 auto; flex-direction: column; align-items: end; gap: 5px; }
        .isx-item-side strong { color: var(--ink); font-family: "Space Grotesk", sans-serif; font-size: 11px; direction: ltr; }
        .isx-item-side small { color: #9a9b94; font-size: 9px; font-weight: 600; white-space: nowrap; }
        .isx-empty { display: grid; place-items: center; gap: 6px; min-height: 134px; padding: 20px; color: var(--ink-soft); border: 1px dashed #c7c3b9; border-radius: 18px; background: rgba(248,245,239,.5); text-align: center; }
        .isx-empty svg { color: var(--green); }
        .isx-empty strong { color: var(--ink); font-size: 13px; }
        .isx-empty span { font-size: 11px; }
        .isx-insight { display: flex; align-items: flex-start; gap: 10px; margin-top: 18px; padding: 13px 14px; color: #49665d; border: 1px solid #cfe0d6; border-radius: 15px; background: rgba(223,236,229,.72); }
        .isx-insight svg { flex: 0 0 auto; margin-top: 1px; }
        .isx-insight span { font-size: 11px; line-height: 1.65; }
        .isx-insight strong { color: #2c5e4d; }
        .isx-composer-wrap { position: fixed; z-index: 12; right: 0; bottom: 66px; left: 0; padding: 9px 15px 10px; background: linear-gradient(to top, rgba(233,229,220,1) 62%, rgba(233,229,220,0)); }
        .isx-composer { display: flex; align-items: center; gap: 7px; width: min(100%, 430px); min-height: 48px; margin: 0 auto; padding: 5px 6px 5px 7px; border: 1px solid #d6d0c4; border-radius: 17px; background: #fffdf8; box-shadow: 0 9px 20px rgba(62,51,40,.10); }
        .isx-composer input { min-width: 0; flex: 1; height: 34px; padding: 0 7px; color: var(--ink); border: 0; outline: 0; background: transparent; font-family: inherit; font-size: 12px; }
        .isx-composer input::placeholder { color: #9c9d96; }
        .isx-composer-tool { display: grid; flex: 0 0 auto; width: 28px; height: 32px; place-items: center; color: #8a9495; border: 0; background: transparent; cursor: pointer; }
        .isx-composer-tool:hover { color: var(--navy); }
        .isx-send { display: grid; flex: 0 0 auto; width: 35px; height: 35px; place-items: center; color: #fff9f0; border: 0; border-radius: 12px; background: var(--navy); cursor: pointer; transition: transform .18s ease; }
        .isx-send:active { transform: scale(.94); }
        .isx-bottom-nav { position: fixed; z-index: 13; right: 0; bottom: 0; left: 0; display: flex; justify-content: center; min-height: 66px; padding: 7px 14px calc(7px + env(safe-area-inset-bottom)); border-top: 1px solid rgba(215,209,198,.9); background: rgba(248,245,239,.96); backdrop-filter: blur(14px); }
        .isx-nav { display: flex; flex: 1; max-width: 145px; align-items: center; justify-content: center; gap: 5px; color: #899393; border: 0; background: transparent; font-family: inherit; font-size: 10px; font-weight: 700; cursor: pointer; transition: transform .18s ease, color .18s ease; }
        .isx-nav.active { color: var(--navy); }
        .isx-nav.active svg { padding: 4px; width: 29px; height: 29px; border-radius: 10px; color: #fff9f0; background: var(--navy); }
        .isx-toast { position: fixed; z-index: 25; right: 15px; bottom: 132px; left: 15px; display: flex; align-items: center; justify-content: center; min-height: 39px; padding: 8px 12px; color: #fff9f0; border-radius: 12px; background: #26495c; box-shadow: 0 10px 24px rgba(32,62,82,.22); font-size: 11px; font-weight: 700; animation: isx-rise .22s ease-out; }
        @keyframes isx-rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
        .isx-scrim { position: fixed; z-index: 19; inset: 0; border: 0; background: rgba(23,43,55,.24); backdrop-filter: blur(2px); }
        .isx-sheet { position: fixed; z-index: 20; right: 0; bottom: 0; left: 0; max-height: 78dvh; padding: 9px 17px 34px; border-radius: 25px 25px 0 0; background: var(--paper); box-shadow: 0 -14px 32px rgba(23,43,55,.15); animation: isx-sheet-in .25s ease-out; }
        @keyframes isx-sheet-in { from { opacity: 0; transform: translateY(100%); } to { opacity: 1; transform: translateY(0); } }
        .isx-handle { width: 34px; height: 4px; margin: 0 auto 17px; border-radius: 9px; background: #c5c0b6; }
        .isx-sheet-head { display: flex; align-items: center; justify-content: space-between; }
        .isx-sheet-head strong { font-size: 17px; }
        .isx-sheet p { margin: 8px 0 16px; color: var(--ink-soft); font-size: 12px; line-height: 1.7; }
        .isx-sheet-meta { display: flex; align-items: center; gap: 8px; padding: 11px; border-radius: 13px; background: var(--paper-deep); }
        .isx-sheet-meta span { color: var(--ink-soft); font-size: 11px; }
        .isx-sheet-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 15px; }
        @media (min-width: 700px) {
          .isx-app { margin-top: 18px; min-height: calc(100dvh - 36px); border: 1px solid rgba(210,204,193,.8); border-radius: 29px; background: var(--paper); box-shadow: 0 22px 60px rgba(68,58,46,.14); }
          .isx-header { border-radius: 29px 29px 0 0; }
          .isx-composer-wrap { position: absolute; left: auto; right: auto; width: 460px; }
          .isx-bottom-nav { position: absolute; width: 460px; border-radius: 0 0 29px 29px; }
        }
      `}</style>

      <div className="isx-app">
        <header className="isx-header">
          <div className="isx-brand">
            <span className="isx-brand-mark"><Inbox size={18} /></span>
            <span className="isx-brand-copy"><strong>صندوق السكرتير</strong><small>خطوتك التالية، فقط</small></span>
          </div>
          <div className="isx-header-actions">
            <button className="isx-round" aria-label="بحث"><Search size={16} /></button>
            <button className="isx-round" aria-label="فتح القائمة" onClick={() => setMenuOpen(true)}><Menu size={17} /></button>
          </div>
        </header>

        <section className="isx-greeting">
          <div className="isx-kicker"><i /> صباح هادئ، كريم</div>
          <h1>ما الخطوة التالية؟</h1>
          <p>رتّبت لك الأشياء التي تحتاج قراراً، لا كل ما حدث.</p>
        </section>

        <div className="isx-progress" aria-label="تقدم صندوق الوارد">
          <div className="isx-progress-track"><div className="isx-progress-fill" style={{ width: `${Math.max(25, ((queue.length - items.length + 1) / queue.length) * 100)}%` }} /></div>
          <span>{items.length} خطوات في الانتظار</span>
        </div>

        {selected ? (
          <section className="isx-hero" aria-label="الخطوة الحالية">
            <div className="isx-hero-top">
              <span className="isx-hero-label"><Zap size={14} fill="currentColor" /> الخطوة الأهم الآن</span>
              <time>{selected.age}</time>
            </div>
            <h2>{selected.title}</h2>
            <p className="isx-hero-copy">{selected.context}. ألقِ نظرة سريعة ثم اختر ما تريده، وسأتولى الباقي.</p>
            <div className="isx-value-row">
              <div><strong>{selected.detail}</strong><span>التفصيل المرتبط بالطلب</span></div>
              <div className="isx-merchant"><span className="isx-avatar">م</span> محمود</div>
            </div>
            <div className="isx-hero-actions">
              <button className="isx-action primary" onClick={() => advance("تم الحل، نقلت الخطوة التالية إلى الواجهة")}><Check size={15} /> اعتماد وحل</button>
              <button className="isx-action secondary" onClick={() => setDetailOpen(true)}><Pencil size={14} /> مراجعة التفاصيل</button>
            </div>
          </section>
        ) : (
          <section className="isx-empty"><CheckCircle2 size={25} /><strong>الصندوق هادئ الآن</strong><span>كل القرارات المهمة أخذت طريقها.</span><button className="isx-filter active" onClick={resetInbox}><ArrowDown size={12} /> عرض العناصر المنجزة</button></section>
        )}

        <div className="isx-section-head"><h3>كل الخطوات</h3><span>{items.length === 0 ? "لا شيء عالق" : "مرتبة حسب الأولوية"}</span></div>
        <div className="isx-filter-row" aria-label="تصفية الخطوات">
          <button className={`isx-filter ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}><Inbox size={12} /> الكل <b>{items.length}</b></button>
          <button className={`isx-filter ${filter === "urgent" ? "active" : ""}`} onClick={() => setFilter("urgent")}><Flag size={12} /> يحتاج قراراً</button>
          <button className={`isx-filter ${filter === "later" ? "active" : ""}`} onClick={() => setFilter("later")}><Clock3 size={12} /> لاحقاً</button>
        </div>

        <div className="isx-queue">
          {visibleItems.length > 0 ? visibleItems.map((item) => {
            const Icon = iconFor(item.kind);
            return (
              <button className={`isx-queue-item ${selectedId === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}>
                <span className={`isx-item-icon ${item.tone}`}><Icon size={16} /></span>
                <span className="isx-item-copy"><strong>{item.title}</strong><span>{item.context}</span></span>
                <span className="isx-item-side"><strong>{item.detail}</strong><small>{item.age}</small></span>
                <ChevronLeft size={15} color="#a7aaa3" />
              </button>
            );
          }) : <div className="isx-empty"><Tag size={21} /><strong>لا توجد عناصر بهذا الفلتر</strong><span>جرّب العودة إلى كل الخطوات.</span></div>}
        </div>

        <div className="isx-insight"><ShieldCheck size={16} /><span><strong>أبقيت التفاصيل الثقيلة خارج الطريق.</strong> لا تحتاج فتح السجل الكامل كي تتخذ القرار التالي.</span></div>
      </div>

      <div className="isx-composer-wrap">
        <div className="isx-composer">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="قل لي ما تريد إنجازه..." aria-label="قل لي ما تريد إنجازه" />
          <button className="isx-composer-tool" aria-label="إرفاق" onClick={() => setNotice("الإرفاق متاح من داخل السجل")}><Paperclip size={15} /></button>
          <button className="isx-composer-tool" aria-label="تسجيل صوتي" onClick={() => setNotice("استمع لك، اكتب طلبك الآن")}><Mic size={16} /></button>
          <button className="isx-send" aria-label="إرسال" onClick={send}><Send size={14} /></button>
        </div>
      </div>

      <nav className="isx-bottom-nav" aria-label="التنقل">
        <button className="isx-nav active" onClick={() => setFilter("all")}><Inbox size={18} />الوارد</button>
        <button className="isx-nav" onClick={() => setNotice("لا يوجد شيء مجدول خارج هذا الصندوق")}><CalendarClock size={18} />لاحقاً</button>
        <button className="isx-nav" onClick={() => setNotice("كل ما تم حله يظهر هنا")}><Archive size={18} />تم الحل</button>
      </nav>

      {notice && <div className="isx-toast" role="status">{notice}</div>}

      {detailOpen && selected && (
        <>
          <button className="isx-scrim" aria-label="إغلاق التفاصيل" onClick={() => setDetailOpen(false)} />
          <section className="isx-sheet">
            <div className="isx-handle" />
            <div className="isx-sheet-head"><strong>{selected.title}</strong><button className="isx-round" aria-label="إغلاق" onClick={() => setDetailOpen(false)}><X size={16} /></button></div>
            <p>هذا ملخص القرار من محادثتك مع السكرتير. يمكنك تعديله الآن، أو تأجيله مع الحفاظ على سياقه.</p>
            <div className="isx-sheet-meta"><Tag size={15} color="#4e806c" /><span>{selected.context}</span></div>
            <div className="isx-sheet-actions">
              <button className="isx-action secondary" onClick={() => { setDetailOpen(false); advance("أجلت الخطوة إلى وقت أنسب"); }}><Clock3 size={14} /> لاحقاً</button>
              <button className="isx-action primary" onClick={() => { setDetailOpen(false); advance("تم الحل من شاشة التفاصيل"); }}><Check size={14} /> تم الحل</button>
            </div>
          </section>
        </>
      )}

      {menuOpen && (
        <>
          <button className="isx-scrim" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} />
          <section className="isx-sheet">
            <div className="isx-handle" />
            <div className="isx-sheet-head"><strong>صندوقك، بطريقتك</strong><button className="isx-round" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={16} /></button></div>
            <p>كل ما تحتاجه للمراجعة السريعة موجود هنا. المحادثة الكاملة تظل محفوظة في الخلفية.</p>
            {prompts.map((prompt) => <button className="isx-queue-item" key={prompt} onClick={() => { setDraft(prompt); setMenuOpen(false); }}><span className="isx-item-icon blue"><Sparkles size={16} /></span><span className="isx-item-copy"><strong>{prompt}</strong><span>اكتبها لي كما تتحدث</span></span><ChevronLeft size={15} color="#a7aaa3" /></button>)}
          </section>
        </>
      )}
    </main>
  );
}