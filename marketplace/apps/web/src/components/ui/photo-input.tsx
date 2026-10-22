"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/form";
import { PHOTO_MAX, resizeImage, THUMB_MAX } from "@/lib/resize-image";

/**
 * A photo file input that shrinks the picture in the browser before the form sends it, and adds a
 * small thumbnail as `<name>Thumb`. If shrinking fails (an old browser), the original is sent as before.
 */
export function PhotoInput({ name, keepPng = false, ...props }: { name: string; keepPng?: boolean } & Omit<React.ComponentProps<"input">, "type" | "name">) {
  const thumb = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file || !file.type.startsWith("image/") || input.dataset.shrunk === file.name) return;
    try {
      setNote("Getting your photo ready…");
      const [main, small] = await Promise.all([resizeImage(file, PHOTO_MAX, keepPng), resizeImage(file, THUMB_MAX, keepPng)]);
      const ext = main.type === "image/png" ? "png" : "jpg";
      const put = (el: HTMLInputElement, blob: Blob, n: string) => {
        const dt = new DataTransfer();
        dt.items.add(new File([blob], n, { type: blob.type }));
        el.files = dt.files;
      };
      const shrunkName = `photo.${ext}`;
      if (main.size < file.size) put(input, main, shrunkName);
      input.dataset.shrunk = input.files?.[0]?.name ?? shrunkName;
      if (thumb.current) put(thumb.current, small, `thumb.${ext}`);
      setNote(null);
    } catch {
      setNote(null);
    }
  }
  return (
    <>
      <Input type="file" name={name} onChange={onChange} {...props} />
      <input ref={thumb} type="file" name={`${name}Thumb`} className="hidden" tabIndex={-1} aria-hidden />
      {note ? <p className="mt-1 text-xs text-slate-500">{note}</p> : null}
    </>
  );
}
