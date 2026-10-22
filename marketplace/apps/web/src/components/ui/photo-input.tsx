"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/form";
import { DOC_MAX, PHOTO_MAX, resizeImage, THUMB_MAX } from "@/lib/resize-image";

type Props = { name: string; keepPng?: boolean; className?: string } & Omit<React.ComponentProps<"input">, "type" | "name" | "className" | "max">;

/**
 * File input that shrinks pictures in the browser before the form sends them (PDFs and anything that
 * isn't an image go as they are). If shrinking fails (an old browser), the originals are sent as before.
 * - kind "photo": headshots, logos, location photos: longest side 1024 / 1600 px plus a 256 px
 *   thumbnail per picture in `<name>Thumb` (same order).
 * - kind "document": photos of licenses, certificates, receipts: longest side 2000 px so the text stays
 *   readable; no thumbnail.
 */
export function ShrinkFileInput({ name, kind, maxPx, keepPng = false, plain = false, className, ...props }: Props & { kind: "photo" | "document"; maxPx?: number; plain?: boolean }) {
  const thumb = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const limit = maxPx ?? (kind === "document" ? DOC_MAX : PHOTO_MAX);
  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = [...(input.files ?? [])];
    if (!files.length || input.dataset.shrunk === files.map((f) => f.name).join("|")) return;
    if (!files.some((f) => f.type.startsWith("image/"))) return;
    try {
      setNote(files.length > 1 ? `Getting ${files.length} pictures ready…` : "Getting your picture ready…");
      const out: File[] = [], thumbs: File[] = [];
      for (const [i, f] of files.entries()) {
        if (!f.type.startsWith("image/")) { out.push(f); continue; }
        const main = await resizeImage(f, limit, keepPng);
        const ext = main.type === "image/png" ? "png" : "jpg";
        out.push(main.size < f.size ? new File([main], `picture-${i + 1}.${ext}`, { type: main.type }) : f);
        if (kind === "photo") {
          const small = await resizeImage(f, THUMB_MAX, keepPng);
          thumbs.push(new File([small], `thumb-${i + 1}.${ext}`, { type: small.type }));
        }
      }
      const set = (el: HTMLInputElement, list: File[]) => { const dt = new DataTransfer(); list.forEach((f) => dt.items.add(f)); el.files = dt.files; };
      set(input, out);
      input.dataset.shrunk = out.map((f) => f.name).join("|");
      if (thumb.current && thumbs.length === out.length) set(thumb.current, thumbs);
      setNote(null);
    } catch {
      setNote(null);
    }
  }
  const field = plain
    ? <input type="file" name={name} onChange={onChange} className={className} {...props} />
    : <Input type="file" name={name} onChange={onChange} className={className} {...props} />;
  return (
    <>
      {field}
      {kind === "photo" ? <input ref={thumb} type="file" name={`${name}Thumb`} multiple className="hidden" tabIndex={-1} aria-hidden /> : null}
      {note ? <p className="mt-1 text-xs text-slate-500">{note}</p> : null}
    </>
  );
}

/** Headshots and logos. */
export function PhotoInput(props: Props) {
  return <ShrinkFileInput kind="photo" {...props} />;
}
