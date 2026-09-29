import Link from "next/link";
import { brand } from "@cm/config";
import { Logo } from "@/components/site/header";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const b = brand();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
      <Link href="/" className="mb-8">
        <Logo name={b.name} />
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">{children}</div>
    </div>
  );
}
