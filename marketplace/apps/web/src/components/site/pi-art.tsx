/**
 * Illustrations for the personal injury landing page: inline SVG in brand tokens (no stock photos,
 * nothing to load). Decorative: every one is aria-hidden and the text around it carries the meaning.
 */

/** Hero: a week calendar where the out-of-office days are covered and new patients keep arriving. */
export function HeroArt() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const covered = [2, 3];
  return (
    <svg viewBox="0 0 520 420" className="h-auto w-full" aria-hidden="true">
      <defs>
        <linearGradient id="pi-hero-card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.16" />
          <stop offset="1" stopColor="white" stopOpacity="0.06" />
        </linearGradient>
      </defs>
      <rect x="20" y="30" width="480" height="300" rx="28" fill="url(#pi-hero-card)" className="stroke-white" strokeOpacity="0.2" strokeWidth="2" />
      <text x="52" y="78" className="fill-white" fontSize="20" fontWeight="600">This week</text>
      <text x="468" y="78" className="fill-accent-200" fontSize="14" fontWeight="600" textAnchor="end">Dr. out Wed–Thu</text>
      {days.map((d, i) => {
        const x = 52 + i * 72;
        const isCovered = covered.includes(i);
        return (
          <g key={d}>
            <rect x={x} y="100" width="60" height="196" rx="14" className={isCovered ? "fill-accent-500" : "fill-white"} fillOpacity={isCovered ? 1 : 0.1} />
            <text x={x + 30} y="126" className={isCovered ? "fill-brand-800" : "fill-white"} fontSize="14" fontWeight="700" textAnchor="middle">{d}</text>
            {[0, 1, 2, 3, 4].map((r) => (
              <rect key={r} x={x + 10} y={142 + r * 28} width="40" height="16" rx="5" className={isCovered ? "fill-brand-800" : "fill-white"} fillOpacity={0.25} />
            ))}
          </g>
        );
      })}
      <g transform="translate(120 300)">
        <rect width="262" height="56" rx="28" className="fill-white" />
        <circle cx="30" cy="28" r="17" className="fill-accent-500" />
        <path d="M22 28l6 6 11-12" className="stroke-brand-800" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="58" y="25" className="fill-brand-800" fontSize="14" fontWeight="700">Covering DC confirmed</text>
        <text x="58" y="43" className="fill-slate-600" fontSize="12">License verified · PI experience</text>
      </g>
      <g transform="translate(372 352)">
        <rect width="132" height="44" rx="22" className="fill-amber-300" />
        <text x="66" y="28" className="fill-brand-800" fontSize="14" fontWeight="700" textAnchor="middle">+3 new patients</text>
      </g>
    </svg>
  );
}

/** One owner, two locations: the owner anchors one, coverage keeps the other open. */
export function TwoLocationsArt() {
  const building = (x: number, label: string, tone: "brand-600" | "accent-600") => (
    <g transform={`translate(${x} 70)`}>
      <rect width="150" height="120" rx="14" className={tone === "brand-600" ? "fill-brand-600" : "fill-accent-600"} />
      <rect x="20" y="-24" width="110" height="34" rx="10" className={tone === "brand-600" ? "fill-brand-600" : "fill-accent-600"} />
      <text x="75" y="-2" className="fill-white" fontSize="13" fontWeight="700" textAnchor="middle">{label}</text>
      {[0, 1].map((r) => [0, 1, 2].map((c) => <rect key={`${r}-${c}`} x={22 + c * 38} y={22 + r * 36} width="26" height="22" rx="4" className="fill-white" fillOpacity="0.35" />))}
      <rect x="60" y="88" width="30" height="32" rx="4" className="fill-white" fillOpacity="0.6" />
    </g>
  );
  return (
    <svg viewBox="0 0 520 300" className="h-auto w-full" aria-hidden="true">
      {building(20, "Main office", "brand-600")}
      {building(350, "New location", "accent-600")}
      <path d="M180 140 C 250 60, 280 60, 340 140" className="stroke-slate-400" strokeWidth="3" strokeDasharray="8 8" fill="none" />
      <g transform="translate(222 64)">
        <rect className="fill-white stroke-slate-200" width="80" height="30" rx="15" />
        <text x="40" y="20" className="fill-slate-600" fontSize="12" fontWeight="600" textAnchor="middle">40 min</text>
      </g>
      <g transform="translate(95 236)">
        <circle r="26" className="fill-brand-600" />
        <circle cy="-6" r="9" className="fill-white" />
        <path d="M-14 14a14 12 0 0128 0" className="fill-white" />
        <text y="50" className="fill-slate-800" fontSize="13" fontWeight="700" textAnchor="middle">You, Mon–Fri</text>
      </g>
      <g transform="translate(425 236)">
        <circle r="26" className="fill-accent-500" />
        <circle cy="-6" r="9" className="fill-white" />
        <path d="M-14 14a14 12 0 0128 0" className="fill-white" />
        <text y="50" className="fill-slate-800" fontSize="13" fontWeight="700" textAnchor="middle">Covering DC, Tue/Thu</text>
      </g>
    </svg>
  );
}

/** Turnover: notice → search → hire, with coverage spanning the gap. */
export function TurnoverArt() {
  return (
    <svg viewBox="0 0 520 170" className="h-auto w-full" aria-hidden="true">
      <rect x="40" y="70" width="440" height="14" rx="7" className="fill-slate-200" />
      <rect x="70" y="70" width="380" height="14" rx="7" className="fill-accent-500" />
      {[
        { x: 70, t: "Associate gives notice", c: "brand-600" },
        { x: 260, t: "You interview without pressure", c: "accent-600" },
        { x: 450, t: "The right hire starts", c: "brand-600" },
      ].map((p) => (
        <g key={p.t} transform={`translate(${p.x} 77)`}>
          <circle r="16" className={p.c === "brand-600" ? "fill-white stroke-brand-600" : "fill-white stroke-accent-600"} strokeWidth="6" />
          <text y="46" className="fill-slate-700" fontSize="13" fontWeight="600" textAnchor="middle">{p.t}</text>
        </g>
      ))}
      <text x="260" y="44" className="fill-accent-700" fontSize="14" fontWeight="700" textAnchor="middle">Coverage keeps every schedule open</text>
    </svg>
  );
}
