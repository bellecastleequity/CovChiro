// Writes one Google Business Profile setup sheet per branch from src/data/branches.json.
// Run after adding or editing a branch:  node social/gbp/generate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(readFileSync(join(here, '../../src/data/site.json'), 'utf8'));
const branches = JSON.parse(readFileSync(join(here, '../../src/data/branches.json'), 'utf8'));
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const t12 = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

for (const b of branches) {
  const name = `${b.city} Therapy & Injury`;
  const open = b.status === 'open';
  const url = `${site.domain}/${b.slug}/`;
  const utm = `${url}?utm_source=google&utm_medium=organic&utm_campaign=gbp-${b.slug}`;
  const doctors = b.doctors.length ? b.doctors.map((d) => d.name).join(', ') : 'Florida-licensed chiropractic physicians';
  const address = b.address ? `${b.address.street}\n${b.address.city}, ${b.address.state} ${b.address.zip}` : `[${b.city.toUpperCase()} ADDRESS]`;
  const hours = b.hours.length
    ? WEEK.map((d) => {
        const h = b.hours.find((x) => x.day === d);
        return `| ${d} | ${h ? `${t12(h.opens)} – ${t12(h.closes)}` : 'Closed'} |`;
      }).join('\n')
    : '| All days | [HOURS] |';
  const description = `${name} provides chiropractic injury and wellness care in ${b.city}, Florida, for people recovering from auto accident injuries, neck and back pain, and everyday strain. Visits start with a chiropractic history and examination and a clear, plain-language explanation of what we find. Care may include chiropractic adjustments, rehabilitation and therapeutic exercise, and soft-tissue therapy. Patients who need a medical evaluation are referred to an independent medical provider. Chiropractic care by ${doctors}. Serving ${b.city} and nearby communities including ${b.nearbyAreas.slice(0, 4).join(', ')}.`;

  const md = `# Google Business Profile: ${name}

Status: **${open ? 'Open' : 'Coming soon'}**${open ? '' : ` · Opening ${b.openingNote || '[OPENING DATE]'}`}
_Generated from \`src/data/branches.json\` by \`social/gbp/generate.mjs\`. Edit the data and re-run rather than editing this file._

${open ? '' : `> **Pre-opening listing:** Google lets you publish a profile with a future opening date (up to about 90 days ahead). Create it once the address is final so it can be verified.\n`}
## Core info
| Field | Value |
|---|---|
| Business name | **${name}** (exactly as on the signage; don't add keywords or the city twice) |
| Primary category | Chiropractor |
| Additional categories | None needed. Do **not** add "Medical clinic," "Physical therapist," or similar unless confirmed true. |
| Address | ${address.replace('\n', ', ')} |
| Service area | ${[b.city, ...b.nearbyAreas].join(', ')} |
| Phone | ${b.phone} |
| Website | \`${utm}\` |
| Appointment link | \`${url}#request\` |
| Opening date | ${open ? '[DATE OCALA OPENED]' : b.openingNote || '[OPENING DATE]'} |
| Owner / manager login | [WHO MANAGES THIS PROFILE] |

## Hours
| Day | Hours |
|---|---|
${hours}

Add holiday hours before each holiday.

## Business description (≤750 characters, ${description.length} now)
\`\`\`
${description}
\`\`\`

## Services (add each under "Services")
- Chiropractic injury evaluation
- Chiropractic adjustments
- Rehabilitation & therapeutic exercise
- Soft-tissue therapy
- Auto accident (PIP) injury care

## Photos to upload
- [ ] Logo: \`public/brand/favicon-512.png\` (square mark)
- [ ] Cover: \`dist/og/${b.slug}.png\` after \`npm run build\`, or an exterior photo
- [ ] Exterior with signage (helps verification) [PHOTO]
- [ ] Entrance / reception [PHOTO]
- [ ] Treatment room [PHOTO]
- [ ] Team / doctor headshot [PHOTO]

## First Google post
> ${open ? `${name} is open! Chiropractic injury and wellness care in ${b.city}. Hurt in a car accident? Florida PIP generally requires initial care within 14 days. Request an appointment online.` : `${name} is coming soon to ${b.city}. Get notified when we open.`}
> Button: "${open ? 'Book' : 'Learn more'}" → \`${url}\`

## Verification checklist
- [ ] Signage installed and visible (video verification often asks to show it)
- [ ] Business documents ready (utility bill or lease for the address, business license)
- [ ] Phone answered as "${name}"
- [ ] Name, address, and phone match the website exactly

## Reviews and replies (compliance)
- You may ask patients for reviews, but never offer anything in exchange.
- Never confirm someone is a patient or mention care details in a reply. Template:
  > Thank you for taking the time to share this. Please call us at ${b.phone} so we can help.
- Don't post or reshare reviews as testimonials without the patient's written permission.
`;
  writeFileSync(join(here, `${b.slug}.md`), md);
  console.log(`wrote gbp/${b.slug}.md`);
}
