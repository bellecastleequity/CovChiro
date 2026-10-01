// Minimal types for the `pg` driver (only what backup-restore.ts uses; avoids adding @types/pg).
declare module "pg" {
  export class Client {
    constructor(config: { connectionString: string });
    connect(): Promise<void>;
    query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
    end(): Promise<void>;
  }
  const pg: { Client: typeof Client };
  export default pg;
}
