import { useState } from "react";
import {
  ArrowUp,
  AudioLines,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock3,
  FolderKanban,
  Mic,
  Paperclip,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";

type Decision = "pending" | "approved" | "rejected";

export function IntentSurface() {
  const [draft, setDraft] = useState("");
  const [decision, setDecision] = useState<Decision>("pending");
  const [listening, setListening] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [sentPrompt, setSentPrompt] = useState("");

  const sendDraft = () => {
    if (!draft.trim()) return;
    setSentPrompt(draft.trim());
    setDraft("");
  };

  return (
    <main className="intent-screen" dir="rtl" aria-label="الشاشة الرئيسية للسكرتير الشخصي">
      <style>{`
        .intent-screen {
          --sand: #f5f1ea;
          --paper: #fbf9f5;
          --ink: #212f35;
          --teal: #2b5f69;
          --teal-soft: #e4eeec;
          --copper: #d0996d;
          --muted: #657881;
          --line: #dfd8ce;
          --soft: #eee8df;
          box-sizing: border-box;
          width: 100%;
          min-height: 100dvh;
          background: var(--sand);
          color: var(--ink);
          display: flex;
          flex-direction: column;
          align-items: center;
          font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", system-ui, sans-serif;
          overflow-x: hidden;
          position: relative;
          isolation: isolate;
        }
        .intent-screen * { box-sizing: border-box; }
        .intent-screen button, .intent-screen textarea { font: inherit; }
        .intent-screen button { color: inherit; }
        .intent-frame {
          width: min(100%, 430px);
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          position: relative;
          background:
            radial-gradient(ellipse at 98% 0%, rgba(208,153,109,.15), transparent 32%),
            var(--sand);
        }
        .intent-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 17px 22px 11px;
          gap: 12px;
        }
        .intent-brand { display:flex; align-items:center; gap:11px; min-width:0; }
        .intent-mark {
          width: 42px; height:42px; border-radius:15px;
          background:var(--teal); color:#f8f6f2;
          display:grid; place-items:center; flex:none;
          box-shadow: 0 5px 14px rgba(43,95,105,.17);
        }
        .intent-brand-copy { display:grid; gap:2px; }
        .intent-brand-name { font-size:15px; font-weight:750; letter-spacing:-.2px; }
        .intent-brand-sub { color:var(--muted); font-size:10px; }
        .intent-records-link {
          border:1px solid var(--line); background:rgba(251,249,245,.72);
          border-radius:14px; min-height:40px; padding:0 12px;
          display:flex; align-items:center; gap:7px;
          color:var(--teal) !important; font-size:11px; font-weight:700;
          cursor:pointer; transition: transform .18s, background .18s;
          white-space:nowrap;
        }
        .intent-records-link:active, .intent-action:active, .intent-tool:active { transform:scale(.97); }
        .intent-sample {
          margin: 2px 22px 0;
          display:flex; align-items:center; gap:7px;
          color:#79573d; font-size:10px; line-height:1.4;
        }
        .intent-sample-dot { width:6px;height:6px;border-radius:50%;background:var(--copper); flex:none; }
        .intent-intro { padding:22px 23px 19px; }
        .intent-eyebrow {
          display:flex; align-items:center; gap:7px; color:var(--teal);
          font-size:11px; font-weight:700; margin-bottom:7px;
        }
        .intent-greeting {
          margin:0; font-size:27px; line-height:1.33; letter-spacing:-.75px;
          font-weight:750; max-width:330px;
        }
        .intent-greeting span { color:var(--teal); }
        .intent-intro-copy {
          margin:7px 0 0; max-width:305px; color:var(--muted);
          font-size:12px; line-height:1.8;
        }
        .intent-compose {
          margin:0 16px 17px;
          padding:13px 14px 11px;
          border:1px solid #d9d1c5; border-radius:20px;
          background:var(--paper);
          box-shadow:0 10px 26px rgba(52,62,58,.055);
        }
        .intent-compose-head { display:flex; align-items:center; gap:7px; color:var(--teal); font-size:11px; font-weight:700; }
        .intent-textarea {
          display:block; width:100%; min-height:61px; resize:none; outline:none;
          border:0; background:transparent; color:var(--ink);
          padding:12px 0 9px; font-size:14px; line-height:1.7;
          text-align:right; direction:rtl;
        }
        .intent-textarea::placeholder { color:#8a9697; opacity:1; }
        .intent-compose-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .intent-tools { display:flex; align-items:center; gap:8px; }
        .intent-tool {
          width:35px;height:35px;border-radius:12px;border:1px solid var(--line);
          color:var(--muted) !important;background:var(--sand);display:grid;place-items:center;
          cursor:pointer;transition:transform .18s,background .18s;
        }
        .intent-tool[data-active="true"] { background:var(--teal-soft); color:var(--teal) !important; border-color:#c9dbd7; }
        .intent-send {
          border:0; min-height:36px; border-radius:12px; padding:0 13px;
          display:flex; align-items:center; gap:8px; color:#f8f6f2 !important;
          background:var(--teal); font-size:11px; font-weight:700; cursor:pointer;
          transition:transform .18s,opacity .18s;
        }
        .intent-send:disabled { opacity:.44; cursor:default; }
        .intent-send:not(:disabled):active { transform:scale(.97); }
        .intent-helper { margin-top:9px; color:var(--muted); font-size:9px; }
        .intent-feedback {
          margin:-5px 18px 14px; border-radius:13px; padding:10px 12px;
          color:var(--teal); background:var(--teal-soft); font-size:11px; line-height:1.7;
        }
        .intent-proposal { margin:0 16px; }
        .intent-section-heading {
          display:flex; align-items:center; justify-content:space-between; gap:8px;
          margin:0 5px 10px;
        }
        .intent-section-title { font-size:14px; font-weight:750; margin:0; }
        .intent-count {
          display:inline-flex; align-items:center; gap:6px; color:#815b3e;
          background:#f0e2d4; border-radius:999px; padding:5px 9px;
          font-size:10px; font-weight:700; white-space:nowrap;
        }
        .intent-count-mark { width:6px;height:6px;border-radius:50%;background:var(--copper); }
        .intent-card {
          overflow:hidden; border:1px solid #dcd1c2; border-radius:20px;
          background:var(--paper); box-shadow:0 9px 24px rgba(52,62,58,.045);
        }
        .intent-card-top {
          padding:14px 15px 12px; display:flex; align-items:flex-start; gap:11px;
        }
        .intent-card-icon {
          width:37px;height:37px;border-radius:13px;display:grid;place-items:center;
          background:#f2e5d7;color:#9a6842;flex:none;
        }
        .intent-card-copy { flex:1; min-width:0; }
        .intent-card-kicker { color:#956541; font-size:10px; font-weight:700; margin-bottom:4px; }
        .intent-card-title { margin:0; font-size:14px; font-weight:750; line-height:1.65; }
        .intent-card-meta {
          margin-top:5px; color:var(--muted); font-size:10px;
          display:flex; flex-wrap:wrap; align-items:center; gap:5px;
        }
        .intent-card-rule { height:1px; background:var(--line); margin-inline:15px; }
        .intent-details {
          padding:11px 15px 12px; display:grid; gap:10px;
        }
        .intent-detail-row { display:flex; align-items:flex-start; gap:9px; }
        .intent-detail-icon { color:var(--muted); flex:none; margin-top:2px; }
        .intent-detail-label { display:block; font-size:9px; color:var(--muted); margin-bottom:2px; }
        .intent-detail-value { display:block; font-size:11px; line-height:1.55; font-weight:650; }
        .intent-safety {
          background:#f2eee7; padding:8px 12px; margin:0 13px 12px;
          border-radius:12px; display:flex; gap:8px; align-items:flex-start;
          color:var(--muted); font-size:9px; line-height:1.65;
        }
        .intent-safety svg { color:var(--teal); flex:none; margin-top:1px; }
        .intent-card-actions {
          display:flex; gap:8px; padding:0 13px 13px;
        }
        .intent-action {
          min-height:39px; border-radius:12px; padding:0 12px;
          display:flex; justify-content:center; align-items:center; gap:7px;
          font-size:11px; font-weight:750; cursor:pointer; transition:transform .18s,opacity .18s;
        }
        .intent-approve { flex:1; border:1px solid var(--teal); background:var(--teal); color:#f8f6f2 !important; }
        .intent-reject { border:1px solid var(--line); background:transparent; color:var(--muted) !important; }
        .intent-result {
          display:flex;align-items:flex-start;gap:9px;padding:11px 14px;
          margin:0 13px 13px;border-radius:13px;background:var(--teal-soft);
          color:var(--teal);font-size:11px;line-height:1.65;
        }
        .intent-result[data-kind="rejected"] { background:#f3e8e1;color:#80583f; }
        .intent-context {
          padding:20px 20px 24px;
        }
        .intent-context-head {
          display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;
        }
        .intent-context-title { font-size:12px;font-weight:750;margin:0; }
        .intent-see-all {
          border:0;background:transparent;color:var(--teal);font-weight:700;font-size:10px;
          display:flex;align-items:center;gap:3px;cursor:pointer;padding:4px;
        }
        .intent-record-strip { display:flex; gap:8px; overflow:auto; scrollbar-width:none; padding-bottom:2px; }
        .intent-record-strip::-webkit-scrollbar { display:none; }
        .intent-record {
          flex:none; min-width:122px; padding:9px 10px; border:1px solid var(--line);
          border-radius:14px;background:rgba(251,249,245,.72);
          display:flex;align-items:center;gap:8px;text-align:right;
        }
        .intent-record-symbol {
          width:29px;height:29px;border-radius:10px;background:var(--teal-soft);
          color:var(--teal);display:grid;place-items:center;flex:none;
        }
        .intent-record-name { display:block;font-size:10px;font-weight:750;white-space:nowrap; }
        .intent-record-kind { display:block;color:var(--muted);font-size:9px;margin-top:2px; }
        .intent-bottom {
          margin-top:auto; padding:12px 19px 17px;
          border-top:1px solid rgba(223,216,206,.85);
          display:flex;align-items:center;justify-content:space-between;
          background:rgba(245,241,234,.88);
          color:var(--muted);font-size:9px;
        }
        .intent-bottom-status { display:flex;align-items:center;gap:7px; }
        .intent-status-dot { width:7px;height:7px;border-radius:50%;background:var(--teal); }
        .intent-bottom-link { display:flex;align-items:center;gap:5px;color:var(--teal);font-weight:700; }
        .intent-receipt-note {
          margin:-5px 18px 13px;padding:9px 11px;border:1px dashed #c9b9a7;
          border-radius:12px;color:#79573d;background:#f8eee4;font-size:10px;line-height:1.6;
        }
        .intent-screen button:focus-visible, .intent-screen textarea:focus-visible {
          outline:3px solid rgba(43,95,105,.35); outline-offset:2px;
        }
        @media (min-width: 431px) {
          .intent-frame { box-shadow:0 0 0 1px rgba(33,47,53,.04), 0 20px 65px rgba(33,47,53,.09); }
        }
        @media (max-height: 760px) {
          .intent-intro { padding-top:13px;padding-bottom:13px; }
          .intent-greeting { font-size:23px; }
          .intent-compose { margin-bottom:12px; }
          .intent-context { padding-top:14px;padding-bottom:16px; }
        }
      `}</style>

      <div className="intent-frame">
        <header className="intent-topbar">
          <div className="intent-brand">
            <div className="intent-mark" aria-hidden="true"><Sparkles size={19} strokeWidth={1.8} /></div>
            <div className="intent-brand-copy">
              <span className="intent-brand-name">مَعين</span>
              <span className="intent-brand-sub">سكرتيرك الشخصي</span>
            </div>
          </div>
          <button
            type="button"
            className="intent-records-link"
            onClick={() => setRecordsOpen((open) => !open)}
            aria-expanded={recordsOpen}
            aria-controls="intent-records"
          >
            <BookOpen size={15} />
            <span>سجلاتي</span>
            <ChevronLeft size={14} />
          </button>
        </header>

        <div className="intent-sample" role="note">
          <span className="intent-sample-dot" />
          نموذج توضيحي · السجلات المعروضة خيالية
        </div>

        <section className="intent-intro" aria-labelledby="intent-greeting">
          <div className="intent-eyebrow"><AudioLines size={14} /> أنا معك، خطوة بخطوة</div>
          <h1 className="intent-greeting" id="intent-greeting">
            ما الذي تريد<br /><span>إنجازه اليوم؟</span>
          </h1>
          <p className="intent-intro-copy">
            احكِ لي ما يدور في بالك. سأرتّب الخطوة التالية لتراجعها قبل أي تغيير.
          </p>
        </section>

        <section className="intent-compose" aria-label="اكتب طلبك">
          <div className="intent-compose-head">
            <Sparkles size={14} />
            <span>ابدأ بطريقتك</span>
          </div>
          <label htmlFor="intent-prompt" className="sr-only">اكتب ما تريد من السكرتير</label>
          <textarea
            id="intent-prompt"
            className="intent-textarea"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="مثال: ذكّرني بمتابعة ليلى غدًا…"
            aria-label="اكتب طلبك بلغة طبيعية"
          />
          <div className="intent-compose-foot">
            <div className="intent-tools" aria-label="طرق الإدخال">
              <button
                type="button"
                className="intent-tool"
                data-active={listening}
                aria-label={listening ? "إيقاف التسجيل الصوتي التجريبي" : "بدء إدخال صوتي تجريبي"}
                aria-pressed={listening}
                onClick={() => setListening((active) => !active)}
              >
                <Mic size={16} />
              </button>
              <button
                type="button"
                className="intent-tool"
                aria-label="إضافة إيصال تجريبي"
                aria-expanded={receiptOpen}
                onClick={() => setReceiptOpen((open) => !open)}
              >
                <ReceiptText size={16} />
              </button>
              <button
                type="button"
                className="intent-tool"
                aria-label="إرفاق ملف تجريبي"
                onClick={() => setReceiptOpen(true)}
              >
                <Paperclip size={15} />
              </button>
            </div>
            <button type="button" className="intent-send" onClick={sendDraft} disabled={!draft.trim()}>
              <span>أرسل الطلب</span><ArrowUp size={15} />
            </button>
          </div>
          <div className="intent-helper">
            {listening ? "وضع الاستماع التجريبي — اضغط الميكروفون للإيقاف" : "كتابة أو صوت أو إيصال · لا شيء يُنفّذ دون قرارك"}
          </div>
        </section>

        {receiptOpen && (
          <div className="intent-receipt-note" role="status">
            معاينة تجريبية: أرفق إيصالًا هنا، ثم راجع بياناته قبل حفظ أي مصروف.
          </div>
        )}
        {sentPrompt && (
          <div className="intent-feedback" role="status">
            وصل طلبك في هذا العرض التجريبي: «{sentPrompt}» — لم يُنشأ سجل أو يُنفّذ إجراء.
            <button
              type="button"
              aria-label="إخفاء رسالة الطلب"
              onClick={() => setSentPrompt("")}
              style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", marginInlineStart: 7, verticalAlign: "middle" }}
            ><X size={13} /></button>
          </div>
        )}

        <section className="intent-proposal" aria-labelledby="intent-proposal-title">
          <div className="intent-section-heading">
            <h2 className="intent-section-title" id="intent-proposal-title">خطوة للمراجعة</h2>
            <span className="intent-count"><span className="intent-count-mark" /> بانتظار قرارك</span>
          </div>
          <article className="intent-card">
            <div className="intent-card-top">
              <div className="intent-card-icon"><CalendarDays size={18} /></div>
              <div className="intent-card-copy">
                <div className="intent-card-kicker">مسودة تذكير · نموذج خيالي</div>
                <h3 className="intent-card-title" id="intent-proposal-title-card">متابعة عرض المشروع مع ليلى</h3>
                <div className="intent-card-meta">
                  <Clock3 size={12} /> غدًا، ١٠:٠٠ ص
                  <span aria-hidden="true">·</span>
                  من طلب تجريبي
                </div>
              </div>
            </div>
            <div className="intent-card-rule" />
            <div className="intent-details">
              <div className="intent-detail-row">
                <UserRound className="intent-detail-icon" size={14} />
                <div><span className="intent-detail-label">الشخص</span><span className="intent-detail-value">ليلى منصور</span></div>
              </div>
              <div className="intent-detail-row">
                <FolderKanban className="intent-detail-icon" size={14} />
                <div><span className="intent-detail-label">مرتبط بـ</span><span className="intent-detail-value">مشروع النخيل · مراجعة العرض</span></div>
              </div>
            </div>
            <div className="intent-safety">
              <ShieldCheck size={14} />
              <span>هذه مسودة فقط. لن يُحفظ التذكير أو يُرسل شيء حتى تختار «اعتماد المسودة» بنفسك.</span>
            </div>
            {decision === "pending" ? (
              <div className="intent-card-actions" aria-label="اتخاذ قرار بشأن المسودة">
                <button type="button" className="intent-action intent-approve" onClick={() => setDecision("approved")}>
                  <Check size={15} /> اعتماد المسودة
                </button>
                <button type="button" className="intent-action intent-reject" onClick={() => setDecision("rejected")}>
                  <X size={15} /> رفض
                </button>
              </div>
            ) : (
              <div className="intent-result" data-kind={decision === "rejected" ? "rejected" : "approved"} role="status">
                {decision === "approved" ? <Check size={15} /> : <X size={15} />}
                <span>
                  {decision === "approved"
                    ? "اعتمدت المسودة في هذا العرض التجريبي. لا يوجد حفظ فعلي."
                    : "رُفضت المسودة في هذا العرض التجريبي. لم يُنشأ تذكير."}
                </span>
                <button type="button" aria-label="إعادة المسودة إلى حالة الانتظار" onClick={() => setDecision("pending")} style={{ marginInlineStart: "auto", border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontSize: 9, textDecoration: "underline" }}>
                  تراجع
                </button>
              </div>
            )}
          </article>
        </section>

        <section className="intent-context" id="intent-records" aria-label="سياق مرتبط">
          <div className="intent-context-head">
            <h2 className="intent-context-title">{recordsOpen ? "السجلات ذات الصلة" : "من سياقك"}</h2>
            <button type="button" className="intent-see-all" onClick={() => setRecordsOpen((open) => !open)} aria-expanded={recordsOpen}>
              {recordsOpen ? "إخفاء" : "كل السجلات"} <ChevronLeft size={13} />
            </button>
          </div>
          <div className="intent-record-strip">
            <div className="intent-record"><span className="intent-record-symbol"><UserRound size={15} /></span><span><span className="intent-record-name">ليلى منصور</span><span className="intent-record-kind">شخص · عينة</span></span></div>
            <div className="intent-record"><span className="intent-record-symbol"><FolderKanban size={15} /></span><span><span className="intent-record-name">مشروع النخيل</span><span className="intent-record-kind">مشروع · عينة</span></span></div>
            {recordsOpen && (
              <>
                <div className="intent-record"><span className="intent-record-symbol"><CalendarDays size={15} /></span><span><span className="intent-record-name">متابعة العرض</span><span className="intent-record-kind">مسودة تذكير</span></span></div>
                <div className="intent-record"><span className="intent-record-symbol"><ReceiptText size={15} /></span><span><span className="intent-record-name">لا توجد إيصالات</span><span className="intent-record-kind">في هذا المثال</span></span></div>
              </>
            )}
          </div>
        </section>

        <footer className="intent-bottom">
          <div className="intent-bottom-status"><span className="intent-status-dot" /> جاهز للاستماع لطلبك</div>
          <div className="intent-bottom-link"><ShieldCheck size={13} /> أنت صاحب القرار</div>
        </footer>
      </div>
    </main>
  );
}