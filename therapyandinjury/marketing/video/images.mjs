// Generates the photo backgrounds for the video ads with Gemini image generation (9:16, cached).
//   node marketing/video/images.mjs            (GEMINI_API_KEY in the environment)
// Scenes are generic and illustrative: no crash, no identifiable real person, never shown as a patient testimonial.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scenes');
const MODEL = 'gemini-3.1-flash-image';
const LOOK =
  'Photorealistic, cinematic commercial photography, shallow depth of field, rich contrast, cool navy-blue and teal color grade with warm highlights, modern and premium, vertical 9:16 frame, no text, no logos, no watermarks';

export const SCENES = {
  'city-traffic': 'A Florida city boulevard at blue-hour dusk seen from street level, palm trees, soft red and white car light trails, wet asphalt reflections, calm and moody, no accident',
  'driver-neck': 'Inside a parked car at dusk, a Black man in his early 30s in a casual button-up shirt sits in the driver seat and rubs the back of his stiff neck with one hand, a concerned but calm expression, city lights soft through the windshield, no damage visible',
  'clinic-consult': 'A bright modern chiropractic clinic with navy and teal accents; a friendly Black woman chiropractor in her 40s in navy scrubs gently examines the neck and shoulder of a seated adult patient, both relaxed, professional and reassuring',
  'phone-call': 'A confident young Black woman in a stylish blazer on a city sidewalk at golden hour, smiling slightly while holding a smartphone to her ear, urban storefronts softly blurred behind her',
  'spine-model': 'Close-up of a clean anatomical spine model on a modern clinic desk, navy background wall with teal rim light, shallow depth of field, elegant product-photography look',
  // "Don't Walk It Off" (30 s): one hero throughout, the man from driver-neck (passed as a reference image).
  'roadside-fine': { ref: ['driver-neck'], prompt: 'The same man from the reference photo, same face, hair and beard, standing on the grassy shoulder of a Florida road at dusk beside his car with its hazard lights on, giving a relaxed wave and a small smile as if saying "I am good" to someone off-camera; no visible damage, no injuries, calm scene' },
  'morning-neck': { ref: ['driver-neck'], prompt: 'The same man from the reference photo, same face, hair and beard, in a white t-shirt, sitting on the edge of his bed in soft early-morning window light, wincing and holding the side of his stiff neck, modern apartment bedroom' },
  'morning-back': { ref: ['driver-neck'], prompt: 'The same man from the reference photo, same face, hair and beard, in a white t-shirt, in a modern kitchen in morning light, one hand pressed to his lower back, stretching stiffly with a pained expression' },
  'morning-headache': { ref: ['driver-neck'], prompt: 'The same man from the reference photo, same face, hair and beard, in a white t-shirt, leaning on a bathroom sink in morning light, eyes closed, rubbing his temples with a headache' },
  'walking-city': { ref: ['driver-neck'], prompt: 'The same man from the reference photo, same face, hair and beard, now in a clean navy jacket, walking with purpose down a sunny Florida city sidewalk with palm trees, phone in hand, determined and calm, seen from slightly low angle' },
  // 60 s additions.
  'phone-home': { ref: ['driver-neck'], prompt: 'The same man from the reference photo, same face, hair and beard, same plaid shirt, sitting in the driver seat of his parked car at night, smiling reassuringly while talking on his phone held to his ear, warm dashboard glow, city lights bokeh outside, no damage visible' },
  'front-desk': { ref: ['driver-neck', 'clinic-consult'], prompt: 'At the front desk of the bright chiropractic clinic from the second reference photo (navy and teal accents), the man from the first reference photo (same face, hair and beard, wearing a navy jacket) checks in, handing a card to a friendly receptionist across the counter; welcoming and calm' },
  'clinic-talk': { ref: ['driver-neck', 'clinic-consult'], prompt: 'In the bright chiropractic clinic from the second reference photo, the woman chiropractor in navy scrubs from the second reference photo sits across from the man from the first reference photo (same face, hair and beard, navy jacket), listening attentively and taking notes on a tablet while he explains; a calm, friendly conversation' },
  'clinic-plan': { ref: ['driver-neck', 'clinic-consult'], prompt: 'In the bright chiropractic clinic from the second reference photo, the woman chiropractor in navy scrubs from the second reference photo explains something to the man from the first reference photo (same face, hair and beard, navy jacket) using an anatomical spine model on the desk between them; he is nodding, engaged and at ease' },
  'clinic-hero': { ref: ['driver-neck', 'clinic-consult'], prompt: 'In the bright chiropractic clinic from the second reference photo, the friendly woman chiropractor in navy scrubs from the second reference photo gently examines the neck and shoulder of the man from the first reference photo (same face, hair and beard, wearing a navy jacket), who sits on a treatment table looking relieved and at ease' },
};

async function gen(name, spec) {
  const { prompt, ref = [] } = typeof spec === 'string' ? { prompt: spec } : spec;
  const refs = ref.map((r) => ({ inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(path.join(dir, `${r}.jpg`)).toString('base64') } }));
  const out = path.join(dir, `${name}.jpg`);
  if (fs.existsSync(out)) return out;
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [...refs, { text: `${prompt}. ${LOOK}.` }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } },
      }),
    });
    const j = await r.json();
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (part) { fs.writeFileSync(out, Buffer.from(part.inlineData.data, 'base64')); return out; }
    console.warn(`  ${name}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 4000 * (a + 1)));
  }
  throw new Error(`image failed: ${name}`);
}

fs.mkdirSync(dir, { recursive: true });
// Scenes without references first, since later scenes use them as references.
const entries = Object.entries(SCENES);
const done = await Promise.all(entries.filter(([, s]) => !s.ref).map(([n, s]) => gen(n, s)));
done.push(...(await Promise.all(entries.filter(([, s]) => s.ref).map(([n, s]) => gen(n, s)))));
console.log(done.map((f) => path.basename(f)).join(', '));
