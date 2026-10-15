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
};

async function gen(name, prompt) {
  const out = path.join(dir, `${name}.jpg`);
  if (fs.existsSync(out)) return out;
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}. ${LOOK}.` }] }],
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
const done = await Promise.all(Object.entries(SCENES).map(([n, p]) => gen(n, p)));
console.log(done.map((f) => path.basename(f)).join(', '));
