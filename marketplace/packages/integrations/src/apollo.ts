import { env } from "@cm/config";

/**
 * Apollo.io API client (Growth prospecting source; docs: https://docs.apollo.io/). Server-side only:
 * the key (APOLLO_API_KEY, a master key for people search) is sent in the x-api-key header and never
 * reaches a browser. Endpoints used:
 *   POST /mixed_people/api_search   people search (no credits; no emails; surnames hidden)
 *   POST /mixed_companies/search    organization search (uses credits)
 *   POST /people/bulk_match         people enrichment, up to 10 per call (uses credits; email + email_status)
 *   GET  /organizations/enrich      organization enrichment by domain (uses credits)
 *   GET  /auth/health               connection test
 * Without a key the provider is "none" (nothing is called); tests install a fake with setApolloProvider.
 */
export type ApolloRaw = Record<string, unknown>;

export interface ApolloPage<T> { items: T[]; total: number | null; page: number; perPage: number }

export interface ApolloProvider {
  name: string;
  health(): Promise<{ ok: boolean; detail: string }>;
  searchPeople(body: Record<string, unknown>): Promise<ApolloPage<ApolloRaw>>;
  searchOrganizations(body: Record<string, unknown>): Promise<ApolloPage<ApolloRaw>>;
  /** Up to 10 people: by Apollo id, or first/last name + organization name/domain. */
  enrichPeople(details: Record<string, unknown>[]): Promise<ApolloRaw[]>;
  enrichOrganization(domain: string): Promise<ApolloRaw | null>;
}

export type ApolloErrorKind = "auth" | "forbidden" | "rate_limit" | "bad_request" | "unavailable" | "not_configured";

/** A refused or failed Apollo call. kind decides what Growth does (pause on auth/rate limits, skip on bad requests). */
export class ApolloError extends Error {
  constructor(public kind: ApolloErrorKind, message: string, public status: number | null = null, public retryAfterSeconds: number | null = null) {
    super(message);
  }
}

function errorFor(status: number, body: string, retryAfter: string | null): ApolloError {
  const msg = (() => {
    try {
      const j = JSON.parse(body) as { error?: string; message?: string; error_message?: string };
      return j.error ?? j.message ?? j.error_message ?? body;
    } catch {
      return body;
    }
  })().slice(0, 240);
  if (status === 401) return new ApolloError("auth", `Apollo refused the API key (401): ${msg}`, status);
  if (status === 403) return new ApolloError("forbidden", `Apollo says this key or plan can't use that endpoint (403): ${msg}`, status);
  if (status === 429) return new ApolloError("rate_limit", `Apollo rate limit reached (429): ${msg}`, status, retryAfter ? Number(retryAfter) || null : null);
  if (status === 400 || status === 422) return new ApolloError("bad_request", `Apollo rejected the request (${status}): ${msg}`, status);
  return new ApolloError("unavailable", `Apollo error ${status}: ${msg}`, status);
}

function real(key: string, base: string): ApolloProvider {
  const call = async (method: "GET" | "POST", path: string, body?: unknown): Promise<ApolloRaw> => {
    let r: Response;
    try {
      r = await fetch(`${base.replace(/\/$/, "")}${path}`, {
        method,
        headers: { "x-api-key": key, "content-type": "application/json", accept: "application/json", "cache-control": "no-cache" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new ApolloError("unavailable", `Apollo unreachable: ${(e as Error).message}`);
    }
    const text = await r.text();
    if (!r.ok) throw errorFor(r.status, text, r.headers.get("retry-after"));
    try {
      return JSON.parse(text) as ApolloRaw;
    } catch {
      throw new ApolloError("unavailable", "Apollo returned something that isn't JSON.", r.status);
    }
  };
  const page = (j: ApolloRaw, key: string, body: Record<string, unknown>): ApolloPage<ApolloRaw> => {
    const pg = (j.pagination ?? {}) as ApolloRaw;
    const items = [key, ...(key === "organizations" ? ["accounts"] : [])].flatMap((k) => (Array.isArray(j[k]) ? (j[k] as ApolloRaw[]) : []));
    const total = typeof j.total_entries === "number" ? j.total_entries : typeof pg.total_entries === "number" ? (pg.total_entries as number) : null;
    return { items, total, page: Number(pg.page ?? body.page ?? 1), perPage: Number(pg.per_page ?? body.per_page ?? items.length) };
  };
  return {
    name: "apollo",
    async health() {
      const j = await call("GET", "/auth/health");
      const loggedIn = j.is_logged_in !== false && j.healthy !== false;
      return { ok: loggedIn, detail: loggedIn ? "Apollo accepted the API key." : `Apollo answered but the key isn't signed in (${JSON.stringify(j).slice(0, 120)}).` };
    },
    async searchPeople(body) {
      return page(await call("POST", "/mixed_people/api_search", body), "people", body);
    },
    async searchOrganizations(body) {
      return page(await call("POST", "/mixed_companies/search", body), "organizations", body);
    },
    async enrichPeople(details) {
      if (!details.length) return [];
      const j = await call("POST", "/people/bulk_match", { details: details.slice(0, 10), reveal_personal_emails: false, reveal_phone_number: false });
      return Array.isArray(j.matches) ? (j.matches as ApolloRaw[]).filter(Boolean) : [];
    },
    async enrichOrganization(domain) {
      const j = await call("GET", `/organizations/enrich?domain=${encodeURIComponent(domain)}`);
      return (j.organization as ApolloRaw | undefined) ?? null;
    },
  };
}

const none: ApolloProvider = {
  name: "none",
  health: async () => ({ ok: false, detail: "APOLLO_API_KEY isn't set on the server." }),
  searchPeople: async () => { throw new ApolloError("not_configured", "APOLLO_API_KEY isn't set on the server."); },
  searchOrganizations: async () => { throw new ApolloError("not_configured", "APOLLO_API_KEY isn't set on the server."); },
  enrichPeople: async () => { throw new ApolloError("not_configured", "APOLLO_API_KEY isn't set on the server."); },
  enrichOrganization: async () => { throw new ApolloError("not_configured", "APOLLO_API_KEY isn't set on the server."); },
};

let override: ApolloProvider | null = null;
/** Tests: install a fake Apollo (null restores the default). */
export function setApolloProvider(p: ApolloProvider | null) {
  override = p;
}

export function apolloProvider(): ApolloProvider {
  if (override) return override;
  const e = env();
  if (e.NODE_ENV === "test" || !e.APOLLO_API_KEY) return none;
  return real(e.APOLLO_API_KEY, e.APOLLO_API_BASE);
}
