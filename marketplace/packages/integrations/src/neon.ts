import { env, isSandbox } from "@cm/config";

/**
 * Neon (the hosted Postgres) management API, for restore points and point-in-time restore.
 * Needs NEON_API_KEY + NEON_PROJECT_ID (and optionally NEON_BRANCH_ID; default: the project's
 * default branch). Without them the backups page shows how to restore from the Neon console.
 *  - restore point = a branch copied from production at that moment (no compute, costs nothing
 *    until used);
 *  - restore = Neon's branch restore: production is rewound to a time (or to a restore point)
 *    and its current state is kept as a branch named `preserveAs`, so a restore can be undone.
 */
export interface NeonBranch {
  id: string;
  name: string;
  createdAt: string;
  parentId: string | null;
  isDefault: boolean;
}

export interface NeonApi {
  name: "neon" | "fake";
  /** Restore window in hours (how far back point-in-time restore can go). */
  project(): Promise<{ id: string; name: string; historyHours: number }>;
  branches(): Promise<NeonBranch[]>;
  productionBranchId(): Promise<string>;
  createBranch(name: string): Promise<NeonBranch>;
  deleteBranch(id: string): Promise<void>;
  /** Rewind production to a timestamp (sourceBranchId = production) or to another branch's current state. */
  restore(input: { sourceBranchId: string; at?: Date | null; preserveAs: string }): Promise<void>;
}

class NeonHttp implements NeonApi {
  name = "neon" as const;
  private base = "https://console.neon.tech/api/v2";
  constructor(private key: string, private projectId: string, private branchId?: string) {}
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { message?: string }).message ?? msg;
      } catch {
        /* keep text */
      }
      throw new Error(`Neon said (${r.status}): ${msg}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
  async project() {
    const j = await this.call<{ project: { id: string; name: string; history_retention_seconds?: number } }>("GET", `/projects/${this.projectId}`);
    return { id: j.project.id, name: j.project.name, historyHours: Math.round((j.project.history_retention_seconds ?? 0) / 3600) };
  }
  async branches() {
    const j = await this.call<{ branches: { id: string; name: string; created_at: string; parent_id?: string; default?: boolean; primary?: boolean }[] }>("GET", `/projects/${this.projectId}/branches`);
    return j.branches.map((b) => ({ id: b.id, name: b.name, createdAt: b.created_at, parentId: b.parent_id ?? null, isDefault: !!(b.default ?? b.primary) }));
  }
  async productionBranchId() {
    if (this.branchId) return this.branchId;
    const def = (await this.branches()).find((b) => b.isDefault);
    if (!def) throw new Error("Couldn't find the production branch; set NEON_BRANCH_ID.");
    return def.id;
  }
  async createBranch(name: string) {
    const parent = await this.productionBranchId();
    const j = await this.call<{ branch: { id: string; name: string; created_at: string; parent_id?: string } }>("POST", `/projects/${this.projectId}/branches`, { branch: { name, parent_id: parent } });
    return { id: j.branch.id, name: j.branch.name, createdAt: j.branch.created_at, parentId: j.branch.parent_id ?? null, isDefault: false };
  }
  async deleteBranch(id: string) {
    await this.call("DELETE", `/projects/${this.projectId}/branches/${id}`);
  }
  async restore(input: { sourceBranchId: string; at?: Date | null; preserveAs: string }) {
    const target = await this.productionBranchId();
    await this.call("POST", `/projects/${this.projectId}/branches/${target}/restore`, {
      source_branch_id: input.sourceBranchId,
      ...(input.at ? { source_timestamp: input.at.toISOString() } : {}),
      preserve_under_name: input.preserveAs,
    });
  }
}

/** In-memory Neon for tests. */
export class FakeNeon implements NeonApi {
  name = "fake" as const;
  list: NeonBranch[] = [{ id: "br-main", name: "main", createdAt: new Date(0).toISOString(), parentId: null, isDefault: true }];
  restores: { sourceBranchId: string; at: Date | null; preserveAs: string }[] = [];
  historyHours = 168;
  private seq = 0;
  async project() {
    return { id: "fake", name: "fake", historyHours: this.historyHours };
  }
  async branches() {
    return [...this.list];
  }
  async productionBranchId() {
    return "br-main";
  }
  async createBranch(name: string) {
    const b = { id: `br-${++this.seq}`, name, createdAt: new Date().toISOString(), parentId: "br-main", isDefault: false };
    this.list.push(b);
    return b;
  }
  async deleteBranch(id: string) {
    this.list = this.list.filter((b) => b.id !== id);
  }
  async restore(input: { sourceBranchId: string; at?: Date | null; preserveAs: string }) {
    this.restores.push({ sourceBranchId: input.sourceBranchId, at: input.at ?? null, preserveAs: input.preserveAs });
    this.list.push({ id: `br-${++this.seq}`, name: input.preserveAs, createdAt: new Date().toISOString(), parentId: "br-main", isDefault: false });
  }
}

let override: NeonApi | null | undefined;
/** Tests: install a Neon API (null = "not configured"; undefined restores the default). */
export function setNeonApi(n: NeonApi | null | undefined) {
  override = n;
}
export function neonApi(): NeonApi | null {
  if (override !== undefined) return override;
  const e = env();
  // The test site never gets restore controls: copied keys would point at production's database.
  if (isSandbox(e)) return null;
  return e.NEON_API_KEY && e.NEON_PROJECT_ID ? new NeonHttp(e.NEON_API_KEY, e.NEON_PROJECT_ID, e.NEON_BRANCH_ID || undefined) : null;
}
