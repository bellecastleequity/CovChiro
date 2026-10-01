"use client";

import { useEffect } from "react";

/** Remember the invitation for 90 days, so signing up later (or via another page) still links it. */
export function RememberRef({ code }: { code: string }) {
  useEffect(() => {
    document.cookie = `cm_ref=${encodeURIComponent(code)}; Max-Age=${90 * 86_400}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }, [code]);
  return null;
}
