import { describe, expect, it } from "vitest";
import { callTurn, forVoice, isGoodbye, isUrgentCall, wantsPerson } from "../src/callagent";

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
