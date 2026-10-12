"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { askQuestionAction } from "@/app/(public)/ask-action";
import { chatAskAction, chatHumanAction, chatSendAction, chatThreadAction } from "@/app/chat-actions";
import { FormGuard } from "@/components/site/form-guard";
import { cn } from "@/lib/cn";

type Line = { from: "me" | "assistant" | "team"; text: string };

/**
 * Small help chat in the corner (owner request Oct 2026). Visitors: the "Ask a question" flow
 * (answered from the FAQ, else a person replies by email). Signed-in clinics/providers: answers
 * from the knowledge base, and "Talk to a person" opens a support thread answered from Admin → Support;
 * replies show up here (checked every few seconds while open) and by email.
 */
export function ChatBubble({ mode, userId, inApp = false }: { mode: "visitor" | "member"; userId?: string; inApp?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("fixed right-4 z-50 print:hidden", inApp ? "bottom-20 lg:bottom-6" : "bottom-5")}>
      {open ? (
        <div className="mb-3 flex h-[min(480px,calc(100dvh-9rem))] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-brand-600 px-4 py-3 text-white">
            <div>
              <div className="text-sm font-semibold">Help</div>
              <div className="text-xs text-brand-100">{mode === "member" ? "Quick answers, or a person from our team" : "Ask us anything about coverage"}</div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="rounded-lg p-1 hover:bg-white/10"><X className="size-5" /></button>
          </div>
          {mode === "member" ? <MemberChat userId={userId ?? "me"} /> : <VisitorChat />}
        </div>
      ) : null}
      <div className="flex justify-end">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close chat" : "Open chat"}
          className="grid size-12 place-items-center rounded-full bg-brand-600 text-white shadow-lg transition hover:bg-brand-700"
        >
          {open ? <X className="size-5" /> : <MessageCircle className="size-6" />}
        </button>
      </div>
    </div>
  );
}

function Bubble({ line }: { line: Line }) {
  return (
    <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm", line.from === "me" ? "ml-auto bg-brand-600 text-white" : "bg-slate-100 text-slate-800")}>
      {line.from === "team" ? <div className="mb-0.5 text-[11px] font-semibold text-accent-700">Our team</div> : null}
      {line.text}
    </div>
  );
}

function useScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [dep]);
  return ref;
}

function MemberChat({ userId }: { userId: string }) {
  const key = `cm.chat.req.${userId}`;
  const [lines, setLines] = useState<Line[]>([{ from: "assistant", text: "Hi! Ask a question about shifts, payments, credentials or your account. If I can't answer, a person from our team will." }]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [thread, setThread] = useState<Line[]>([]);
  const [closed, setClosed] = useState(false);
  const [offerHuman, setOfferHuman] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = requestId ? [...lines, ...thread] : lines;
  const scroll = useScroll(shown.length);

  useEffect(() => {
    try { const id = localStorage.getItem(key); if (id) setRequestId(id); } catch { /* storage off */ }
  }, [key]);

  // While a person is on it: pick up replies every few seconds.
  useEffect(() => {
    if (!requestId) return;
    let stop = false;
    const load = async () => {
      const r = await chatThreadAction(requestId);
      if (stop) return;
      if (!r.ok) { try { localStorage.removeItem(key); } catch { /* */ } setRequestId(null); return; }
      setThread(r.lines);
      setClosed(r.status === "CLOSED");
    };
    load();
    const t = setInterval(load, 6000);
    return () => { stop = true; clearInterval(t); };
  }, [requestId, key]);

  async function send() {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true); setError(null);
    if (requestId && !closed) {
      const r = await chatSendAction(requestId, q);
      if (r.ok) { setThread((t) => [...t, { from: "me", text: q }]); setText(""); } else setError(r.error);
      setBusy(false);
      return;
    }
    const next: Line[] = [...lines, { from: "me", text: q }];
    setLines(next); setText("");
    const r = await chatAskAction(q);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    if (r.answer) { setLines([...next, { from: "assistant", text: r.answer }]); setOfferHuman(true); }
    else { setLines([...next, { from: "assistant", text: "That's one for our team. Tap \"Talk to a person\" and someone will reply here and by email." }]); setOfferHuman(true); }
  }

  async function human() {
    setBusy(true); setError(null);
    const r = await chatHumanAction(lines.filter((l) => l.from !== "team"));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    try { localStorage.setItem(key, r.requestId); } catch { /* */ }
    setLines((l) => [...l, { from: "assistant", text: "Done. A person from our team will reply here and by email." }]);
    setRequestId(r.requestId); setOfferHuman(false); setClosed(false);
  }

  function restart() {
    try { localStorage.removeItem(key); } catch { /* */ }
    setRequestId(null); setThread([]); setClosed(false); setOfferHuman(false);
    setLines([{ from: "assistant", text: "Hi again! What can I help with?" }]);
  }

  return (
    <>
      <div ref={scroll} className="flex-1 space-y-2 overflow-y-auto p-3">
        {shown.map((l, i) => <Bubble key={i} line={l} />)}
        {busy ? <Loader2 className="size-4 animate-spin text-slate-400" /> : null}
        {offerHuman && !requestId ? <button onClick={human} disabled={busy} className="rounded-full border border-brand-200 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">Talk to a person</button> : null}
        {closed ? <button onClick={restart} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">This chat is closed · start a new one</button> : null}
      </div>
      {error ? <p role="alert" className="mx-3 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 border-t border-slate-200 p-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={requestId && !closed ? "Reply to our team…" : "Type your question…"} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
        <button disabled={busy || !text.trim()} aria-label="Send" className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white disabled:opacity-40"><Send className="size-4" /></button>
      </form>
      <p className="px-3 pb-2 text-[11px] text-slate-400">Please don&apos;t share patient information.</p>
    </>
  );
}

function VisitorChat() {
  const [lines, setLines] = useState<Line[]>([{ from: "assistant", text: "Hi! Ask about coverage, pricing, credentials or how it works. We'll answer right away, or a person will reply by email." }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState({ name: "", email: "" });
  const scroll = useScroll(lines.length);
  return (
    <>
      <div ref={scroll} className="flex-1 space-y-2 overflow-y-auto p-3">
        {lines.map((l, i) => <Bubble key={i} line={l} />)}
        {busy ? <Loader2 className="size-4 animate-spin text-slate-400" /> : null}
      </div>
      {error ? <p role="alert" className="mx-3 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
      <form
        className="space-y-2 border-t border-slate-200 p-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          const q = String(fd.get("question") ?? "").trim();
          if (!q) return;
          setBusy(true); setError(null);
          setLines((l) => [...l, { from: "me", text: q }]);
          const r = await askQuestionAction(fd);
          setBusy(false);
          if ("error" in r) { setError(r.error); return; }
          setLines((l) => [...l, { from: "assistant", text: r.answer }]);
          (form.elements.namedItem("question") as HTMLInputElement).value = "";
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <input name="name" required value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} placeholder="Your name" className="min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
          <input name="email" type="email" required value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} placeholder="Email" className="min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
        </div>
        <div className="flex gap-2">
          <input name="question" required maxLength={2000} placeholder="Type your question…" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
          <button disabled={busy} aria-label="Send" className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white disabled:opacity-40"><Send className="size-4" /></button>
        </div>
        <FormGuard />
      </form>
    </>
  );
}
