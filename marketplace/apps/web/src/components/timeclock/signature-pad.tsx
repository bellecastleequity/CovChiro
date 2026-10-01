"use client";

import { useEffect, useRef, useState } from "react";

/** Draw-with-finger signature box. Puts a PNG data URL in a hidden "signature" field. */
export function SignaturePad({ name = "signature", required }: { name?: string; required?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [value, setValue] = useState("");
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvas.current!.getContext("2d")!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current) setValue(canvas.current!.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    setValue("");
  };

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvas}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="h-36 w-full touch-none rounded-xl border border-dashed border-slate-300 bg-white"
          aria-label="Sign here"
        />
        {!value ? <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-slate-400">Sign here with your finger or mouse</span> : null}
      </div>
      <div className="mt-1 flex justify-end">
        <button type="button" onClick={clear} className="text-xs text-slate-500 hover:text-slate-800">Clear</button>
      </div>
      {/* A text input (not hidden) so the browser's "required" check works; visually hidden. */}
      <input name={name} value={value} onChange={() => undefined} required={required} className="sr-only" tabIndex={-1} aria-hidden />
    </div>
  );
}
