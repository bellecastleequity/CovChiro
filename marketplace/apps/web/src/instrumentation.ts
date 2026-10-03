import type { Instrumentation } from "next";

/** Refuse to boot in production without the keys that move money or send mail. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionEnv } = await import("@cm/config");
    assertProductionEnv();
  }
}

/** Test site only: every server error goes into Admin → Test site → Errors (the live site does nothing here). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SANDBOX_MODE !== "1" && process.env.SANDBOX_MODE !== "true") return;
  try {
    const e = err as Error & { digest?: string };
    const { sandbox } = await import("@cm/services");
    await sandbox.recordError({
      source: "server",
      message: e?.message || String(err),
      detail: [`${request.method} ${request.path}`, `${context.routeType} · ${context.routePath}`, e?.digest ? `digest ${e.digest}` : "", e?.stack ?? ""].filter(Boolean).join("\n"),
      path: request.path,
    });
  } catch {
    /* never let error reporting cause errors */
  }
};
