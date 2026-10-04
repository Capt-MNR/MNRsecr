import { useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  Clock3,
  FileText,
  Headphones,
  Mic,
  Paperclip,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

type Decision = "pending" | "approved" | "rejected";

export function AdaptiveWorkspace() {
  const [decision, setDecision] = useState<Decision>("pending");
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [receiptAdded, setReceiptAdded] = useState(false);
  const [draft, setDraft] = useState("");
  const [sentRequest, setSentRequest] = useState("");

  const sendRequest = () => {
    if (!draft.trim()) return;
    setSentRequest(draft.trim());
    setDraft("");
  };

  return (
    <main className="aw-root" dir="rtl" aria-label="مساحة السكرتير الشخصية">
      <style>{`
        .aw-root {
          --aw-sand: #f5f1ea;
          --aw-paper: #faf8f5;
          --aw-teal: #2b5f69;
          --aw-ink: #212f35;
          --aw-muted: #657881;
          --aw-line: #dfd8ce;
          --aw-copper: #d0996d;
          --aw-red: #bd4032;
          min-height: 100dvh;
          width: 100%;
          box-sizing: border-box;
          overflow: hidden;
          color: var(--aw-ink);
          background:
            radial-gradient(ellipse at 100% 0%, rgba(208,153,109,.15), transparent 35%),
            var(--aw-sand);
          font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", system-ui, sans-serif;
          display: flex;
          flex-direction: column;
          position: relative;
          isolation: isolate;
        }
        .aw-root *, .aw-root *::before, .aw-root *::after { box-sizing: border-box; }
        .aw-root::after {
          content: "";
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          opacity: .18;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.12'/%3E%3C/svg%3E");
        }
        .aw-shell {
          width: min(100%, 430px);
          min-height: 100dvh;
          margin-inline: auto;
          display: flex;
          flex-direction: column;
          padding: 22px 21px 15px;
        }
        .aw-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 45px;
          margin-block-end: 22px;
        }
        .aw-brand { display: flex; align-items: center; gap: 11px; }
        .aw-mark {
          width: 38px; height: 38px; border-radius: 14px;
          color: #f8f6f2; background: var(--aw-teal);
          display: grid; place-items: center;
          box-shadow: 0 5px 12px rgba(43,95,105,.15);
        }
        .aw-brand-name { font-size: 14px; line-height: 1.25; font-weight: 750; letter-spacing: -.02em; }
        .aw-brand-sub { color: var(--aw-muted); font-size: 10px; margin-block-start: 3px; }
        .aw-context {
          border: 1px solid var(--aw-line); background: rgba(250,248,245,.72);
          color: var(--aw-teal); border-radius: 999px; height: 36px;
          padding-inline: 11px; display: inline-flex; align-items: center; gap: 7px;
          font: inherit; font-size: 11px; font-weight: 650; cursor: pointer;
          transition: transform .16s ease, background .16s ease;
        }
        .aw-context:active, .aw-button:active, .aw-tool:active { transform: scale(.97); }
        .aw-intro { margin-block-end: 18px; }
        .aw-eyebrow {
          display: flex; align-items: center; gap: 7px; color: var(--aw-muted);
          font-size: 11px; font-weight: 600; margin-block-end: 7px;
        }
        .aw-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--aw-copper); }
        .aw-heading {
          margin: 0; font-size: clamp(25px, 7vw, 30px); line-height: 1.3;
          letter-spacing: -.04em; font-weight: 750;
        }
        .aw-heading span { color: var(--aw-teal); }
        .aw-lede { margin: 5px 0 0; font-size: 12px; line-height: 1.55; color: var(--aw-muted); }
        .aw-focus {
          border: 1px solid rgba(43,95,105,.13);
          border-radius: 23px;
          background: var(--aw-paper);
          padding: 17px;
          box-shadow: 0 12px 26px rgba(33,47,53,.055);
          position: relative;
          overflow: hidden;
        }
        .aw-focus::before {
          content: ""; position: absolute; inset-block: 0; inset-inline-start: 0;
          width: 4px; background: var(--aw-copper);
        }
        .aw-focus-top {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          margin-block-end: 14px;
        }
        .aw-kicker { display: flex; align-items: center; gap: 7px; color: var(--aw-teal); font-size: 11px; font-weight: 750; }
        .aw-kicker-icon { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 9px; background: #e8efed; }
        .aw-status {
          display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
          border-radius: 999px; background: #f4e8db; color: #815432;
          padding: 5px 8px; font-size: 9px; font-weight: 750;
        }
        .aw-operation { font-size: 18px; line-height: 1.5; font-weight: 750; letter-spacing: -.02em; margin: 0; }
        .aw-quote {
          border-inline-start: 2px solid var(--aw-copper); margin-block: 12px 13px;
          padding-inline: 11px; color: #53666d; font-size: 12px; line-height: 1.6;
        }
        .aw-details {
          display: flex; align-items: center; gap: 6px; color: var(--aw-muted);
          font-size: 10px; margin-block-end: 14px;
        }
        .aw-action-row { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
        .aw-button {
          border: 1px solid transparent; border-radius: 12px; min-height: 43px;
          padding: 0 12px; display: inline-flex; justify-content: center; align-items: center; gap: 7px;
          font: inherit; font-size: 12px; font-weight: 750; cursor: pointer;
          transition: transform .16s ease, background .16s ease, border-color .16s ease;
        }
        .aw-approve { color: #f8f6f2; background: var(--aw-teal); }
        .aw-reject { color: var(--aw-ink); background: transparent; border-color: var(--aw-line); }
        .aw-boundary {
          display: flex; gap: 7px; align-items: flex-start; margin-block-start: 12px;
          color: var(--aw-muted); font-size: 10px; line-height: 1.5;
        }
        .aw-boundary svg { flex: none; margin-block-start: 1px; color: var(--aw-teal); }
        .aw-decision {
          border-radius: 16px; padding: 14px; display: flex; gap: 11px; align-items: flex-start;
          background: #e9efec; color: var(--aw-teal); border: 1px solid #d5e2dc;
          font-size: 12px; line-height: 1.55;
        }
        .aw-decision.rejected { background: #f5e9e6; color: var(--aw-red); border-color: #ecd3ce; }
        .aw-side-note {
          margin-block-start: 15px; padding: 13px 14px; border: 1px solid var(--aw-line);
          border-radius: 16px; display: flex; align-items: center; justify-content: space-between;
          background: rgba(250,248,245,.48);
        }
        .aw-next-label { color: var(--aw-muted); font-size: 10px; margin-block-end: 4px; }
        .aw-next-title { font-size: 12px; font-weight: 700; }
        .aw-time { display: flex; align-items: center; gap: 5px; color: var(--aw-teal); font-size: 11px; font-weight: 700; }
        .aw-lower {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          margin-block-start: 16px; color: var(--aw-muted); font-size: 10px;
        }
        .aw-memory { display: inline-flex; gap: 6px; align-items: center; }
        .aw-memory-mark { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; background: #e8e1d7; border-radius: 7px; color: var(--aw-teal); }
        .aw-view-records {
          border: 0; padding: 4px 0; background: transparent; color: var(--aw-teal);
          font: inherit; font-weight: 750; font-size: 10px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
        }
        .aw-spacer { flex: 1 1 auto; min-height: 14px; }
        .aw-composer {
          margin-block-start: 15px; border-radius: 20px; padding: 11px 12px 10px;
          background: var(--aw-paper); border: 1px solid var(--aw-line);
          box-shadow: 0 7px 22px rgba(33,47,53,.06);
        }
        .aw-compose-line { display: flex; gap: 9px; align-items: center; }
        .aw-input {
          min-width: 0; flex: 1; resize: none; border: 0; outline: 0; background: transparent;
          color: var(--aw-ink); font: inherit; font-size: 13px; line-height: 1.5;
          padding: 6px 2px; text-align: start;
        }
        .aw-input::placeholder { color: #829096; opacity: 1; }
        .aw-send {
          border: 0; flex: none; width: 37px; height: 37px; border-radius: 13px;
          color: #f8f6f2; background: var(--aw-teal); display: grid; place-items: center; cursor: pointer;
        }
        .aw-tools { display: flex; align-items: center; gap: 7px; margin-block-start: 7px; }
        .aw-tool {
          min-height: 31px; display: inline-flex; align-items: center; gap: 6px;
          padding: 0 9px; border-radius: 10px; border: 1px solid transparent;
          color: var(--aw-muted); background: transparent; font: inherit; font-size: 10px; cursor: pointer;
          transition: transform .16s ease, background .16s ease;
        }
        .aw-tool.active { background: #e7efed; color: var(--aw-teal); border-color: #d1dfdc; }
        .aw-compose-hint { margin-inline-start: auto; font-size: 9px; color: #88959a; }
        .aw-feedback { margin-block-start: 8px; border-radius: 11px; padding: 8px 10px; background: #f1ede6; color: var(--aw-muted); font-size: 10px; line-height: 1.45; }
        .aw-modal-backdrop {
          position: fixed; inset: 0; z-index: 5; display: flex; align-items: flex-end; justify-content: center;
          background: rgba(24,37,41,.30); padding: 14px;
        }
        .aw-records {
          width: min(100%, 430px); background: var(--aw-paper); border: 1px solid var(--aw-line);
          border-radius: 24px; padding: 19px; box-shadow: 0 18px 50px rgba(25,38,42,.19);
          animation: aw-rise .22s ease-out both;
        }
        @keyframes aw-rise { from { transform: translateY(16px); opacity: .75; } to { transform: translateY(0); opacity: 1; } }
        .aw-modal-head { display: flex; justify-content: space-between; align-items: flex-start; margin-block-end: 14px; }
        .aw-modal-title { margin: 0; font-size: 18px; letter-spacing: -.03em; }
        .aw-modal-subtitle { margin: 4px 0 0; font-size: 11px; color: var(--aw-muted); }
        .aw-close { border: 0; width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; color: var(--aw-ink); background: #f0ebe3; cursor: pointer; }
        .aw-record { display: flex; align-items: center; gap: 11px; padding: 12px 0; border-block-start: 1px solid #ebe5dc; }
        .aw-record-icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 11px; background: #e8efed; color: var(--aw-teal); flex: none; }
        .aw-record-name { font-size: 12px; font-weight: 700; }
        .aw-record-meta { font-size: 10px; color: var(--aw-muted); margin-block-start: 3px; }
        .aw-demo-note { margin-block-start: 12px; padding: 9px 10px; border-radius: 10px; color: #805a3a; background: #f4e8db; font-size: 9px; line-height: 1.5; }
        @media (max-width: 360px) {
          .aw-shell { padding-inline: 16px; }
          .aw-intro { margin-block-end: 14px; }
          .aw-operation { font-size: 16px; }
          .aw-focus { padding: 14px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .aw-root *, .aw-root *::before, .aw-root *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
        }
      `}</style>

      <div className="aw-shell">
        <header className="aw-header">
          <div className="aw-brand">
            <div className="aw-mark" aria-hidden="true"><Headphones size={19} strokeWidth={1.8} /></div>
            <div>
              <div className="aw-brand-name">مُعين</div>
              <div className="aw-brand-sub">سكرتيرك الشخصي</div>
            </div>
          </div>
          <button className="aw-context" type="button" onClick={() => setRecordsOpen(true)} aria-label="فتح السجلات والسياق">
            <FileText size={14} />
            سجلاتي
            <ChevronLeft size={13} />
          </button>
        </header>

        <section className="aw-intro" aria-labelledby="aw-heading">
          <div className="aw-eyebrow"><span className="aw-eyebrow-dot" /> الأحد، ١٢ مايو <span aria-hidden="true">·</span> صباح الخير</div>
          <h1 className="aw-heading" id="aw-heading">خلّينا نبدأ<br /><span>بالأهم.</span></h1>
          <p className="aw-lede">أرتّب لك ما يحتاج قرارك أولاً.</p>
        </section>

        <section className="aw-focus" aria-label="حالة ذات أولوية">
          <div className="aw-focus-top">
            <div className="aw-kicker"><span className="aw-kicker-icon"><Sparkles size={14} /></span> يحتاج قرارك</div>
            {decision === "pending" && <span className="aw-status"><Clock3 size={11} /> بانتظارك</span>}
          </div>
          {decision === "pending" ? (
            <>
              <h2 className="aw-operation">إرسال تذكير إلى ندى بخصوص دفعة المشروع</h2>
              <div className="aw-quote">«مرحباً ندى، تذكير لطيف بالدفعة المتبقية لمشروع الهوية.»</div>
              <div className="aw-details"><Clock3 size={13} /> رسالة واتساب · لن تُرسل إلا بموافقتك</div>
              <div className="aw-action-row">
                <button className="aw-button aw-approve" type="button" onClick={() => setDecision("approved")} aria-label="موافقة على إرسال التذكير">
                  <Check size={15} /> موافقة
                </button>
                <button className="aw-button aw-reject" type="button" onClick={() => setDecision("rejected")} aria-label="رفض إرسال التذكير">
                  <X size={15} /> رفض
                </button>
              </div>
              <div className="aw-boundary"><ShieldCheck size={14} /> لم يتم الإرسال. أنت من يقرر إن كان هذا الإجراء سيتم.</div>
            </>
          ) : (
            <div className={`aw-decision ${decision === "rejected" ? "rejected" : ""}`} role="status" aria-live="polite">
              {decision === "approved" ? <Check size={17} /> : <X size={17} />}
              <div>
                <strong>{decision === "approved" ? "تم تسجيل موافقتك في هذا العرض التجريبي." : "تم تسجيل رفضك في هذا العرض التجريبي."}</strong>
                <div>{decision === "approved" ? "لا يحدث إرسال فعلي هنا." : "لم يتم إرسال الرسالة، ويمكنك مراجعتها لاحقاً."}</div>
              </div>
            </div>
          )}
        </section>

        <aside className="aw-side-note" aria-label="الالتزام القادم">
          <div>
            <div className="aw-next-label">التالي في يومك</div>
            <div className="aw-next-title">مراجعة ميزانية الحملة</div>
          </div>
          <div className="aw-time"><Clock3 size={13} /> ١١:٣٠ ص</div>
        </aside>

        <div className="aw-lower">
          <span className="aw-memory"><span className="aw-memory-mark"><ShieldCheck size={12} /></span> سياقك محفوظ ومنظّم</span>
          <button type="button" className="aw-view-records" onClick={() => setRecordsOpen(true)}>عرض السجلات <ChevronLeft size={13} /></button>
        </div>

        <div className="aw-spacer" />

        <form className="aw-composer" onSubmit={(event) => { event.preventDefault(); sendRequest(); }}>
          <div className="aw-compose-line">
            <label htmlFor="aw-request" className="aw-sr-only" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
              اكتب ما تريد من مُعين
            </label>
            <textarea
              id="aw-request"
              className="aw-input"
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="اكتب ما يدور في بالك…"
              aria-label="اكتب طلباً باللغة الطبيعية"
            />
            <button className="aw-send" type="submit" aria-label="إرسال الطلب"><ArrowUp size={18} /></button>
          </div>
          <div className="aw-tools">
            <button type="button" className={`aw-tool ${voiceOn ? "active" : ""}`} onClick={() => setVoiceOn(!voiceOn)} aria-pressed={voiceOn} aria-label={voiceOn ? "إيقاف الإدخال الصوتي التجريبي" : "بدء الإدخال الصوتي"}>
              <Mic size={14} /> {voiceOn ? "يستمع الآن" : "صوت"}
            </button>
            <button type="button" className={`aw-tool ${receiptAdded ? "active" : ""}`} onClick={() => setReceiptAdded(!receiptAdded)} aria-pressed={receiptAdded} aria-label="إضافة إيصال">
              <Paperclip size={14} /> إيصال
            </button>
            <span className="aw-compose-hint">اسأل، سجّل، أو رتّب</span>
          </div>
          {(voiceOn || receiptAdded || sentRequest) && (
            <div className="aw-feedback" role="status" aria-live="polite">
              {voiceOn ? "الإدخال الصوتي في وضع العرض — لم يبدأ تسجيل فعلي." : receiptAdded ? "تم اختيار إيصال للعرض التجريبي فقط." : `طلبك التجريبي: «${sentRequest}» — لم يُنفّذ أي إجراء.`}
            </div>
          )}
        </form>
      </div>

      {recordsOpen && (
        <div className="aw-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRecordsOpen(false); }}>
          <section className="aw-records" role="dialog" aria-modal="true" aria-labelledby="aw-record-title">
            <div className="aw-modal-head">
              <div><h2 className="aw-modal-title" id="aw-record-title">سجلاتك وسياقك</h2><p className="aw-modal-subtitle">مكان واحد لما يهمك، مرتبطاً بطلباتك.</p></div>
              <button className="aw-close" type="button" onClick={() => setRecordsOpen(false)} aria-label="إغلاق السجلات"><X size={16} /></button>
            </div>
            <div className="aw-record">
              <span className="aw-record-icon"><Clock3 size={16} /></span>
              <div><div className="aw-record-name">تذكير دفعة مشروع الهوية</div><div className="aw-record-meta">مع ندى · بانتظار قرارك</div></div>
            </div>
            <div className="aw-record">
              <span className="aw-record-icon"><FileText size={16} /></span>
              <div><div className="aw-record-name">مشروع الهوية البصرية</div><div className="aw-record-meta">مشروع نشط · آخر تحديث قبل يومين</div></div>
            </div>
            <div className="aw-record">
              <span className="aw-record-icon"><Headphones size={16} /></span>
              <div><div className="aw-record-name">ندى الحربي</div><div className="aw-record-meta">جهة اتصال مرتبطة بالمشروع</div></div>
            </div>
            <div className="aw-demo-note">محتوى توضيحي خيالي لعرض التصميم، وليس بيانات حساب حقيقية.</div>
          </section>
        </div>
      )}
    </main>
  );
}