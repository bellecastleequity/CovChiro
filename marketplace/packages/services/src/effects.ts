/**
 * Side effects (email, SMS, Stripe calls) must run after the database
 * transaction commits, never inside it. Services collect them here and the
 * caller runs them once the transaction has succeeded.
 */
export type Effect = () => Promise<unknown>;

export class Effects {
  private list: Effect[] = [];
  add(fn: Effect) {
    this.list.push(fn);
  }
  /** Snapshot/rollback so a failed award attempt (savepoint) doesn't leave stray notifications. */
  mark() {
    return this.list.length;
  }
  rollback(to: number) {
    this.list.length = to;
  }
  async run() {
    for (const fn of this.list) {
      try {
        await fn();
      } catch (e) {
        console.error("post-commit effect failed", e);
      }
    }
    this.list = [];
  }
}
