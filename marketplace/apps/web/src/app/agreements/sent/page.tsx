import Link from "next/link";

export default function Sent() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p className="mt-3 text-slate-600">We've sent the agreement to your inbox for electronic signature. Once you sign, your account updates automatically.</p>
      <Link href="/" className="mt-6 inline-block font-medium text-brand-700">Back to dashboard</Link>
    </div>
  );
}
