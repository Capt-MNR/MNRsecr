import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowUpLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Inbox,
  LayoutGrid,
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
} from "lucide-react";
import { useState } from "react";

type FeedMessage = {
  id: number;
  role: "assistant" | "user";
  text: string;
  time: string;
};

type WorkspaceTab = "home" | "records" | "inbox";

const initialMessages: FeedMessage[] = [
  {
    id: 1,
    role: "assistant",
    text: "صباح الخير. رتبت لك أهم ما يستحق انتباهك اليوم.",
    time: "الآن",
  },
  {
    id: 2,
    role: "assistant",
    text: "لديك موافقة واحدة ومهمتان مفتوحتان. هل نبدأ بالمصروفات أم بجدول اليوم؟",
    time: "09:42",
  },
];

const attentionItems = [
  { icon: ShieldCheck, title: "مصروف يحتاج مراجعتك", meta: "محمود · ١٬٢٥٠ ج.م", tone: "rose" },
  { icon: CalendarDays, title: "اتصال مع فريق التصميم", meta: "اليوم · ١١:٣٠ ص", tone: "blue" },
  { icon: CheckCircle2, title: "إرسال ملف الربع الثالث", meta: "مستحق اليوم", tone: "mint" },
];

const recentExpenses = [
  { title: "غداء العمل", meta: "محمود · منذ ساعتين", amount: "٤٨٠ ج.م" },
  { title: "اشتراك مساحة العمل", meta: "مصروف متكرر · أمس", amount: "٧٥٠ ج.م" },
  { title: "سيارة إلى المكتب", meta: "مواصلات · الأحد", amount: "١٢٠ ج.م" },
];

const quickPrompts = [
  "إيه اللي عليا النهارده؟",
  "محمد أخد مني كام؟",
  "سجّل مصروف جديد",
];

const navItems: { id: WorkspaceTab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "home", label: "نظرة اليوم", icon: LayoutGrid },
  { id: "records", label: "السجلات", icon: Archive },
  { id: "inbox", label: "المحادثة", icon: Inbox },
];

