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

/** Web research: the model searches and reads public pages, then answers with one JSON object. */
export interface ResearchRequest {
  model: string;
  system: string;
  user: string;
  /** Shape of the JSON answer (described to the model; validated by the caller). */
  schema: Record<string, unknown>;
  maxTokens: number;
  maxSearches: number;
  maxFetches: number;
  effort?: "low" | "medium" | "high";
}

export type ResearchResult = (
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }
) & { model: string; inputTokens: number; outputTokens: number; searches: number; fetches: number };

export interface LlmProvider {
  name: "anthropic" | "gemini" | "none";
  generate(req: LlmRequest): Promise<LlmResult>;
  /** Absent = this provider can't research (callers treat it as AI unavailable). */
  research?(req: ResearchRequest): Promise<ResearchResult>;
}

const TIMEOUT_MS = 60_000;
const RESEARCH_TIMEOUT_MS = 180_000;

const researchPrompt = (req: ResearchRequest) =>
  `${req.user}\n\nWhen you are done, reply with only one JSON object (no prose, no code fence) matching this JSON Schema:\n${JSON.stringify(req.schema)}`;

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

type AnthropicBlock = { type: string; text?: string };
type AnthropicReply = {
  content?: AnthropicBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } };
  error?: { message?: string };
};

async function anthropicResearch(key: string, req: ResearchRequest): Promise<ResearchResult> {
  const haiku = req.model.includes("haiku");
  const tools = [
    { type: haiku ? "web_search_20250305" : "web_search_20260209", name: "web_search", max_uses: req.maxSearches, user_location: { type: "approximate", country: "US" } },
    { type: haiku ? "web_fetch_20250910" : "web_fetch_20260209", name: "web_fetch", max_uses: req.maxFetches, max_content_tokens: 20_000 },
  ];
  const tally = { model: req.model, inputTokens: 0, outputTokens: 0, searches: 0, fetches: 0 };
  const fail = (error: string): ResearchResult => ({ ok: false, error: error.slice(0, 240), ...tally });
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: researchPrompt(req) }];
  try {
    // Server tools run on Anthropic's side; a long turn comes back as pause_turn and is resumed as-is.
    for (let round = 0; round < 5; round++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "web-fetch-2025-09-10" },
        body: JSON.stringify({
          model: req.model, max_tokens: req.maxTokens, system: req.system, messages, tools,
          ...(req.effort && !haiku ? { output_config: { effort: req.effort } } : {}),
        }),
        signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
      });
      const j = (await r.json().catch(() => ({}))) as AnthropicReply;
      tally.inputTokens += (j.usage?.input_tokens ?? 0) + (j.usage?.cache_read_input_tokens ?? 0);
      tally.outputTokens += j.usage?.output_tokens ?? 0;
      tally.searches += j.usage?.server_tool_use?.web_search_requests ?? 0;
      tally.fetches += j.usage?.server_tool_use?.web_fetch_requests ?? 0;
      if (!r.ok) return fail(`HTTP ${r.status}: ${j.error?.message ?? ""}`);
      if (j.stop_reason === "pause_turn") {
        messages.splice(1, messages.length - 1, { role: "assistant", content: j.content ?? [] });
        continue;
      }
      if (j.stop_reason === "refusal" || j.stop_reason === "max_tokens") return fail(`stop_reason ${j.stop_reason}`);
      // The answer is the text after the last tool use.
      const blocks = j.content ?? [];
      const types = blocks.map((b) => b.type);
      const lastTool = Math.max(types.lastIndexOf("web_search_tool_result"), types.lastIndexOf("web_fetch_tool_result"));
      const text = blocks.slice(lastTool + 1).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      const data = parseObject(text) ?? parseObject(blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join(""));
      return data ? { ok: true, data, ...tally } : fail("unparseable output");
    }
    return fail("research did not finish");
  } catch (e) {
    return fail((e as Error).message);
  }
}

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
  /** Google Search grounding (reads search results; it cannot open pages the way web_fetch does). */
  async research(req) {
    const model = req.model.startsWith("gemini") ? req.model : "gemini-2.5-flash";
    const tally = { model, inputTokens: 0, outputTokens: 0, searches: 0, fetches: 0 };
    const fail = (error: string): ResearchResult => ({ ok: false, error: error.slice(0, 240), ...tally });
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: researchPrompt(req) }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: req.maxTokens },
        }),
        signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
      });
      const j = (await r.json().catch(() => ({}))) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; groundingMetadata?: { webSearchQueries?: string[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      tally.inputTokens = j.usageMetadata?.promptTokenCount ?? 0;
      tally.outputTokens = j.usageMetadata?.candidatesTokenCount ?? 0;
      tally.searches = j.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0;
      if (!r.ok) return fail(`HTTP ${r.status}`);
      const data = parseObject(j.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "");
      return data ? { ok: true, data, ...tally } : fail("unparseable output");
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

const none: LlmProvider = {
  name: "none",
  generate: async (req) => ({ ok: false, error: "ai_unavailable", model: req.model, inputTokens: 0, outputTokens: 0 }),
  research: async (req) => ({ ok: false, error: "ai_unavailable", model: req.model, inputTokens: 0, outputTokens: 0, searches: 0, fetches: 0 }),
};

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
