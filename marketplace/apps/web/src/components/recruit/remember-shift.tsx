"use client";

import { useEffect } from "react";

/** Remember the shift link for 30 days so signing up later still claims it. */
export function RememberShift({ token }: { token: string }) {
  useEffect(() => {
    document.cookie = `cm_shift=${encodeURIComponent(token)}; Max-Age=${30 * 86_400}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }, [token]);
  return null;
}
