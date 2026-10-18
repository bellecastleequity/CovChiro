// Shared copy used on more than one page.

// Service names and descriptions live in src/data/site.json ("services") and are edited at /_admin →
// Services. This is the live list (refreshed when the editor saves).
export { services } from './site';

export const steps = [
  {
    title: 'Request a visit',
    text: 'Choose your location and send a short request, or call. Tell us when works for you and we will confirm a time.',
  },
  {
    title: 'Your first visit',
    text: 'A chiropractic history and exam, then a plain-language explanation of what we found. If you need a medical evaluation, we refer you to an independent medical provider.',
  },
  {
    title: 'Your care plan',
    text: 'Together we set goals and a schedule. We check in on how you are doing at every visit and adjust the plan as you go.',
  },
];
