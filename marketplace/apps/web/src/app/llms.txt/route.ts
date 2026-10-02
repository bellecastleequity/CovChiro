import { brand } from "@cm/config";
import { prisma } from "@cm/db";
import { getSettings, siteFaq } from "@cm/services";
import { liveMarket, priceRange, serviceWord, siteUrl, stateRates } from "@/lib/seo";

/**
 * /llms.txt: a plain-language fact sheet for AI assistants and answer engines
 * (ChatGPT, Claude, Perplexity, Google AI). Built from live data, so every number
 * is the one in use.
 */
export const dynamic = "force-dynamic";

const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;

export async function GET() {
  const b = brand();
  const base = siteUrl();
  const [s, live] = await Promise.all([getSettings(), liveMarket()]);
  const blocks: string[] = [];
  for (const { profession: p, state: st } of live) {
    const groups = await stateRates(p.code, st.code);
    const range = priceRange(groups);
    const service = serviceWord(p.slug);
    blocks.push(
      [
        `## ${service} coverage in ${st.name}`,
        `- Page: ${base}/${p.slug}/${st.slug}`,
        ...st.areas.map((a) => `- ${a.name} (${a.cities.map((c) => c.name).join(", ")}): ${base}/${p.slug}/${st.slug}/${a.slug}`),
        range ? `- Clinic price: ${usd(range.low)}–${usd(range.high)} per half or full day depending on ZIP code${p.volumePricingEnabled ? " and patient volume (Light or Busy day)" : ""}, before travel. Full rate card: ${base}/for-clinics` : "",
        `- Every ${p.credentialSuffix} has a verified ${st.name} license and malpractice coverage before they can take a shift; licenses are re-checked at booking and before each shift.`,
      ].filter(Boolean).join("\n"),
    );
  }
  const pros = await prisma.profession.findMany({ where: { active: true }, select: { displayName: true } });
  const body = [
    `# ${b.name}`,
    "",
    `> ${b.name} is an online marketplace that books licensed, verified ${pros.map((p) => p.displayName.toLowerCase() + "s").join(", ") || "healthcare providers"} to cover healthcare practices for a half day, a day or longer: vacations, holidays, sick days, parental leave, conferences, or an open associate seat. Clinics pay a set price per shift; providers are paid through the platform after each shift.`,
    "",
    "## Key facts",
    `- Website: ${base}`,
    `- Support: ${b.supportEmail}`,
    `- Mileage is passed through to the provider at $${(s["pricing.mileageRateCentsPerMile"] / 100).toFixed(2)} per mile; overnight lodging is a flat ${usd(s["pricing.lodgingNightlyCents"])} a night when needed.`,
    `- Free cancellation for clinics ${s["payments.clinicFreeCancelHours"]}+ hours before the shift.`,
    `- No patient information is stored on the platform.`,
    "",
    ...blocks.flatMap((x) => [x, ""]),
    "## Frequently asked questions",
    ...siteFaq(s).slice(0, 12).map(([q, a]) => `- ${q} ${a}`),
    "",
    "## Pages",
    `- How it works: ${base}/how-it-works`,
    `- Pricing for clinics: ${base}/for-clinics`,
    `- For providers (per diem and locum shifts): ${base}/for-providers`,
    `- Cost of closing calculator: ${base}/tools/cost-of-closing`,
    `- FAQ: ${base}/faq`,
    `- Blog: ${base}/blog`,
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