export default function SecretaryCommandCenter() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showExpenses, setShowExpenses] = useState(false);
  const [approvalState, setApprovalState] = useState<"pending" | "done">("pending");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState(initialMessages);

  const selectPrompt = (prompt: string) => {
    setDraft(prompt);
    setActiveTab("inbox");
  };

  const submitMessage = () => {
    const cleanDraft = draft.trim();
    if (!cleanDraft) return;
    setMessages((current) => [
      ...current,
      { id: Date.now(), role: "user", text: cleanDraft, time: "الآن" },
      {
        id: Date.now() + 1,
        role: "assistant",
        text: cleanDraft.includes("مصروف")
          ? "تمام. أرسل لي المبلغ والوصف وسأجهز التسجيل للمراجعة."
          : "حاضر. سأرتب هذا لك وأعرض النتيجة هنا.",
        time: "الآن",
      },
    ]);
    setDraft("");
  };

  return (
    <main className="secretary-shell" dir="rtl">
      <style>{`
        .secretary-shell {
          --ink: #15213d;
          --sub: #687594;
          --bg: #f5f8ff;
          --card: #ffffff;
          --line: #dfe5f3;
          --muted: #edf1ff;
          --primary: #5257e8;
          --primary-deep: #4044c7;
          --mint: #22b887;
          --mint-soft: #e5f8f1;
          --rose: #d85878;
          --rose-soft: #fff0f4;
          --blue-soft: #e9edff;
          min-height: 100dvh;
          background: var(--bg);
          color: var(--ink);
          font-family: "Avenir Next", "Noto Sans Arabic", "Segoe UI", sans-serif;
          letter-spacing: -0.01em;
          overflow: hidden;
        }
        .secretary-page {
          position: relative;
          width: min(100%, 470px);
          min-height: 100dvh;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          background:
            linear-gradient(180deg, rgba(255,255,255,.72) 0, rgba(245,248,255,0) 180px),
            var(--bg);
        }
        .secretary-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 74px;
          padding: 14px 18px 10px;
          border-bottom: 1px solid rgba(223,229,243,.72);
        }
        .topbar-actions, .brand-lockup, .topbar-right, .icon-action, .status-line,
        .section-heading, .section-heading-side, .attention-row, .expense-row,
        .composer, .composer-tools, .composer-send, .bottom-nav, .nav-item,
        .quick-title, .hero-meta, .hero-mark, .approval-title, .approval-actions {
          display: flex;
          align-items: center;
        }
        .topbar-right { gap: 10px; }
        .topbar-actions { gap: 7px; }
        .brand-lockup { gap: 9px; }
        .brand-mark {
          display: grid;
          width: 38px;
          height: 38px;
          place-items: center;
          border-radius: 14px;
          color: #fff;
          background: var(--primary);
          box-shadow: 0 7px 18px rgba(82,87,232,.2);
        }
        .brand-name { margin: 0; font-size: 14px; font-weight: 750; line-height: 1.2; }
        .status-line { gap: 5px; margin-top: 4px; color: var(--sub); font-size: 10px; }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--mint); }
        .icon-action {
          justify-content: center;
          width: 34px;
          height: 34px;
          padding: 0;
          color: var(--sub);
          border: 1px solid var(--line);
          border-radius: 12px;
          background: rgba(255,255,255,.68);
          cursor: pointer;
          transition: transform .18s ease, background .18s ease;
        }
        .icon-action:hover { background: var(--card); transform: translateY(-1px); }
        .content-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 16px 16px 122px;
          scrollbar-width: none;
        }
        .content-scroll::-webkit-scrollbar { display: none; }
        .hero-card {
          position: relative;
          overflow: hidden;
          min-height: 170px;
          padding: 21px 20px 18px;
          border-radius: 25px;
          color: #fff;
          background: var(--primary);
          box-shadow: 0 14px 28px rgba(82,87,232,.16);
        }
        .hero-card::after {
          position: absolute;
          content: "";
          width: 166px;
          height: 166px;
          left: -48px;
          top: -66px;
          border: 1px solid rgba(255,255,255,.16);
          border-radius: 50%;
          box-shadow: 0 0 0 19px rgba(255,255,255,.05), 0 0 0 38px rgba(255,255,255,.035);
        }
        .hero-copy { position: relative; z-index: 1; max-width: 278px; }
        .hero-kicker { margin: 0 0 8px; color: rgba(255,255,255,.72); font-size: 10px; font-weight: 700; letter-spacing: .08em; }
        .hero-title { margin: 0; font-size: 23px; line-height: 1.28; font-weight: 760; }
        .hero-caption { margin: 9px 0 0; color: rgba(255,255,255,.78); font-size: 11px; line-height: 1.65; }
        .hero-meta { position: relative; z-index: 1; gap: 7px; margin-top: 17px; }
        .hero-stat { padding: 7px 10px; border: 1px solid rgba(255,255,255,.2); border-radius: 10px; background: rgba(255,255,255,.1); }
        .hero-stat strong { display: block; font-size: 13px; line-height: 1; }
        .hero-stat span { display: block; margin-top: 4px; color: rgba(255,255,255,.68); font-size: 9px; }
        .hero-mark {
          position: absolute;
          left: 20px;
          bottom: 19px;
          justify-content: center;
          width: 53px;
          height: 53px;
          color: #fff;
          border: 1px solid rgba(255,255,255,.23);
          border-radius: 18px;
          background: rgba(255,255,255,.11);
        }
        .section-block { margin-top: 22px; }
        .section-heading { justify-content: space-between; margin-bottom: 11px; }
        .section-heading-side { gap: 8px; }
        .section-heading h2 { margin: 0; font-size: 14px; font-weight: 760; }
        .section-heading p { margin: 3px 0 0; color: var(--sub); font-size: 10px; }
        .section-icon { color: var(--primary); }
        .text-button {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 0;
          color: var(--primary);
          border: 0;
          background: transparent;
          font: inherit;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
        }
        .attention-stack { display: grid; gap: 8px; }
        .attention-row {
          gap: 10px;
          min-height: 59px;
          padding: 10px 11px;
          border: 1px solid var(--line);
          border-radius: 15px;
          background: var(--card);
          cursor: pointer;
          transition: transform .18s ease, box-shadow .18s ease;
        }
        .attention-row:hover { transform: translateX(-2px); box-shadow: 0 8px 17px rgba(39,54,100,.06); }
        .attention-icon {
          display: grid;
          flex: 0 0 auto;
          width: 34px;
          height: 34px;
          place-items: center;
          border-radius: 11px;
        }
        .attention-icon.rose { color: var(--rose); background: var(--rose-soft); }
        .attention-icon.blue { color: var(--primary); background: var(--blue-soft); }
        .attention-icon.mint { color: var(--mint); background: var(--mint-soft); }
        .attention-copy { min-width: 0; flex: 1; }
        .attention-copy strong, .expense-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; }
        .attention-copy span, .expense-copy span { display: block; margin-top: 4px; overflow: hidden; color: var(--sub); text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
        .attention-arrow { color: #9aa5c0; }
        .approval-card {
          padding: 14px;
          border: 1px solid #ecdbe2;
          border-radius: 18px;
          background: #fff8fa;
        }
        .approval-title { justify-content: space-between; gap: 8px; }
        .approval-title-side { display: flex; align-items: center; gap: 8px; }
        .approval-title strong { font-size: 12px; }
        .approval-title span { color: var(--rose); font-size: 9px; font-weight: 750; }
        .approval-copy { margin: 10px 0 13px; color: var(--sub); font-size: 11px; line-height: 1.6; }
        .approval-amount { display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid #f0dce3; }
        .approval-amount strong { color: var(--ink); font-size: 18px; }
        .approval-amount span { color: var(--sub); font-size: 10px; }
        .approval-actions { gap: 7px; margin-top: 11px; }
        .approval-button {
          display: inline-flex;
          flex: 1;
          align-items: center;
          justify-content: center;
          gap: 5px;
          min-height: 34px;
          border-radius: 10px;
          font: inherit;
          font-size: 11px;
          font-weight: 750;
          cursor: pointer;
          transition: transform .18s ease, opacity .18s ease;
        }
        .approval-button:hover { transform: translateY(-1px); }
        .approval-button.primary { color: #fff; border: 1px solid var(--primary); background: var(--primary); }
        .approval-button.secondary { color: var(--sub); border: 1px solid var(--line); background: var(--card); }
        .approval-done { display: flex; align-items: center; gap: 7px; color: var(--mint); font-size: 11px; font-weight: 750; }
        .expense-panel { overflow: hidden; border: 1px solid var(--line); border-radius: 17px; background: var(--card); }
        .expense-row { gap: 10px; min-height: 60px; padding: 9px 12px; border-bottom: 1px solid var(--line); }
        .expense-row:last-child { border-bottom: 0; }
        .expense-icon { display: grid; width: 28px; height: 28px; place-items: center; color: var(--primary); border-radius: 9px; background: var(--blue-soft); }
        .expense-copy { min-width: 0; flex: 1; }
        .expense-amount { color: var(--ink); font-size: 11px; font-weight: 750; white-space: nowrap; }
        .chat-panel { padding: 14px; border: 1px solid var(--line); border-radius: 19px; background: var(--card); }
        .chat-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 11px; border-bottom: 1px solid var(--line); }
        .chat-heading { display: flex; align-items: center; gap: 8px; }
        .chat-avatar { display: grid; width: 30px; height: 30px; place-items: center; color: #fff; border-radius: 10px; background: var(--primary); }
        .chat-heading strong { display: block; font-size: 12px; }
        .chat-heading span { display: block; margin-top: 3px; color: var(--sub); font-size: 9px; }
        .chat-messages { display: grid; gap: 8px; padding: 14px 0 12px; }
        .chat-message { max-width: 87%; padding: 10px 11px; border-radius: 14px; font-size: 11px; line-height: 1.6; }
        .chat-message.assistant { justify-self: start; color: var(--ink); border: 1px solid var(--line); border-top-right-radius: 5px; background: #fbfcff; }
        .chat-message.user { justify-self: end; color: #fff; border: 1px solid var(--primary); border-top-left-radius: 5px; background: var(--primary); }
        .chat-message small { display: block; margin-top: 5px; opacity: .6; font-size: 8px; }
        .composer { gap: 7px; padding: 5px 6px 5px 5px; border: 1px solid var(--line); border-radius: 14px; background: var(--bg); }
        .composer input { min-width: 0; flex: 1; height: 31px; padding: 0 6px; color: var(--ink); border: 0; outline: 0; background: transparent; font: inherit; font-size: 11px; text-align: right; }
        .composer input::placeholder { color: #95a0b9; }
        .composer-tools { gap: 1px; }
        .composer-tool { display: grid; width: 27px; height: 27px; place-items: center; color: var(--sub); border: 0; background: transparent; cursor: pointer; }
        .composer-send { justify-content: center; width: 29px; height: 29px; color: #fff; border: 0; border-radius: 10px; background: var(--primary); cursor: pointer; }
        .quick-title { gap: 7px; margin-top: 13px; color: var(--sub); font-size: 10px; font-weight: 700; }
        .quick-list { display: flex; gap: 6px; overflow-x: auto; padding: 8px 0 1px; scrollbar-width: none; }
        .quick-list::-webkit-scrollbar { display: none; }
        .quick-chip { flex: 0 0 auto; padding: 7px 10px; color: var(--primary); border: 1px solid #d7dcff; border-radius: 10px; background: var(--blue-soft); font: inherit; font-size: 10px; cursor: pointer; }
        .bottom-nav {
          position: absolute;
          z-index: 4;
          right: 13px;
          bottom: 13px;
          left: 13px;
          justify-content: space-around;
          min-height: 65px;
          padding: 6px;
          border: 1px solid rgba(223,229,243,.92);
          border-radius: 20px;
          background: rgba(255,255,255,.92);
          box-shadow: 0 12px 28px rgba(34,48,91,.1);
          backdrop-filter: blur(14px);
        }
        .nav-item {
          position: relative;
          flex: 1;
          flex-direction: column;
          justify-content: center;
          gap: 4px;
          min-height: 51px;
          color: var(--sub);
          border: 0;
          border-radius: 14px;
          background: transparent;
          font: inherit;
          font-size: 9px;
          cursor: pointer;
        }
        .nav-item.active { color: var(--primary); background: var(--blue-soft); font-weight: 750; }
        .nav-badge { position: absolute; top: 7px; right: calc(50% - 21px); width: 6px; height: 6px; border-radius: 50%; background: var(--rose); }
        .side-drawer {
          position: absolute;
          z-index: 8;
          top: 0;
          right: 0;
          bottom: 0;
          width: min(82%, 320px);
          padding: 21px 18px;
          border-left: 1px solid var(--line);
          background: var(--card);
          box-shadow: -18px 0 35px rgba(27,42,82,.12);
          animation: drawer-in .22s ease both;
        }
        .drawer-scrim { position: absolute; z-index: 7; inset: 0; background: rgba(21,33,61,.22); animation: fade-in .2s ease both; }
        .drawer-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
        .drawer-head strong { font-size: 16px; }
        .drawer-copy { margin: 17px 0 11px; color: var(--sub); font-size: 10px; line-height: 1.7; }
        .drawer-link { display: flex; align-items: center; gap: 9px; width: 100%; padding: 12px 10px; color: var(--ink); border: 0; border-radius: 11px; background: transparent; font: inherit; font-size: 12px; text-align: right; cursor: pointer; }
        .drawer-link:hover, .drawer-link.selected { color: var(--primary); background: var(--blue-soft); }
        .drawer-link svg { color: var(--primary); }
        .empty-tab { display: grid; min-height: 310px; place-items: center; padding: 28px; color: var(--sub); text-align: center; }
        .empty-tab-mark { display: grid; width: 58px; height: 58px; margin: 0 auto 12px; place-items: center; color: var(--primary); border-radius: 19px; background: var(--blue-soft); }
        .empty-tab h2 { margin: 0; color: var(--ink); font-size: 16px; }
        .empty-tab p { margin: 7px 0 0; font-size: 11px; line-height: 1.7; }
        @keyframes drawer-in { from { transform: translateX(18px); opacity: .5; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @media (min-width: 560px) {
          .secretary-page { min-height: 910px; max-height: 100dvh; border-right: 1px solid var(--line); border-left: 1px solid var(--line); }
        }
      `}</style>

      <section className="secretary-page">
        <header className="secretary-topbar">
          <div className="topbar-right">
            <div className="brand-mark" aria-hidden="true">
              <Sparkles size={19} strokeWidth={2.2} />
            </div>
            <div>
              <p className="brand-name">سكرتيري</p>
              <div className="status-line"><span className="status-dot" /> متاح الآن</div>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="icon-action" aria-label="بحث" onClick={() => setActiveTab("records")}><Search size={16} /></button>
            <button className="icon-action" aria-label="فتح القائمة" onClick={() => setMenuOpen(true)}><Menu size={17} /></button>
          </div>
        </header>

        <div className="content-scroll">
          {activeTab === "home" && (
            <>
              <section className="hero-card">
                <div className="hero-copy">
                  <p className="hero-kicker">الخميس، ٢٤ أكتوبر · القاهرة</p>
                  <h1 className="hero-title">خلّينا ننجز<br />اليوم بهدوء.</h1>
                  <p className="hero-caption">كل ما تحتاجه قريب منك — مراجعة واحدة، موعدان، وثلاثة سجلات حديثة.</p>
                  <div className="hero-meta">
                    <div className="hero-stat"><strong>٢</strong><span>مواعيد</span></div>
                    <div className="hero-stat"><strong>٣</strong><span>مهام</span></div>
                    <div className="hero-stat"><strong>١٫٢٥٠</strong><span>ج.م معلّقة</span></div>
                  </div>
                </div>
                <div className="hero-mark"><Sparkles size={22} /></div>
              </section>

              <section className="section-block">
                <div className="section-heading">
                  <div>
                    <h2>يحتاج انتباهك</h2>
                    <p>رتبتها حسب الأهم أولاً</p>
                  </div>
                  <div className="section-heading-side"><Activity className="section-icon" size={17} /><span className="text-button">الآن</span></div>
                </div>
                <div className="attention-stack">
                  {attentionItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button className="attention-row" key={item.title} onClick={() => item.tone === "rose" ? setActiveTab("inbox") : setActiveTab("records")}>
                        <span className={`attention-icon ${item.tone}`}><Icon size={16} /></span>
                        <span className="attention-copy"><strong>{item.title}</strong><span>{item.meta}</span></span>
                        <ChevronLeft className="attention-arrow" size={16} />
                      </button>
                    );
                  })}
                </div>
              </section>

              {approvalState === "pending" ? (
                <section className="section-block">
                  <div className="section-heading">
                    <div><h2>قبل أن أحفظه</h2><p>قرار صغير منك، ثم أتولى الباقي</p></div>
                    <ShieldCheck className="section-icon" size={17} />
                  </div>
                  <div className="approval-card">
                    <div className="approval-title">
                      <div className="approval-title-side"><ShieldCheck size={16} color="var(--rose)" /><strong>تسجيل مصروف جديد</strong></div>
                      <span>بانتظارك</span>
                    </div>
                    <p className="approval-copy">ذكرت أن محمود دفع معك في غداء العمل. راجع التفاصيل قبل إضافتها إلى السجلات.</p>
                    <div className="approval-amount"><strong>١٬٢٥٠ ج.م</strong><span>غداء العمل · محمود</span></div>
                    <div className="approval-actions">
                      <button className="approval-button primary" onClick={() => setApprovalState("done")}><Check size={14} /> اعتماد</button>
                      <button className="approval-button secondary" onClick={() => setActiveTab("inbox")}><MoreHorizontal size={15} /> تعديل</button>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="section-block">
                  <div className="approval-card">
                    <div className="approval-done"><CheckCircle2 size={17} /> تمت إضافة المصروف إلى السجلات</div>
                  </div>
                </section>
              )}

              <section className="section-block">
                <div className="section-heading">
                  <div><h2>آخر حركة مالية</h2><p>تقدر تفتح أي سجل وتكمل من حيث توقفت</p></div>
                  <button className="text-button" onClick={() => setShowExpenses((current) => !current)}>{showExpenses ? "إخفاء" : "عرض الكل"} <ChevronLeft size={13} /></button>
                </div>
                <div className="expense-panel">
                  {(showExpenses ? recentExpenses : recentExpenses.slice(0, 2)).map((expense) => (
                    <button className="expense-row" key={expense.title} onClick={() => setActiveTab("records")}>
                      <span className="expense-icon"><WalletCards size={14} /></span>
                      <span className="expense-copy"><strong>{expense.title}</strong><span>{expense.meta}</span></span>
                      <span className="expense-amount">{expense.amount}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="section-block">
                <div className="section-heading">
                  <div><h2>اسألني مباشرة</h2><p>لا تحتاج أن تعرف من أين تبدأ</p></div>
                  <Sparkles className="section-icon" size={17} />
                </div>
                <div className="chat-panel">
                  <div className="chat-header">
                    <div className="chat-heading"><span className="chat-avatar"><Sparkles size={15} /></span><span><strong>المساعد الشخصي</strong><span>يفهم سياقك الحالي</span></span></div>
                    <button className="icon-action" aria-label="فتح المحادثة" onClick={() => setActiveTab("inbox")}><ArrowUpLeft size={15} /></button>
                  </div>
                  <div className="chat-messages">
                    {messages.slice(-2).map((message) => <div className={`chat-message ${message.role}`} key={message.id}>{message.text}<small>{message.time}</small></div>)}
                  </div>
                  <div className="composer">
                    <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitMessage(); }} placeholder="اكتب طلبك هنا..." aria-label="اكتب طلبك" />
                    <div className="composer-tools"><button className="composer-tool" aria-label="إرفاق ملف"><Paperclip size={14} /></button><button className="composer-tool" aria-label="تسجيل صوتي"><Mic size={14} /></button></div>
                    <button className="composer-send" aria-label="إرسال" onClick={submitMessage}><Send size={14} /></button>
                  </div>
                  <div className="quick-title"><Plus size={13} /> اقتراحات سريعة</div>
                  <div className="quick-list">{quickPrompts.map((prompt) => <button className="quick-chip" key={prompt} onClick={() => selectPrompt(prompt)}>{prompt}</button>)}</div>
                </div>
              </section>
            </>
          )}

          {activeTab === "inbox" && (
            <section className="section-block">
              <div className="section-heading"><div><h2>المحادثة</h2><p>مساحة أوسع لفهم طلباتك وتنفيذها</p></div><Sparkles className="section-icon" size={17} /></div>
              <div className="chat-panel">
                <div className="chat-header"><div className="chat-heading"><span className="chat-avatar"><Sparkles size={15} /></span><span><strong>المساعد الشخصي</strong><span>متاح لمساعدتك</span></span></div><button className="icon-action" onClick={() => setActiveTab("home")} aria-label="العودة للرئيسية"><ArrowLeft size={15} /></button></div>
                <div className="chat-messages">{messages.map((message) => <div className={`chat-message ${message.role}`} key={message.id}>{message.text}<small>{message.time}</small></div>)}</div>
                <div className="composer"><input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitMessage(); }} placeholder="اكتب طلبك هنا..." aria-label="اكتب طلبك" /><div className="composer-tools"><button className="composer-tool" aria-label="إرفاق ملف"><Paperclip size={14} /></button><button className="composer-tool" aria-label="تسجيل صوتي"><Mic size={14} /></button></div><button className="composer-send" aria-label="إرسال" onClick={submitMessage}><Send size={14} /></button></div>
                <div className="quick-title"><Plus size={13} /> ابدأ من اقتراح</div><div className="quick-list">{quickPrompts.map((prompt) => <button className="quick-chip" key={prompt} onClick={() => setDraft(prompt)}>{prompt}</button>)}</div>
              </div>
            </section>
          )}

          {activeTab === "records" && (
            <section className="section-block">
              <div className="section-heading"><div><h2>السجلات</h2><p>كل ما حفظته مع سكرتيرك، مرتب في مكان واحد</p></div><button className="icon-action" aria-label="بحث في السجلات"><Search size={15} /></button></div>
              <div className="hero-card" style={{ minHeight: 135 }}>
                <div className="hero-copy"><p className="hero-kicker">أرشيفك الشخصي</p><h1 className="hero-title" style={{ fontSize: 21 }}>المعلومة التي<br />تحتاجها، أقرب.</h1><p className="hero-caption">١٨ سجل محفوظ · آخر تحديث منذ لحظات</p></div>
                <div className="hero-mark"><Archive size={22} /></div>
              </div>
              <div className="section-block"><div className="expense-panel">{recentExpenses.map((expense) => <button className="expense-row" key={expense.title} onClick={() => setActiveTab("inbox")}><span className="expense-icon"><FileText size={14} /></span><span className="expense-copy"><strong>{expense.title}</strong><span>{expense.meta}</span></span><ChevronLeft size={15} color="var(--sub)" /></button>)}</div></div>
              <div className="empty-tab"><div><div className="empty-tab-mark"><Plus size={22} /></div><h2>أضف أي سجل من المحادثة</h2><p>قل «سجّل مصروف جديد» أو افتح المساعد واسأل عن أي معلومة محفوظة.</p><button className="text-button" style={{ marginTop: 14 }} onClick={() => setActiveTab("inbox")}>ابدأ محادثة <ArrowLeft size={13} /></button></div></div>
            </section>
          )}
        </div>

        <nav className="bottom-nav" aria-label="التنقل الرئيسي">
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button className={`nav-item ${activeTab === item.id ? "active" : ""}`} key={item.id} onClick={() => setActiveTab(item.id)}><Icon size={17} />{item.id === "inbox" && <span className="nav-badge" />}{item.label}</button>;
          })}
        </nav>

        {menuOpen && <><button className="drawer-scrim" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} /><aside className="side-drawer"><div className="drawer-head"><strong>مساحات سكرتيرك</strong><button className="icon-action" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)}><X size={16} /></button></div><p className="drawer-copy">نقلتُ التنقل إلى قائمة جانبية صغيرة حتى تبقى شاشة اليوم هادئة ومركزة.</p>{navItems.map((item) => { const Icon = item.icon; return <button className={`drawer-link ${activeTab === item.id ? "selected" : ""}`} key={item.id} onClick={() => { setActiveTab(item.id); setMenuOpen(false); }}><Icon size={16} />{item.label}<ChevronLeft size={14} style={{ marginRight: "auto" }} /></button>; })}<button className="drawer-link" onClick={() => setMenuOpen(false)}><Settings2 size={16} /> تفضيلات المساعد <ChevronLeft size={14} style={{ marginRight: "auto" }} /></button></aside></>}
      </section>
    </main>
  );
}