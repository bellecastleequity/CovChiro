import { env } from "@cm/config";

/**
 * Optional AI second opinion on messages between clinics and providers
 * (non-circumvention). The rule-based screen in @cm/core runs first and
 * always; this only catches what rules miss (hints, workarounds, "let's talk
 * about working together outside of here"). No key = rules only. Any error
 * or timeout fails open: we never block a message because the AI is down.
 */
export type ModerationVerdict = { decision: "allow" | "review" | "block"; reason: string };

export interface ModerationProvider {
  name: "anthropic" | "gemini" | "none";
  review(text: string, ctx: { senderType: "CLINIC" | "PROVIDER"; brand: string }): Promise<ModerationVerdict>;
}

const ALLOW: ModerationVerdict = { decision: "allow", reason: "" };

function prompt(brand: string, senderType: string) {
  return `You screen messages between healthcare clinics and independent providers on ${brand}, a marketplace for shift coverage.
Policy (non-circumvention): users may not share or ask for contact details (phone numbers in any form, emails, social media, messaging apps, websites), and may not arrange work, hiring or payment outside ${brand} (booking directly, paying cash, "skipping the fees", offering a job or full/part-time position, meeting up to discuss working together elsewhere). Ongoing work between a clinic and provider is allowed only as a standing booking through ${brand}.
Normal logistics are fine: times, parking, directions inside the building, what to bring, clinical workflow, thanks, running late.
The sender is a ${senderType.toLowerCase()}. Reply with JSON only: {"decision":"allow"|"review"|"block","reason":"<one short sentence>"}.
Use "block" only when the message clearly shares/asks for contact info or clearly arranges off-platform work. Use "review" for hints or ambiguity. Otherwise "allow".`;
}

function parse(raw: string): ModerationVerdict {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return ALLOW;
  try {
    const j = JSON.parse(m[0]) as { decision?: string; reason?: string };
    const decision = j.decision === "block" || j.decision === "review" ? j.decision : "allow";
    return { decision, reason: String(j.reason ?? "").slice(0, 300) };
  } catch {
    return ALLOW;
  }
}

const anthropic = (key: string): ModerationProvider => ({
  name: "anthropic",
  async review(text, ctx) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: env().MODERATION_MODEL || "claude-haiku-4-5", max_tokens: 120, system: prompt(ctx.brand, ctx.senderType), messages: [{ role: "user", content: `Message:\n"""${text}"""` }] }),
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) return ALLOW;
      const j = (await r.json()) as { content?: { type: string; text?: string }[] };
      return parse(j.content?.find((c) => c.type === "text")?.text ?? "");
    } catch {
      return ALLOW;
    }
  },
});

const gemini = (key: string): ModerationProvider => ({
  name: "gemini",
  async review(text, ctx) {
    try {
      const model = env().MODERATION_MODEL || "gemini-2.5-flash";
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt(ctx.brand, ctx.senderType) }] },
          contents: [{ role: "user", parts: [{ text: `Message:\n"""${text}"""` }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 120, temperature: 0 },
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) return ALLOW;
      const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return parse(j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "");
    } catch {
      return ALLOW;
    }
  },
});

const none: ModerationProvider = { name: "none", review: async () => ALLOW };

let override: ModerationProvider | null = null;
/** Tests: install a fake moderator (null restores the default). */
export function setModerationProvider(p: ModerationProvider | null) {
  override = p;
}

export function moderationProvider(): ModerationProvider {
  if (override) return override;
  const e = env();
  if (e.NODE_ENV === "test") return none;
  if (e.ANTHROPIC_API_KEY) return anthropic(e.ANTHROPIC_API_KEY);
  if (e.GEMINI_API_KEY) return gemini(e.GEMINI_API_KEY);
  return none;
}
