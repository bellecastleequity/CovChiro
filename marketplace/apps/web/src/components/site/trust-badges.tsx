/**
 * Self-made trust seals for the public footer. Every claim here is literally true of the platform
 * (keep it that way: no invented awards, rankings or certifications).
 */

type Seal = { key: string; title: string; sub: string; icon: React.ReactNode };

const ink = "currentColor";

const ICONS = {
  lock: (
    <g fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="-8" y="-2" width="16" height="12" rx="2.5" />
      <path d="M-5 -2v-4a5 5 0 0 1 10 0v4" />
      <circle cx="0" cy="4" r="1.6" fill={ink} stroke="none" />
    </g>
  ),
  card: (
    <g fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="-10" y="-7" width="20" height="14" rx="2.5" />
      <path d="M-10 -2h20M-6 3h5" />
    </g>
  ),
  license: (
    <g fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0 -10l2.6 2.2 3.4-.4 1 3.3 3 1.7-1.3 3.2 1.3 3.2-3 1.7-1 3.3-3.4-.4L0 10l-2.6-2.2-3.4.4-1-3.3-3-1.7 1.3-3.2-1.3-3.2 3-1.7 1-3.3 3.4.4z" />
      <path d="M-4 0l3 3 5-6" />
    </g>
  ),
  shield: (
    <g fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0 -10l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z" />
      <path d="M-4 0l3 3 5-5" />
    </g>
  ),
  privacy: (
    <g fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-10 0s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
      <circle cx="0" cy="0" r="2.8" />
      <path d="M-9 9L9 -9" />
    </g>
  ),
  spark: (
    <g fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0 -10l2.3 6.3L9 -2l-6.3 2.3L0 7 -2.3.3-9-2l6.7-1.7z" />
      <path d="M7 6l1 2.5 2.5 1-2.5 1L7 13" transform="translate(-1 -3) scale(.8)" />
    </g>
  ),
  backup: (
    <g fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="0" cy="-6" rx="8" ry="3" />
      <path d="M-8 -6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V-6M-8 0c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </g>
  ),
};

const SEALS: Seal[] = [
  { key: "ssl", title: "256-bit SSL", sub: "Encrypted connection", icon: ICONS.lock },
  { key: "stripe", title: "Secure payments", sub: "Processed by Stripe", icon: ICONS.card },
  { key: "license", title: "Every license", sub: "Verified by our team", icon: ICONS.license },
  { key: "malpractice", title: "Malpractice", sub: "Coverage checked", icon: ICONS.shield },
  { key: "phi", title: "Zero patient data", sub: "No PHI stored", icon: ICONS.privacy },
  { key: "matching", title: "Smart matching", sub: "Rank-based, never first-come", icon: ICONS.spark },
  { key: "backups", title: "Nightly backups", sub: "Encrypted, off-site", icon: ICONS.backup },
];

function SealIcon({ children, id }: { children: React.ReactNode; id: string }) {
  // A rosette: scalloped outer ring, dashed inner ring, icon in the middle.
  const scallops = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return `${(Math.cos(a) * 27).toFixed(2)},${(Math.sin(a) * 27).toFixed(2)}`;
  });
  return (
    <svg viewBox="-32 -32 64 64" className="size-14 shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`seal-${id}`} x1="0" y1="-1" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--color-brand-500)" }} />
          <stop offset="1" style={{ stopColor: "var(--color-brand-700)" }} />
        </linearGradient>
      </defs>
      {scallops.map((p, i) => {
        const [x, y] = p.split(",").map(Number);
        return <circle key={i} cx={x} cy={y} r="4.6" fill={`url(#seal-${id})`} />;
      })}
      <circle r="26" fill={`url(#seal-${id})`} />
      <circle r="21.5" fill="none" stroke="white" strokeOpacity=".55" strokeWidth="1" strokeDasharray="2 2.2" />
      <circle r="18.5" className="fill-white" />
      <g className="text-brand-600" transform="scale(1.05)">{children}</g>
    </svg>
  );
}

export function TrustBadges({ className = "" }: { className?: string }) {
  return (
    <ul className={`grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-7 ${className}`} aria-label="Security and trust">
      {SEALS.map((s) => (
        <li key={s.key} className="flex flex-col items-center gap-2 text-center">
          <SealIcon id={s.key}>{s.icon}</SealIcon>
          <div>
            <div className="text-xs font-semibold text-slate-800">{s.title}</div>
            <div className="text-[11px] leading-tight text-slate-500">{s.sub}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
