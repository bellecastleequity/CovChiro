"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "./button";

export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("outline", "sm", "print:hidden")}>
      <Printer className="size-4" /> {label}
    </button>
  );
}
