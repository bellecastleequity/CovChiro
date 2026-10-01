import { env } from "@cm/config";

/**
 * Structured-JSON text generation for the growth agents (classification,
 * personalization, summaries, knowledge-base answers). Same providers and
 * raw-fetch style as moderation.ts: Anthropic (ANTHROPIC_API_KEY) or Gemini
 * (GEMINI_API_KEY). With no key, or under test, the "none" provider answers
 * { ok: false } and every caller falls back to approved templates or a
 * human escalation, so the platform works without any AI at all.
 */
export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  /** JSON Schema the reply must match (object at the top level). */
  schema: Record<string, unknown>;
  maxTokens: number;
  /** Anthropic effort for models that support it (ignored for Haiku and Gemini). */
  effort?: "low" | "medium" | "high";
}

export type LlmResult =
  | { ok: true; data: Record<string, unknown>; model: string; inputTokens: number; outputTokens: number }
  | { ok: false; error: string; model: string; inputTokens: number; outputTokens: number };

export interface LlmProvider {
  name: "anthropic" | "gemini" | "none";
  generate(req: LlmRequest): Promise<LlmResult>;
}

const TIMEOUT_MS = 60_000;

function parseObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  for (const candidate of [text, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

const anthropic = (key: string): LlmProvider => ({
  name: "anthropic",
  async generate(req) {
    const fail = (error: string, i = 0, o = 0): LlmResult => ({ ok: false, error, model: req.model, inputTokens: i, outputTokens: o });
    try {
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { format: { type: "json_schema", schema: req.schema }, ...(req.effort && !req.model.includes("haiku") ? { effort: req.effort } : {}) },
      };
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const j = (await r.json().catch(() => ({}))) as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { message?: string };
      };
      const i = j.usage?.input_tokens ?? 0, o = j.usage?.output_tokens ?? 0;
      if (!r.ok) return fail(`HTTP ${r.status}: ${j.error?.message ?? ""}`.slice(0, 240), i, o);
      if (j.stop_reason === "refusal" || j.stop_reason === "max_tokens") return fail(`stop_reason ${j.stop_reason}`, i, o);
      const data = parseObject(j.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "");
      return data ? { ok: true, data, model: req.model, inputTokens: i, outputTokens: o } : fail("unparseable output", i, o);
    } catch (e) {
      return fail((e as Error).message.slice(0, 240));
    }
  },
});

const gemini = (key: string): LlmProvider => ({
  name: "gemini",
  async generate(req) {
    const model = req.model.startsWith("gemini") ? req.model : "gemini-2.5-flash";
    const fail = (error: string, i = 0, o = 0): LlmResult => ({ ok: false, error, model, inputTokens: i, outputTokens: o });
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: `${req.user}\n\nReply with JSON matching this schema:\n${JSON.stringify(req.schema)}` }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: req.maxTokens },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const j = (await r.json().catch(() => ({}))) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const i = j.usageMetadata?.promptTokenCount ?? 0, o = j.usageMetadata?.candidatesTokenCount ?? 0;
      if (!r.ok) return fail(`HTTP ${r.status}`, i, o);
      const data = parseObject(j.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "");
      return data ? { ok: true, data, model, inputTokens: i, outputTokens: o } : fail("unparseable output", i, o);
    } catch (e) {
      return fail((e as Error).message.slice(0, 240));
    }
  },
});

const none: LlmProvider = { name: "none", generate: async (req) => ({ ok: false, error: "ai_unavailable", model: req.model, inputTokens: 0, outputTokens: 0 }) };

let override: LlmProvider | null = null;
/** Tests: install a fake model (null restores the default). */
export function setLlmProvider(p: LlmProvider | null) {
  override = p;
}

/** `preferred` comes from the growth.aiProvider setting; a provider without a key is never used. */
export function llmProvider(preferred: "anthropic" | "gemini" | "none"): LlmProvider {
  if (override) return override;
  const e = env();
  if (e.NODE_ENV === "test" || preferred === "none") return none;
  if (preferred === "anthropic" && e.ANTHROPIC_API_KEY) return anthropic(e.ANTHROPIC_API_KEY);
  if (preferred === "gemini" && e.GEMINI_API_KEY) return gemini(e.GEMINI_API_KEY);
  return none;
}
