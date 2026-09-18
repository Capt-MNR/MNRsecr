import {
  Archive,
  ArrowLeft,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock3,
  FileText,
  Inbox,
  Menu,
  Mic,
  Paperclip,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  WalletCards,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

type QueueItem = {
  id: string;
  kind: "expense" | "meeting" | "file" | "reply";
  title: string;
  context: string;
  detail: string;
  age: string;
  tone: "clay" | "mist" | "sage" | "ochre";
  priority?: boolean;
};

const starterQueue: QueueItem[] = [
  { id: "expense", kind: "expense", title: "اعتماد غداء العمل", context: "محمود أرسل الإيصال في محادثة اليوم", detail: "١٬٢٥٠ ج.م", age: "منذ ساعتين", tone: "clay", priority: true },
  { id: "meeting", kind: "meeting", title: "اتصال فريق التصميم", context: "دعوة تنتظر تأكيد الوقت", detail: "١١:٣٠ ص", age: "بعد ٤٨ دقيقة", tone: "mist" },
  { id: "file", kind: "file", title: "مراجعة ملف الربع الثالث", context: "مسودة من سارة، تحتاج ملاحظة قصيرة", detail: "اليوم", age: "منذ ٣٥ دقيقة", tone: "sage" },
  { id: "reply", kind: "reply", title: "الرد على فاطمة", context: "آخر رسالة في محادثة المشتريات", detail: "رسالة", age: "منذ ٥ ساعات", tone: "ochre" },
];

const iconFor = (kind: QueueItem["kind"]) => {
  if (kind === "expense") return WalletCards;
  if (kind === "meeting") return CalendarClock;
  if (kind === "file") return FileText;
  return Bell;
};

export default function InboxSecretaryCalmPriority() {
  const [items, setItems] = useState(starterQueue);
  const [selectedId, setSelectedId] = useState(starterQueue[0].id);
  const [showAll, setShowAll] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");

  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const quieterItems = useMemo(() => items.filter((item) => item.id !== selected?.id), [items, selected?.id]);

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2300);
  };

  const resolve = () => {
    if (!selected) return;
    setItems((current) => current.filter((item) => item.id !== selected.id));
    setSelectedId(quieterItems[0]?.id ?? "");
    setShowDetails(false);
    notify("تم، أبقيت لك الخطوة التالية فقط");
  };

  const defer = () => {
    if (!selected) return;
    setItems((current) => [...current.filter((item) => item.id !== selected.id), { ...selected, priority: false }]);
    setSelectedId(quieterItems[0]?.id ?? "");
    setShowDetails(false);
    notify("وضعتها بهدوء في قائمة لاحقاً");
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    notify(`سأتابع «${text}» عندما تكون جاهزاً`);
  };

  return (
    <main className="cpx-shell" dir="rtl">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Manrope:wght@500;600;700&display=swap');
        .cpx-shell {
          --ink: #273634; --muted: #77837d; --canvas: #e8e9e1; --paper: #fbfaf5;
          --paper-2: #f3f2eb; --line: #e0e2d8; --deep: #385b58; --deep-soft: #dce9e3;
          --clay: #bd7460; --clay-soft: #f1e2dc; --sage: #70917e; --sage-soft: #e1ece3;
          width: 100%; min-height: 100dvh; overflow-x: hidden; color: var(--ink);
          background: radial-gradient(circle at 84% 4%, rgba(112,145,126,.15), transparent 31%), linear-gradient(140deg, #eff0e9, var(--canvas) 58%, #e2e5dd);
          font-family: "IBM Plex Sans Arabic", sans-serif; letter-spacing: -.02em;
        }
        .cpx-shell *, .cpx-shell *::before, .cpx-shell *::after { box-sizing: border-box; }
        .cpx-app { width: min(100%, 460px); min-height: 100dvh; margin: 0 auto; padding: 0 17px 146px; }
        .cpx-header { position: sticky; top: 0; z-index: 8; display:flex; align-items:center; justify-content:space-between; height:66px; margin:0 -17px; padding:0 17px; border-bottom:1px solid rgba(224,226,216,.9); background:rgba(251,250,245,.88); backdrop-filter:blur(16px); }
        .cpx-brand { display:flex; align-items:center; gap:9px; }
        .cpx-mark { display:grid; place-items:center; width:34px; height:34px; color:#f8fbf4; border-radius:11px; background:var(--deep); box-shadow:0 8px 18px rgba(56,91,88,.16); }
        .cpx-brand strong { display:block; font-size:13px; font-weight:700; line-height:1.1; }
        .cpx-brand small { display:block; margin-top:3px; color:var(--muted); font-size:10px; font-weight:500; }
        .cpx-head-actions { display:flex; gap:7px; }
        .cpx-icon-btn { display:grid; place-items:center; width:33px; height:33px; color:var(--muted); border:1px solid var(--line); border-radius:11px; background:rgba(255,255,251,.7); cursor:pointer; transition:transform .18s ease, background .18s ease; }
        .cpx-icon-btn:hover { background:#fffef9; } .cpx-icon-btn:active, .cpx-btn:active, .cpx-nav:active { transform:scale(.97); }
        .cpx-intro { padding:25px 2px 16px; }
        .cpx-kicker { display:flex; align-items:center; gap:7px; color:var(--deep); font-size:11px; font-weight:700; }
        .cpx-kicker i { width:6px; height:6px; border-radius:50%; background:var(--sage); box-shadow:0 0 0 4px var(--sage-soft); }
        .cpx-intro h1 { margin:9px 0 5px; font-size:28px; line-height:1.15; letter-spacing:-.06em; }
        .cpx-intro p { margin:0; color:var(--muted); font-size:12px; line-height:1.7; }
        .cpx-count { display:flex; align-items:center; gap:10px; margin:1px 0 16px; }
        .cpx-count-track { flex:1; height:5px; overflow:hidden; border-radius:99px; background:#dfe2d9; }
        .cpx-count-fill { width:25%; height:100%; border-radius:inherit; background:var(--sage); transition:width .22s ease; }
        .cpx-count span { color:var(--muted); font-size:10px; font-weight:600; white-space:nowrap; }
        .cpx-focus { position:relative; overflow:hidden; padding:18px; border:1px solid rgba(112,145,126,.29); border-radius:23px; background:linear-gradient(145deg, #edf4ec, #e4eee6); box-shadow:0 13px 30px rgba(54,76,64,.08); }
        .cpx-focus::after { content:""; position:absolute; left:-40px; bottom:-57px; width:142px; height:142px; border:1px solid rgba(112,145,126,.19); border-radius:50%; box-shadow:0 0 0 18px rgba(112,145,126,.055),0 0 0 36px rgba(112,145,126,.035); }
        .cpx-focus-top { position:relative; z-index:1; display:flex; align-items:center; justify-content:space-between; color:#668076; font-size:10px; font-weight:700; }
        .cpx-focus-top span { display:flex; align-items:center; gap:6px; } .cpx-focus-top time { color:#8a9a91; }
        .cpx-focus h2 { position:relative; z-index:1; margin:16px 0 5px; font-size:21px; line-height:1.25; letter-spacing:-.045em; }
        .cpx-focus-copy { position:relative; z-index:1; max-width:320px; margin:0 0 14px; color:#6b7e73; font-size:11px; line-height:1.75; }
        .cpx-detail { position:relative; z-index:1; display:flex; align-items:center; justify-content:space-between; padding:11px 12px; border:1px solid rgba(112,145,126,.18); border-radius:14px; background:rgba(255,255,252,.55); }
        .cpx-detail strong { display:block; color:#3d6761; font-family:Manrope,sans-serif; font-size:20px; direction:ltr; letter-spacing:-.05em; }
        .cpx-detail small { display:block; margin-top:3px; color:#85958c; font-size:9px; }
        .cpx-person { display:flex; align-items:center; gap:7px; color:#60776c; font-size:10px; font-weight:600; }
        .cpx-avatar { display:grid; place-items:center; width:25px; height:25px; color:#f7faf3; border-radius:9px; background:#597772; font-size:10px; font-weight:700; }
        .cpx-actions { position:relative; z-index:1; display:flex; align-items:center; gap:8px; margin-top:12px; }
        .cpx-btn { display:flex; align-items:center; justify-content:center; gap:6px; min-height:39px; border:0; border-radius:12px; font-family:inherit; font-size:11px; font-weight:700; cursor:pointer; transition:transform .18s ease, background .18s ease; }
        .cpx-btn.primary { flex:1; color:#f8fbf4; background:var(--deep); box-shadow:0 7px 14px rgba(56,91,88,.14); }
        .cpx-btn.primary:hover { background:#2f514e; }
        .cpx-btn.quiet { padding:0 13px; color:#58736a; border:1px solid rgba(112,145,126,.25); background:rgba(255,255,252,.35); }
        .cpx-btn.quiet:hover { background:rgba(255,255,252,.74); }
        .cpx-subhead { display:flex; align-items:center; justify-content:space-between; padding:24px 2px 10px; }
        .cpx-subhead h3 { margin:0; font-size:14px; font-weight:700; } .cpx-subhead span { color:var(--muted); font-size:10px; }
        .cpx-reveal { display:flex; align-items:center; justify-content:space-between; width:100%; padding:10px 12px; color:#65766e; border:1px solid var(--line); border-radius:14px; background:rgba(251,250,245,.55); font-family:inherit; font-size:11px; font-weight:600; cursor:pointer; }
        .cpx-reveal strong { color:var(--deep); font-size:11px; } .cpx-reveal span { display:flex; align-items:center; gap:7px; }
        .cpx-queue { display:grid; gap:7px; margin-top:8px; }
        .cpx-item { display:flex; align-items:center; gap:10px; width:100%; padding:10px; text-align:right; color:inherit; border:1px solid var(--line); border-radius:15px; background:rgba(251,250,245,.68); cursor:pointer; transition:transform .18s ease, background .18s ease; }
        .cpx-item:hover { background:#fffef9; transform:translateY(-1px); }
        .cpx-item-icon { display:grid; flex:0 0 auto; place-items:center; width:34px; height:34px; border-radius:11px; }
        .cpx-item-icon.clay { color:var(--clay); background:var(--clay-soft); } .cpx-item-icon.mist { color:#69858a; background:#e3ecee; } .cpx-item-icon.sage { color:var(--sage); background:var(--sage-soft); } .cpx-item-icon.ochre { color:#a58a52; background:#f0ead9; }
        .cpx-item-copy { min-width:0; flex:1; } .cpx-item-copy strong { display:block; overflow:hidden; font-size:11px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; } .cpx-item-copy span { display:block; overflow:hidden; margin-top:3px; color:var(--muted); font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
        .cpx-item-side { display:flex; flex-direction:column; align-items:end; gap:4px; } .cpx-item-side strong { color:#66736f; font-family:Manrope,sans-serif; font-size:10px; direction:ltr; } .cpx-item-side small { color:#9aa39c; font-size:8px; white-space:nowrap; }
        .cpx-insight { display:flex; align-items:flex-start; gap:9px; margin-top:18px; padding:12px 13px; color:#687d72; border:1px solid #d5e3d8; border-radius:15px; background:rgba(226,238,228,.58); }
        .cpx-insight svg { flex:0 0 auto; margin-top:1px; color:#6a927b; } .cpx-insight span { font-size:10px; line-height:1.7; } .cpx-insight b { color:#4e7563; }
        .cpx-composer-wrap { position:fixed; z-index:12; right:0; bottom:64px; left:0; padding:9px 16px 10px; background:linear-gradient(to top, rgba(232,233,225,1) 58%, rgba(232,233,225,0)); }
        .cpx-composer { display:flex; align-items:center; gap:6px; width:min(100%,428px); min-height:47px; margin:0 auto; padding:5px 6px 5px 7px; border:1px solid #d7dcd3; border-radius:17px; background:#fffef9; box-shadow:0 8px 18px rgba(61,75,63,.09); }
        .cpx-composer input { min-width:0; flex:1; height:33px; padding:0 7px; color:var(--ink); border:0; outline:0; background:transparent; font-family:inherit; font-size:11px; } .cpx-composer input::placeholder { color:#9ba49d; }
        .cpx-tool { display:grid; flex:0 0 auto; place-items:center; width:27px; height:31px; color:#8c9891; border:0; background:transparent; cursor:pointer; } .cpx-tool:hover { color:var(--deep); }
        .cpx-send { display:grid; flex:0 0 auto; place-items:center; width:34px; height:34px; color:#f8fbf4; border:0; border-radius:11px; background:var(--deep); cursor:pointer; }
        .cpx-nav { position:fixed; z-index:13; right:0; bottom:0; left:0; display:flex; justify-content:center; min-height:64px; padding:7px 15px calc(7px + env(safe-area-inset-bottom)); border-top:1px solid rgba(218,222,213,.9); background:rgba(251,250,245,.95); backdrop-filter:blur(14px); }
        .cpx-nav button { display:flex; flex:1; max-width:145px; align-items:center; justify-content:center; gap:5px; color:#9aa39d; border:0; background:transparent; font-family:inherit; font-size:9px; font-weight:600; cursor:pointer; } .cpx-nav button.active { color:var(--deep); } .cpx-nav button.active svg { padding:4px; width:28px; height:28px; border-radius:10px; color:#f8fbf4; background:var(--deep); }
        .cpx-toast { position:fixed; z-index:25; right:15px; bottom:130px; left:15px; display:flex; align-items:center; justify-content:center; min-height:38px; padding:8px 12px; color:#f8fbf4; border-radius:12px; background:#416762; box-shadow:0 9px 22px rgba(56,91,88,.2); font-size:10px; font-weight:700; animation:cpx-rise .22s ease-out; }
        .cpx-scrim { position:fixed; z-index:19; inset:0; border:0; background:rgba(39,54,52,.2); backdrop-filter:blur(2px); } .cpx-sheet { position:fixed; z-index:20; right:0; bottom:0; left:0; max-height:76dvh; padding:9px 17px 31px; border-radius:25px 25px 0 0; background:var(--paper); box-shadow:0 -14px 32px rgba(39,54,52,.13); animation:cpx-sheet-in .25s ease-out; } .cpx-handle { width:34px; height:4px; margin:0 auto 16px; border-radius:8px; background:#c9d0c8; } .cpx-sheet-head { display:flex; align-items:center; justify-content:space-between; } .cpx-sheet-head strong { font-size:16px; } .cpx-sheet p { margin:8px 0 15px; color:var(--muted); font-size:11px; line-height:1.7; } .cpx-sheet-meta { display:flex; align-items:center; gap:8px; padding:11px; color:var(--muted); border-radius:13px; background:var(--paper-2); font-size:10px; } .cpx-sheet-actions { display:flex; gap:8px; margin-top:15px; } .cpx-sheet-actions .cpx-btn { flex:1; }
        @keyframes cpx-rise { from { opacity:0; transform:translateY(7px); } to { opacity:1; transform:translateY(0); } } @keyframes cpx-sheet-in { from { opacity:0; transform:translateY(100%); } to { opacity:1; transform:translateY(0); } }
        @media (min-width:700px) { .cpx-app { margin-top:18px; min-height:calc(100dvh - 36px); border:1px solid rgba(212,218,209,.85); border-radius:29px; background:var(--paper); box-shadow:0 22px 60px rgba(60,71,60,.13); } .cpx-header { border-radius:29px 29px 0 0; } .cpx-composer-wrap { position:absolute; width:460px; } .cpx-nav { position:absolute; width:460px; border-radius:0 0 29px 29px; } }
      `}</style>

      <div className="cpx-app">
        <header className="cpx-header">
          <div className="cpx-brand"><span className="cpx-mark"><Inbox size={17} /></span><span><strong>صندوق السكرتير</strong><small>الأهم، وبهدوء</small></span></div>
          <div className="cpx-head-actions"><button className="cpx-icon-btn" aria-label="فتح القائمة" onClick={() => setShowMenu(true)}><Menu size={17} /></button></div>
        </header>

        <section className="cpx-intro"><div className="cpx-kicker"><i /> صباح هادئ، كريم</div><h1>نأخذها واحدةً واحدة</h1><p>حددت لك قراراً واحداً الآن. الباقي ينتظر في مكانه.</p></section>
        <div className="cpx-count"><div className="cpx-count-track"><div className="cpx-count-fill" style={{ width: `${items.length ? Math.max(24, ((starterQueue.length - items.length + 1) / starterQueue.length) * 100) : 100}%` }} /></div><span>{items.length ? `${items.length} خطوات هادئة` : "الصندوق فارغ"}</span></div>

        {selected ? <section className="cpx-focus" aria-label="الأولوية الحالية">
          <div className="cpx-focus-top"><span><Sparkles size={13} /> الأولوية الحالية</span><time>{selected.age}</time></div>
          <h2>{selected.title}</h2>
          <p className="cpx-focus-copy">{selected.context}. راجعها متى يناسبك، وسأحتفظ بالسياق.</p>
          <div className="cpx-detail"><div><strong>{selected.detail}</strong><small>التفصيل المرتبط بالطلب</small></div><div className="cpx-person"><span className="cpx-avatar">م</span> محمود</div></div>
          <div className="cpx-actions"><button className="cpx-btn primary" onClick={resolve}><Check size={15} /> تم، تولَّها</button><button className="cpx-btn quiet" onClick={() => setShowDetails(true)}>لاحقاً</button></div>
        </section> : <section className="cpx-focus"><div className="cpx-focus-top"><span><CheckCircle2 size={14} /> مساحة خالية</span></div><h2>أحسنت، لا شيء يحتاج قراراً</h2><p className="cpx-focus-copy">سأبقي عيناً هادئة على ما يأتي بعد ذلك.</p><button className="cpx-btn quiet" onClick={() => setItems(starterQueue)}><ArrowLeft size={14} /> إعادة العرض</button></section>}

        <div className="cpx-subhead"><h3>في الخلفية</h3><span>لا تحتاج النظر إليها الآن</span></div>
        <button className="cpx-reveal" onClick={() => setShowAll((value) => !value)}><span><ChevronDown size={14} style={{ transform: showAll ? "rotate(180deg)" : "none" }} /> {showAll ? "إخفاء التفاصيل" : "عرض بقية الخطوات"}</span><strong>{quieterItems.length}</strong></button>
        {showAll && <div className="cpx-queue">{quieterItems.map((item) => { const Icon = iconFor(item.kind); return <button className="cpx-item" key={item.id} onClick={() => setSelectedId(item.id)}><span className={`cpx-item-icon ${item.tone}`}><Icon size={15} /></span><span className="cpx-item-copy"><strong>{item.title}</strong><span>{item.context}</span></span><span className="cpx-item-side"><strong>{item.detail}</strong><small>{item.age}</small></span><ChevronLeft size={14} color="#aab2ab" /></button>; })}</div>}
        <div className="cpx-insight"><ShieldCheck size={15} /><span><b>لا قرارات زائدة.</b> أخفيت التفاصيل الثقيلة حتى تبقى خطوتك التالية واضحة.</span></div>
      </div>

      <div className="cpx-composer-wrap"><div className="cpx-composer"><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="اطلب مني شيئاً..." aria-label="اطلب مني شيئاً" /><button className="cpx-tool" aria-label="إرفاق" onClick={() => notify("يمكنك إرفاقه من داخل المحادثة")}><Paperclip size={14} /></button><button className="cpx-tool" aria-label="تسجيل صوتي" onClick={() => notify("اكتب طلبك حين يناسبك")}><Mic size={15} /></button><button className="cpx-send" aria-label="إرسال" onClick={send}><Send size={13} /></button></div></div>
      <nav className="cpx-nav" aria-label="التنقل"><button className="active" onClick={() => setShowAll(false)}><Inbox size={17} />الوارد</button><button onClick={() => notify("كل ما يمكن تأجيله موجود هنا")}><Clock3 size={17} />لاحقاً</button><button onClick={() => notify("ستظهر القرارات المنجزة هنا")}><Archive size={17} />تم الحل</button></nav>
      {notice && <div className="cpx-toast" role="status">{notice}</div>}

      {showDetails && selected && <><button className="cpx-scrim" aria-label="إغلاق التفاصيل" onClick={() => setShowDetails(false)} /><section className="cpx-sheet"><div className="cpx-handle" /><div className="cpx-sheet-head"><strong>{selected.title}</strong><button className="cpx-icon-btn" aria-label="إغلاق" onClick={() => setShowDetails(false)}><X size={15} /></button></div><p>أبقيت هذه الخطوة هنا حتى لا تضطر إلى اتخاذ قرار سريع. يمكنك وضعها جانباً أو إنهاؤها الآن.</p><div className="cpx-sheet-meta"><Tag size={14} color="#70917e" />{selected.context}</div><div className="cpx-sheet-actions"><button className="cpx-btn quiet" onClick={defer}><Clock3 size={14} /> لاحقاً</button><button className="cpx-btn primary" onClick={resolve}><Check size={14} /> تم الحل</button></div></section></>}
      {showMenu && <><button className="cpx-scrim" aria-label="إغلاق القائمة" onClick={() => setShowMenu(false)} /><section className="cpx-sheet"><div className="cpx-handle" /><div className="cpx-sheet-head"><strong>أوامر هادئة</strong><button className="cpx-icon-btn" aria-label="إغلاق القائمة" onClick={() => setShowMenu(false)}><X size={15} /></button></div><p>قل ما تحتاجه بطريقتك، وسأعيده إلى خطوة واحدة بسيطة.</p><button className="cpx-item" onClick={() => { setDraft("ما الخطوة التالية؟"); setShowMenu(false); }}><span className="cpx-item-icon sage"><Sparkles size={15} /></span><span className="cpx-item-copy"><strong>ماذا بعد؟</strong><span>اقتراح واحد فقط</span></span><ChevronLeft size={14} color="#aab2ab" /></button></section></>}
    </main>
  );
}