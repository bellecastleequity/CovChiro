import { cn } from "@/lib/cn";

const control = "block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(control, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "h-10 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-slate-700", className)} {...props} />;
}

export function Field({ label, hint, children, className, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2.5 text-sm text-slate-700", className)}>
      <input type="checkbox" className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function PhiNotice() {
  return <p className="mt-1 text-xs font-medium text-amber-700">Do not include patient information.</p>;
}
