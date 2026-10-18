/**
 * The phone line's AI agent (owner, Oct 2026): it answers 24/7 from approved knowledge only and never
 * transfers a call. Anything that needs staff (asked for a person, urgent, no approved answer) becomes
 * a callback request: name, best callback number and what they need, like "Need help now?" on the
 * website; staff call back. These are the rules for one turn of a call; the answer text itself comes
 * from the same knowledge as the chat bubble. (Parked Oct 2026: AWS side and site webhook not built.)
 */

export type CallAction = "continue" | "message" | "end";
export type CallOutcome = "IN_PROGRESS" | "ANSWERED" | "MESSAGE";

export interface CallTurnInput {
  /** chat = normal conversation; message = the next thing they say is their callback request. */
  mode: "chat" | "message";
  /** The Lex intent: TalkToPerson, LeaveMessage, Goodbye or FallbackIntent (a question). */
  intent: string;
  text: string;
  turn: number;
  maxTurns: number;
  /** An approved answer for their question (null = none or not confident). */
  answer: string | null;
}

export interface CallTurnResult {
  action: CallAction;
  say: string;
  outcome: CallOutcome;
  urgent?: boolean;
  message?: string;
}

const PERSON = /\b(real person|human|representative|operator|agent|someone|somebody|a person|live person|customer service|support team|manager)\b/i;
const ASKING_FOR = /\b(talk|speak|connect|transfer|put me through|get me|need|want)\b/i;
export function wantsPerson(text: string): boolean {
  return PERSON.test(text) && ASKING_FOR.test(text) && !/\b(add|invite|hire|team member|my team)\b/i.test(text);
}

export function isUrgentCall(text: string): boolean {
  return /\b(no[- ]?show|didn'?t show|did not show|not (here|there) yet|hasn'?t (arrived|shown)|never showed|emergency|urgent|right now|stranded|locked out)\b/i.test(text);
}

export function isGoodbye(text: string): boolean {
  return /\b(bye|goodbye|that'?s (all|it)|nothing else|no thanks|no thank you|i'?m good|all set)\b/i.test(text);
}

/** Answer text that reads well aloud: no links or markup, short. */
export function forVoice(text: string): string {
  const t = text
    .replace(/https?:\/\/\S+/g, "on our website")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/at on our website/g, "on our website")
    .trim();
  if (t.length <= 420) return t;
  const cut = t.slice(0, 420);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (end > 200 ? cut.slice(0, end + 1) : `${cut.slice(0, 400)}…`).trim();
}

const ASK_MESSAGE = "I'll have someone from our team call you back. Please tell me your name, the best number to reach you, and what you need.";

export function callTurn(i: CallTurnInput): CallTurnResult {
  const text = i.text.trim();
  const urgent = isUrgentCall(text);
  if (i.mode === "message") {
    if (text.length < 3) return { action: "message", outcome: "IN_PROGRESS", say: `Sorry, I didn't catch that. ${ASK_MESSAGE}` };
    return { action: "end", outcome: "MESSAGE", message: text.slice(0, 2000), say: "Thank you. I've passed that to our team, and someone will call you back. Goodbye!", ...(urgent ? { urgent } : {}) };
  }
  const toPerson = (why: string): CallTurnResult => ({ action: "message", outcome: "IN_PROGRESS", say: `${why}${ASK_MESSAGE}`, ...(urgent ? { urgent } : {}) });
  if (i.intent === "Goodbye" || (isGoodbye(text) && text.length < 40)) return { action: "end", outcome: "ANSWERED", say: "Thanks for calling. Goodbye!" };
  if (i.intent === "LeaveMessage") return { action: "message", outcome: "IN_PROGRESS", say: ASK_MESSAGE };
  if (urgent) return toPerson("I'm sorry about that. ");
  if (i.intent === "TalkToPerson" || wantsPerson(text)) return toPerson("");
  if (i.turn >= i.maxTurns) return { action: "message", outcome: "IN_PROGRESS", say: `I want to make sure you get the right help. ${ASK_MESSAGE}` };
  if (i.answer) return { action: "continue", outcome: "ANSWERED", say: `${forVoice(i.answer)} Is there anything else I can help with?` };
  return toPerson("That's one for our team. ");
}
