"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PHOTO_MAX, resizeImage, THUMB_MAX } from "@/lib/resize-image";

/** One-time tool: shrinks headshots and logos uploaded before photos were shrunk in the browser. */
export function ShrinkPhotos() {
  const [state, setState] = useState<{ running: boolean; done: number; total: number; saved: number; failed: number; msg: string | null }>({ running: false, done: 0, total: 0, saved: 0, failed: 0, msg: null });
  async function run() {
    setState({ running: true, done: 0, total: 0, saved: 0, failed: 0, msg: "Checking photos…" });
    const r = await fetch("/api/admin/photos").then((x) => x.json()).catch(() => null);
    if (!r) return setState((s) => ({ ...s, running: false, msg: "Couldn't load the photo list." }));
    const keys: string[] = r.missing;
    if (!keys.length) return setState((s) => ({ ...s, running: false, msg: `All ${r.total} photos are already small.` }));
    let done = 0, saved = 0, failed = 0;
    setState((s) => ({ ...s, total: keys.length, msg: null }));
    for (const key of keys) {
      try {
        const blob = await fetch(`/api/files/${key}`).then((x) => (x.ok ? x.blob() : Promise.reject()));
        const keepPng = key.startsWith("photos/clinic-logos/");
        const [photo, thumb] = await Promise.all([resizeImage(blob, PHOTO_MAX, keepPng), resizeImage(blob, THUMB_MAX, keepPng)]);
        const fd = new FormData();
        fd.set("key", key);
        fd.set("photo", new File([photo], "photo", { type: photo.type }));
        fd.set("thumb", new File([thumb], "thumb", { type: thumb.type }));
        const res = await fetch("/api/admin/photos", { method: "POST", body: fd }).then((x) => x.json());
        if (res.ok) saved += Math.max(0, res.before - res.after); else failed++;
      } catch {
        failed++;
      }
      done++;
      setState({ running: true, done, total: keys.length, saved, failed, msg: null });
    }
    setState({ running: false, done, total: keys.length, saved, failed, msg: `Done: ${done - failed} of ${keys.length} photos shrunk (${(saved / 1048576).toFixed(1)} MB smaller)${failed ? `, ${failed} couldn't be read` : ""}.` });
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={state.running}>{state.running ? `Shrinking ${state.done} of ${state.total}…` : "Shrink photos"}</Button>
      <span className="text-slate-500">{state.msg ?? (state.running ? "Keep this page open until it finishes." : "Makes headshots and clinic logos load fast. Run once; new uploads are shrunk automatically.")}</span>
    </div>
  );
}
