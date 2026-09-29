import { cn } from "@/lib/cn";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-700">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "brand" | "amber" | "red" | "green" }) {
  const toneCls = { default: "text-slate-900", brand: "text-brand-700", amber: "text-amber-700", red: "text-red-700", green: "text-emerald-700" }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", toneCls)}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function Empty({ title, children, action, icon }: { title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-slate-400">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {children ? <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

const alertTones = {
  info: { cls: "border-sky-200 bg-sky-50 text-sky-900", Icon: Info },
  success: { cls: "border-emerald-200 bg-emerald-50 text-emerald-900", Icon: CheckCircle2 },
  warning: { cls: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle },
  error: { cls: "border-red-200 bg-red-50 text-red-900", Icon: XCircle },
};

export function Alert({ tone = "info", title, children, className }: { tone?: keyof typeof alertTones; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const { cls, Icon } = alertTones[tone];
  return (
    <div className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", cls, className)} role={tone === "error" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? <div className={cn(title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[560px] text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("border-b border-slate-200 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500", className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-slate-100 px-4 py-3 align-top text-slate-700", className)}>
      {children}
    </td>
  );
}

export function Checklist({ items }: { items: { label: string; done: boolean; href?: string; hint?: string }[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-3 py-2.5">
          {i.done ? <CheckCircle2 className="size-5 text-emerald-600" /> : <span className="size-5 rounded-full border-2 border-slate-300" />}
          <div className="min-w-0 flex-1">
            <div className={cn("text-sm", i.done ? "text-slate-500 line-through" : "font-medium text-slate-900")}>{i.label}</div>
            {i.hint && !i.done ? <div className="text-xs text-slate-500">{i.hint}</div> : null}
          </div>
          {!i.done && i.href ? (
            <a href={i.href} className="text-sm font-medium text-brand-700 hover:underline">
              Start
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
