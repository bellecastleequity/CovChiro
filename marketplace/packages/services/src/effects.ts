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
