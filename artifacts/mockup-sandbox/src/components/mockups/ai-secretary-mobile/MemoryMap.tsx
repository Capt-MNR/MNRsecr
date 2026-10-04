import { useState } from "react";
import {
  ArrowUp,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  Clock3,
  FileText,
  Mic,
  ReceiptText,
  Search,
  ShieldCheck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";

type Language = "ar" | "en";
type MemoryNode = "person" | "project" | "task" | "reminder" | "expense";

const memoryLabels: Record<MemoryNode, { ar: string; en: string; detailAr: string; detailEn: string }> = {
  person: {
    ar: "ليلى منصور",
    en: "Layla Mansour",
    detailAr: "شخص · زميلة",
    detailEn: "Person · colleague",
  },
  project: {
    ar: "إطلاق الربيع",
    en: "Spring launch",
    detailAr: "مشروع · آخر تواصل أمس",
    detailEn: "Project · last touched yesterday",
  },
  task: {
    ar: "مراجعة العرض",
    en: "Review the proposal",
    detailAr: "مهمة · الخميس",
    detailEn: "Task · Thursday",
  },
  reminder: {
    ar: "متابعة ليلى",
    en: "Follow up with Layla",
    detailAr: "تذكير · ٣:٣٠ م",
    detailEn: "Reminder · 3:30 PM",
  },
  expense: {
    ar: "غداء فريق الإطلاق",
    en: "Launch team lunch",
    detailAr: "مصروف · ٤٨٠ ج.م",
    detailEn: "Expense · EGP 480",
  },
};

export function MemoryMap() {
  const [language, setLanguage] = useState<Language>("ar");
  const [selected, setSelected] = useState<MemoryNode>("person");
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState("");
  const [voiceOn, setVoiceOn] = useState(false);
  const [receiptAdded, setReceiptAdded] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [decision, setDecision] = useState<"pending" | "approved" | "rejected">("pending");
  const isArabic = language === "ar";
  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const selectNode = (node: MemoryNode) => setSelected(node);
  const submitDraft = () => {
    const value = draft.trim();
    if (!value) return;
    setSent(value);
    setDraft("");
    setVoiceOn(false);
  };

  return (
    <main className="mm-shell" dir={isArabic ? "rtl" : "ltr"} lang={language} aria-label={t("مساعدك الشخصي — خريطة الذاكرة", "Personal Secretary — Memory Map")}>
      <style>{`
        .mm-shell {
          --sand: #f5f1ea;
          --paper: #faf8f5;
          --teal: #2b5f69;
          --teal-dark: #214e57;
          --ink: #212f35;
          --muted: #657881;
          --copper: #d0996d;
          --line: #dfd8ce;
          --wash: #e9e4dd;
          min-height: 100dvh;
          width: 100%;
          max-width: 480px;
          margin-inline: auto;
          background:
            radial-gradient(ellipse at 50% 35%, rgba(208,153,109,.09), transparent 54%),
            var(--sand);
          color: var(--ink);
          font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", ui-sans-serif, system-ui, sans-serif;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          padding: 0 18px 15px;
        }
        .mm-shell *, .mm-shell *::before, .mm-shell *::after { box-sizing: border-box; }
        .mm-shell::after {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          opacity: .14;
          z-index: 5;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.84' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.12'/%3E%3C/svg%3E");
        }
        .mm-header {
          height: 54px; flex: 0 0 auto; display: flex; align-items: center;
          justify-content: space-between; border-bottom: 1px solid rgba(33,47,53,.1);
        }
        .mm-brand { display: flex; gap: 9px; align-items: center; font-size: 13px; font-weight: 700; letter-spacing: -.02em; }
        .mm-brand-mark {
          width: 28px; height: 28px; display: grid; place-items: center; color: var(--paper);
          background: var(--teal); border-radius: 10px 10px 10px 4px; box-shadow: 0 4px 10px #2b5f6925;
        }
        .mm-header-actions { display: flex; align-items: center; gap: 8px; }
        .mm-link-button, .mm-language {
          border: 0; background: transparent; color: var(--muted); cursor: pointer;
          display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 11px;
          padding: 8px 5px;
        }
        .mm-language { color: var(--teal); font-weight: 700; border-inline-start: 1px solid var(--line); padding-inline-start: 12px; }
        .mm-intro { padding: 17px 1px 13px; animation: mm-enter .45s both; }
        .mm-kicker { color: var(--teal); display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 700; letter-spacing: .08em; }
        .mm-title { font-size: 24px; line-height: 1.22; letter-spacing: -.045em; margin: 5px 0 3px; font-weight: 750; }
        .mm-subtitle { color: var(--muted); margin: 0; font-size: 12px; line-height: 1.55; }
        .mm-composer {
          padding: 10px 11px 9px; background: var(--paper); border: 1px solid #dfd8ce;
          border-radius: 16px; box-shadow: 0 6px 20px rgba(33,47,53,.045);
          animation: mm-enter .48s .04s both;
        }
        .mm-composer-top { display: flex; align-items: flex-start; gap: 9px; }
        .mm-agent-dot { width: 26px; height: 26px; flex: 0 0 26px; background: #e7efed; color: var(--teal); border-radius: 9px; display: grid; place-items: center; }
        .mm-input {
          flex: 1; min-width: 0; min-height: 48px; outline: none; resize: none; border: 0;
          background: transparent; color: var(--ink); font: inherit; font-size: 13px; line-height: 1.5;
          padding: 2px 0;
        }
        .mm-input::placeholder { color: #869197; opacity: 1; }
        .mm-composer-bottom { display: flex; align-items: center; justify-content: space-between; padding-top: 7px; border-top: 1px solid #eee9e2; }
        .mm-entry-actions { display: flex; align-items: center; gap: 2px; }
        .mm-entry {
          border: 0; background: transparent; color: var(--muted); display: inline-flex; align-items: center;
          gap: 5px; border-radius: 9px; padding: 6px 7px; cursor: pointer; font: inherit; font-size: 10px;
          transition: background .18s ease, color .18s ease;
        }
        .mm-entry:hover, .mm-entry.is-active { background: #e7efed; color: var(--teal); }
        .mm-send {
          width: 31px; height: 31px; border: 0; border-radius: 10px; display: grid; place-items: center;
          background: var(--teal); color: white; cursor: pointer; transition: transform .16s ease, background .16s ease;
        }
        .mm-send:hover { background: var(--teal-dark); transform: translateY(-1px); }
        .mm-inline-note { color: var(--teal); font-size: 10px; margin: 6px 2px 0; }
        .mm-map-section { padding-top: 16px; animation: mm-enter .5s .08s both; }
        .mm-section-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .mm-section-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 750; margin: 0; }
        .mm-count { font-size: 10px; color: var(--muted); background: #eae5dd; padding: 4px 8px; border-radius: 999px; }
        .mm-map-card {
          position: relative; height: 254px; border: 1px solid var(--line); border-radius: 18px;
          background:
            radial-gradient(circle at 50% 46%, rgba(43,95,105,.07), transparent 37%),
            linear-gradient(145deg, rgba(250,248,245,.95), rgba(243,238,230,.94));
          overflow: hidden;
        }
        .mm-grid {
          position: absolute; inset: 0; opacity: .42; pointer-events: none;
          background-image: radial-gradient(rgba(101,120,129,.22) .7px, transparent .7px);
          background-size: 13px 13px;
          mask-image: linear-gradient(to bottom, black, transparent 96%);
        }
        .mm-lines { position: absolute; inset: 0; width: 100%; height: 100%; }
        .mm-line { stroke: #99adae; stroke-width: 1.25; stroke-dasharray: 3 4; fill: none; opacity: .78; }
        .mm-line-active { stroke: var(--copper); stroke-width: 2; stroke-dasharray: none; opacity: .9; }
        .mm-node {
          position: absolute; z-index: 1; border: 1px solid #dfd8ce; border-radius: 12px;
          background: rgba(250,248,245,.97); color: var(--ink); padding: 7px 8px;
          min-height: 47px; width: 126px; text-align: start; display: flex; align-items: center; gap: 7px;
          cursor: pointer; box-shadow: 0 4px 10px rgba(33,47,53,.055);
          transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
        }
        .mm-node:hover { transform: translateY(-2px); }
        .mm-node.selected { border-color: var(--copper); box-shadow: 0 0 0 2px rgba(208,153,109,.18), 0 5px 12px rgba(33,47,53,.08); }
        .mm-node.person { width: 145px; min-height: 62px; border-radius: 16px; background: var(--teal); color: #faf8f5; border: 0; box-shadow: 0 8px 18px rgba(43,95,105,.2); }
        .mm-node.project { inset-inline-start: 5%; top: 9%; }
        .mm-node.task { inset-inline-end: 5%; top: 9%; }
        .mm-node.person { top: 37%; inset-inline-start: 50%; transform: translateX(-50%); }
        .mm-node.person:hover { transform: translateX(-50%) translateY(-2px); }
        .mm-node.reminder { inset-inline-start: 5%; bottom: 9%; }
        .mm-node.expense { inset-inline-end: 5%; bottom: 9%; }
        .mm-node-icon { width: 27px; height: 27px; flex: 0 0 27px; display: grid; place-items: center; border-radius: 9px; background: #e7efed; color: var(--teal); }
        .mm-node.person .mm-node-icon { background: rgba(250,248,245,.15); color: #f8f3eb; width: 34px; height: 34px; flex-basis: 34px; border-radius: 11px; }
        .mm-node.expense .mm-node-icon { background: #f4e9dc; color: #98633f; }
        .mm-node-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .mm-node-name { font-size: 10px; font-weight: 750; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mm-node-meta { font-size: 8px; opacity: .78; white-space: nowrap; }
        .mm-relation-label {
          position: absolute; z-index: 2; inset-inline-start: 50%; top: 64%;
          transform: translateX(-50%); color: #876949; font-size: 8px; background: var(--sand);
          padding: 2px 6px; border-radius: 999px; white-space: nowrap;
        }
        .mm-evidence {
          min-height: 48px; display: flex; align-items: center; gap: 8px; padding: 8px 3px 0;
          color: var(--muted); font-size: 10px; line-height: 1.4;
        }
        .mm-evidence-icon { display: grid; place-items: center; width: 23px; height: 23px; flex: 0 0 23px; background: #eae5dd; border-radius: 8px; color: var(--teal); }
        .mm-evidence strong { color: var(--ink); font-weight: 700; }
        .mm-pending {
          margin-top: 11px; padding: 12px; border: 1px solid rgba(208,153,109,.62);
          border-radius: 16px; background: #f8f0e7; animation: mm-enter .52s .12s both;
        }
        .mm-pending-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .mm-pending-title { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 12px; font-weight: 750; }
        .mm-review-label { color: #8e613f; background: #edddca; padding: 4px 7px; border-radius: 99px; font-size: 9px; font-weight: 700; white-space: nowrap; }
        .mm-operation { margin-top: 8px; display: flex; align-items: center; gap: 9px; }
        .mm-operation-icon { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; border-radius: 10px; background: var(--paper); color: #98633f; }
        .mm-operation-copy { min-width: 0; flex: 1; }
        .mm-operation-name { margin: 0; font-size: 11px; font-weight: 700; line-height: 1.4; }
        .mm-operation-meta { color: var(--muted); font-size: 9px; margin: 2px 0 0; }
        .mm-pending-actions { display: flex; gap: 7px; margin-top: 10px; }
        .mm-decision {
          flex: 1; border-radius: 9px; padding: 8px 7px; font: inherit; font-size: 10px; font-weight: 700;
          cursor: pointer; display: inline-flex; justify-content: center; align-items: center; gap: 5px;
          transition: transform .15s ease, opacity .15s ease;
        }
        .mm-decision:hover { transform: translateY(-1px); }
        .mm-approve { color: white; border: 1px solid var(--teal); background: var(--teal); }
        .mm-reject { color: #765848; border: 1px solid #d7c7b5; background: transparent; }
        .mm-decision:disabled { opacity: .45; cursor: not-allowed; transform: none; }
        .mm-decision-state { margin: 9px 0 0; color: var(--teal-dark); font-size: 10px; font-weight: 650; line-height: 1.45; }
        .mm-bottom { margin-top: auto; padding-top: 11px; display: flex; justify-content: space-between; align-items: center; color: var(--muted); }
        .mm-bottom-note { display: flex; align-items: center; gap: 5px; font-size: 9px; }
        .mm-privacy { display: flex; align-items: center; gap: 4px; font-size: 9px; }
        .mm-overlay {
          position: absolute; z-index: 8; inset: 54px 0 0; background: rgba(33,47,53,.2);
          display: flex; align-items: flex-end; padding: 12px; animation: mm-fade .18s both;
        }
        .mm-record-sheet {
          background: var(--paper); border: 1px solid var(--line); border-radius: 18px; width: 100%;
          padding: 15px 14px 12px; box-shadow: 0 14px 36px rgba(33,47,53,.18);
          animation: mm-rise .22s both;
        }
        .mm-sheet-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .mm-sheet-title { margin: 0; font-size: 14px; font-weight: 750; display: flex; gap: 7px; align-items: center; }
        .mm-close { width: 30px; height: 30px; border: 0; border-radius: 9px; background: var(--wash); color: var(--ink); display: grid; place-items: center; cursor: pointer; }
        .mm-record-row { width: 100%; border: 0; border-top: 1px solid #eee9e2; background: transparent; text-align: start; padding: 9px 2px; display: flex; align-items: center; gap: 9px; color: var(--ink); cursor: pointer; font: inherit; }
        .mm-record-row:first-of-type { border-top: 0; }
        .mm-record-row-icon { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 9px; background: #e7efed; color: var(--teal); }
        .mm-record-row-copy { flex: 1; display: flex; flex-direction: column; gap: 2px; }
        .mm-record-row-copy strong { font-size: 11px; }
        .mm-record-row-copy small { color: var(--muted); font-size: 9px; }
        .mm-demo-label { font-size: 8px; letter-spacing: .035em; }
        @keyframes mm-enter { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes mm-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mm-rise { from { opacity: .6; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 360px) {
          .mm-shell { padding-inline: 13px; }
          .mm-node { width: 116px; padding: 6px; }
          .mm-node.person { width: 138px; }
          .mm-node.project, .mm-node.reminder { inset-inline-start: 3%; }
          .mm-node.task, .mm-node.expense { inset-inline-end: 3%; }
          .mm-entry { padding-inline: 5px; font-size: 9px; }
        }
        @media (prefers-reduced-motion: reduce) { .mm-shell *, .mm-shell *::before, .mm-shell *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
      `}</style>

      <header className="mm-header">
        <div className="mm-brand">
          <span className="mm-brand-mark"><BookOpen size={15} strokeWidth={1.8} /></span>
          <span>{t("السكرتير الشخصي", "Personal Secretary")}</span>
        </div>
        <div className="mm-header-actions">
          <button className="mm-link-button" type="button" onClick={() => setRecordsOpen(true)} aria-label={t("فتح السجلات والسياق", "Open records and context")}>
            <Search size={15} />
            <span>{t("السجلات", "Records")}</span>
          </button>
          <button className="mm-language" type="button" onClick={() => setLanguage(isArabic ? "en" : "ar")} aria-label={t("Switch to English", "التبديل إلى العربية")}>
            {isArabic ? "EN" : "ع"}
          </button>
        </div>
      </header>

      <section className="mm-intro">
        <div className="mm-kicker"><ShieldCheck size={13} /> {t("ذاكرة واضحة، بقرارك", "A clear memory, on your terms")}</div>
        <h1 className="mm-title">{t("كل شيء متصل.", "Your day, connected.")}</h1>
        <p className="mm-subtitle">{t("اسأل بطريقتك. أُظهر لك الأشخاص والسجلات المرتبطة.", "Ask naturally. See the people and records behind the answer.")}</p>
      </section>

      <section className="mm-composer" aria-label={t("اسأل السكرتير", "Ask your secretary")}>
        <div className="mm-composer-top">
          <span className="mm-agent-dot"><Search size={14} /></span>
          <textarea
            className="mm-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitDraft(); } }}
            placeholder={t("مثال: ما الذي وعدت ليلى به؟", "Try: What did Layla promise?")}
            aria-label={t("اكتب طلبك بلغة طبيعية", "Type a natural-language request")}
            rows={2}
          />
        </div>
        <div className="mm-composer-bottom">
          <div className="mm-entry-actions">
            <button type="button" className={`mm-entry${voiceOn ? " is-active" : ""}`} aria-pressed={voiceOn} onClick={() => setVoiceOn(!voiceOn)}>
              <Mic size={13} /> {t("صوت", "Voice")}
            </button>
            <button type="button" className={`mm-entry${receiptAdded ? " is-active" : ""}`} aria-pressed={receiptAdded} onClick={() => setReceiptAdded(!receiptAdded)}>
              <ReceiptText size={13} /> {t("إيصال", "Receipt")}
            </button>
          </div>
          <button className="mm-send" type="button" onClick={submitDraft} aria-label={t("إرسال الطلب", "Send request")}><ArrowUp size={16} /></button>
        </div>
        {voiceOn && <p className="mm-inline-note">{t("إدخال صوتي تجريبي — اضغط مرة أخرى للإيقاف.", "Demo voice entry — tap again to stop.")}</p>}
        {receiptAdded && <p className="mm-inline-note">{t("أُضيف إيصال تجريبي للمراجعة، لم يُرفع أي ملف.", "Demo receipt attached for review; no file was uploaded.")}</p>}
        {sent && <p className="mm-inline-note" role="status">{t("طلبك في هذه المعاينة: ", "Your request in this preview: ")}“{sent}”</p>}
      </section>

      <section className="mm-map-section" aria-label={t("خريطة السجلات المرتبطة", "Connected records map")}>
        <div className="mm-section-top">
          <h2 className="mm-section-title"><span style={{ color: "var(--copper)" }}><UserRound size={15} /></span>{t("خريطة الذاكرة", "Memory map")}</h2>
          <span className="mm-count">{t("٥ سجلات تجريبية", "5 demo records")}</span>
        </div>
        <div className="mm-map-card">
          <div className="mm-grid" />
          <svg className="mm-lines" viewBox="0 0 354 254" preserveAspectRatio="none" aria-hidden="true">
            <path className={`mm-line${selected === "project" ? " mm-line-active" : ""}`} d="M76 51 C106 61 129 83 177 119" />
            <path className={`mm-line${selected === "task" ? " mm-line-active" : ""}`} d="M278 51 C248 64 223 87 177 119" />
            <path className={`mm-line${selected === "reminder" ? " mm-line-active" : ""}`} d="M76 204 C109 190 137 161 177 133" />
            <path className={`mm-line${selected === "expense" ? " mm-line-active" : ""}`} d="M278 204 C248 188 220 160 177 133" />
            <circle cx="177" cy="126" r="4" fill="#d0996d" opacity=".85" />
          </svg>
          <span className="mm-relation-label">{t("مرتبطة بـ", "connected to")}</span>
          <button type="button" className={`mm-node project${selected === "project" ? " selected" : ""}`} onClick={() => selectNode("project")} aria-pressed={selected === "project"}>
            <span className="mm-node-icon"><BriefcaseBusiness size={14} /></span>
            <span className="mm-node-copy"><span className="mm-node-name">{t(memoryLabels.project.ar, memoryLabels.project.en)}</span><span className="mm-node-meta">{t("مشروع", "Project")}</span></span>
          </button>
          <button type="button" className={`mm-node task${selected === "task" ? " selected" : ""}`} onClick={() => selectNode("task")} aria-pressed={selected === "task"}>
            <span className="mm-node-icon"><Check size={14} /></span>
            <span className="mm-node-copy"><span className="mm-node-name">{t(memoryLabels.task.ar, memoryLabels.task.en)}</span><span className="mm-node-meta">{t("مهمة · الخميس", "Task · Thu")}</span></span>
          </button>
          <button type="button" className={`mm-node person${selected === "person" ? " selected" : ""}`} onClick={() => selectNode("person")} aria-pressed={selected === "person"}>
            <span className="mm-node-icon"><UserRound size={17} /></span>
            <span className="mm-node-copy"><span className="mm-node-name">{t(memoryLabels.person.ar, memoryLabels.person.en)}</span><span className="mm-node-meta">{t("الشخص المحوري", "Relationship anchor")}</span></span>
          </button>
          <button type="button" className={`mm-node reminder${selected === "reminder" ? " selected" : ""}`} onClick={() => selectNode("reminder")} aria-pressed={selected === "reminder"}>
            <span className="mm-node-icon"><Bell size={14} /></span>
            <span className="mm-node-copy"><span className="mm-node-name">{t(memoryLabels.reminder.ar, memoryLabels.reminder.en)}</span><span className="mm-node-meta">{t("تذكير · ٣:٣٠ م", "Reminder · 3:30 PM")}</span></span>
          </button>
          <button type="button" className={`mm-node expense${selected === "expense" ? " selected" : ""}`} onClick={() => selectNode("expense")} aria-pressed={selected === "expense"}>
            <span className="mm-node-icon"><WalletCards size={14} /></span>
            <span className="mm-node-copy"><span className="mm-node-name">{t(memoryLabels.expense.ar, memoryLabels.expense.en)}</span><span className="mm-node-meta">{t("مصروف · ٤٨٠ ج.م", "Expense · EGP 480")}</span></span>
          </button>
        </div>
        <div className="mm-evidence" aria-live="polite">
          <span className="mm-evidence-icon"><Clock3 size={13} /></span>
          <span><strong>{t(memoryLabels[selected].ar, memoryLabels[selected].en)}</strong> · {t(memoryLabels[selected].detailAr, memoryLabels[selected].detailEn)}. {t("سجل توضيحي — لا توجد بيانات مباشرة.", "Illustrative record — not live product data.")}</span>
        </div>
      </section>

      <section className="mm-pending" aria-label={t("عملية معلقة بانتظار قرارك", "Pending operation awaiting your decision")}>
        <div className="mm-pending-head">
          <h2 className="mm-pending-title"><ShieldCheck size={15} color="#98633f" />{t("قبل أن أُحدّث ذاكرتك", "Before I update your memory")}</h2>
          <span className="mm-review-label">{decision === "pending" ? t("بانتظار قرارك", "Your decision") : t("حُسمت في المعاينة", "Demo decision")}</span>
        </div>
        <div className="mm-operation">
          <span className="mm-operation-icon"><Bell size={16} /></span>
          <div className="mm-operation-copy">
            <p className="mm-operation-name">{t("إضافة تذكير: متابعة ليلى غدًا", "Add reminder: follow up with Layla tomorrow")}</p>
            <p className="mm-operation-meta">{t("مصدره: طلبك في المحادثة · لم يُنفّذ", "From: your message · not executed")}</p>
          </div>
        </div>
        {decision === "pending" ? (
          <div className="mm-pending-actions">
            <button className="mm-decision mm-approve" type="button" onClick={() => setDecision("approved")}><Check size={13} />{t("موافقة", "Approve")}</button>
            <button className="mm-decision mm-reject" type="button" onClick={() => setDecision("rejected")}><X size={13} />{t("رفض", "Reject")}</button>
          </div>
        ) : (
          <p className="mm-decision-state" role="status">
            {decision === "approved"
              ? t("وافقتَ في العرض التوضيحي فقط. لا يحدث أي تنفيذ فعلي.", "Approved in this demo only. No real action was executed.")
              : t("رُفضت في العرض التوضيحي فقط. لا يحدث أي تغيير في السجلات.", "Rejected in this demo only. No records were changed.")}
          </p>
        )}
        {decision === "pending" && <div className="mm-demo-label" style={{ color: "#8e755f", marginTop: 8 }}>{t("لن يحدث شيء قبل اختيارك.", "Nothing happens until you choose.")}</div>}
      </section>

      <footer className="mm-bottom">
        <span className="mm-bottom-note"><FileText size={12} />{t("محتوى توضيحي للمعاينة", "Illustrative preview content")}</span>
        <span className="mm-privacy"><ShieldCheck size={12} />{t("ذاكرتك، تحت سيطرتك", "Your memory, in your control")}</span>
      </footer>

      {recordsOpen && (
        <div className="mm-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setRecordsOpen(false); }}>
          <section className="mm-record-sheet" role="dialog" aria-modal="true" aria-labelledby="mm-sheet-title">
            <div className="mm-sheet-head">
              <h2 className="mm-sheet-title" id="mm-sheet-title"><BookOpen size={16} color="var(--teal)" />{t("السجلات والسياق", "Records & context")}</h2>
              <button className="mm-close" type="button" onClick={() => setRecordsOpen(false)} aria-label={t("إغلاق", "Close")}><X size={16} /></button>
            </div>
            {(Object.keys(memoryLabels) as MemoryNode[]).map((node) => {
              const Icon = node === "person" ? UserRound : node === "project" ? BriefcaseBusiness : node === "task" ? Check : node === "reminder" ? Bell : WalletCards;
              return (
                <button className="mm-record-row" type="button" key={node} onClick={() => { selectNode(node); setRecordsOpen(false); }}>
                  <span className="mm-record-row-icon"><Icon size={14} /></span>
                  <span className="mm-record-row-copy">
                    <strong>{t(memoryLabels[node].ar, memoryLabels[node].en)}</strong>
                    <small>{t(memoryLabels[node].detailAr, memoryLabels[node].detailEn)}</small>
                  </span>
                  <ChevronLeft size={15} style={{ transform: isArabic ? "none" : "rotate(180deg)", color: "var(--muted)" }} />
                </button>
              );
            })}
            <div className="mm-demo-label" style={{ color: "var(--muted)", borderTop: "1px solid var(--line)", paddingTop: 9 }}>
              {t("كل الأسماء والتفاصيل هنا أمثلة خيالية.", "All names and details shown here are fictional examples.")}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}