import { describe, expect, it } from "vitest";
import { callTurn, forVoice, handoffFirstText, handoffNumber, handoffProblemSay, isGoodbye, isUrgentCall, lastFourForVoice, wantsPerson } from "../src/callagent";

const base = { mode: "chat" as const, intent: "FallbackIntent", text: "", turn: 0, maxTurns: 8, answer: null as string | null };

describe("phone AI agent: what happens on each turn (never a live transfer)", () => {
  it("answers a question it has an approved answer for, then keeps listening", () => {
    expect(callTurn({ ...base, text: "How much is a full day?", answer: "A full day starts at $450." })).toEqual({ action: "continue", say: "A full day starts at $450. Is there anything else I can help with?", outcome: "ANSWERED" });
  });

  it("asking for a person, an urgent problem or no approved answer all become a callback request", () => {
    expect(callTurn({ ...base, intent: "TalkToPerson", text: "talk to a person" })).toMatchObject({ action: "message" });
    expect(callTurn({ ...base, text: "can I speak with a real person" }).say).toMatch(/best number to reach you/);
    expect(callTurn({ ...base, text: "our doctor didn't show up today" })).toMatchObject({ action: "message", urgent: true });
    expect(callTurn({ ...base, text: "can you change my invoice address" })).toMatchObject({ action: "message" });
  });

  it("in message mode, whatever they say is the callback request, then the call ends", () => {
    expect(callTurn({ ...base, mode: "message", intent: "TalkToPerson", text: "Dr. Lee, 407 555 0100, about Friday" })).toEqual({
      action: "end", outcome: "MESSAGE", message: "Dr. Lee, 407 555 0100, about Friday", say: "Thank you. I've passed that to our team, and someone will call you back. Goodbye!",
    });
    expect(callTurn({ ...base, mode: "message", text: "" })).toMatchObject({ action: "message" });
  });

  it("goodbyes and long calls end politely", () => {
    expect(callTurn({ ...base, intent: "Goodbye", text: "no that's all thanks" })).toMatchObject({ action: "end", outcome: "ANSWERED" });
    expect(callTurn({ ...base, turn: 8, text: "and another thing", answer: "Sure." })).toMatchObject({ action: "message" });
  });

  it("turns an answer into something that sounds right on a call", () => {
    expect(forVoice("See **pricing** at https://coverageoncall.com/for-clinics (it's live).")).toBe("See pricing on our website (it's live).");
    expect(forVoice("a ".repeat(400)).length).toBeLessThanOrEqual(420);
    expect(wantsPerson("Can I talk to someone")).toBe(true);
    expect(wantsPerson("How do I add someone to my team")).toBe(false);
    expect(isUrgentCall("the provider is not here yet")).toBe(true);
    expect(isUrgentCall("what are your rates")).toBe(false);
    expect(isGoodbye("nope, that's it, bye")).toBe(true);
  });
});

describe("call menu: continue by text / callback", () => {
  const norm = (raw: string) => { const d = raw.replace(/\D/g, ""); const t = d.length === 11 && d.startsWith("1") ? d.slice(1) : d; return t.length === 10 ? `+1${t}` : null; };
  it("uses the caller ID when they confirm it, or the digits they keyed in", () => {
    expect(handoffNumber({ choice: "same", callerPhone: "+14075551234" }, norm)).toEqual({ phone: "+14075551234" });
    expect(handoffNumber({ choice: "other", callerPhone: "+14075551234", digits: "321-555-9876" }, norm)).toEqual({ phone: "+13215559876" });
  });
  it("asks again when there's no caller ID, a bad number or a toll-free one", () => {
    expect(handoffNumber({ choice: "same", callerPhone: null }, norm)).toEqual({ problem: "no_caller_id" });
    expect(handoffNumber({ choice: "same", callerPhone: "anonymous" }, norm)).toEqual({ problem: "no_caller_id" });
    expect(handoffNumber({ choice: "other", callerPhone: null, digits: "12345" }, norm)).toEqual({ problem: "invalid_number" });
    expect(handoffNumber({ choice: "other", callerPhone: null, digits: "8555526837" }, norm)).toEqual({ problem: "toll_free" });
  });
  it("reads back the last four digits and fills the first text", () => {
    expect(lastFourForVoice("+14075551234")).toBe("1 2 3 4");
    expect(lastFourForVoice(null)).toBeNull();
    expect(handoffFirstText("Hi, it's {brand}. You called {callLine}.", "CoverageOnCall", "(855) 55-COVER")).toBe("Hi, it's CoverageOnCall. You called (855) 55-COVER.");
    expect(handoffProblemSay("opted_out")).toMatch(/opted out/);
  });
});
