/** Refuse to boot in production without the keys that move money or send mail. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionEnv } = await import("@cm/config");
    assertProductionEnv();
  }
}
