// Shared copy used on more than one page. Service descriptions are drafts:
// every one is flagged `confirm: true` until the practice approves the wording.

export const services = [
  {
    slug: 'injury-evaluation',
    name: 'Injury evaluation',
    icon: 'eval',
    short: 'A chiropractic history and exam focused on how you were hurt, how you move, and what you feel.',
    body: [
      'Your first visit starts with a conversation about how the injury happened, where you feel symptoms, and how they affect daily life. A chiropractic physician then performs a hands-on examination, which may include posture, range of motion, orthopedic and neurological screening tests, and palpation.',
      'We explain what we find in plain language. If anything suggests you need a medical evaluation, imaging, or care outside chiropractic scope, we refer you to an independent medical provider.',
    ],
    confirm: true,
  },
  {
    slug: 'chiropractic-adjustments',
    name: 'Chiropractic adjustments',
    icon: 'adjust',
    short: 'Specific spinal and extremity adjustments, explained before they happen and tailored to your comfort.',
    body: [
      'An adjustment is a controlled, specific movement applied to a joint that is not moving well. Your doctor will explain the technique before using it and adapt it to your comfort level, injury, and preferences.',
      'Techniques used: [LIST TECHNIQUES — e.g., diversified, drop-table, instrument-assisted, low-force options].',
    ],
    confirm: true,
  },
  {
    slug: 'rehabilitation-exercise',
    name: 'Rehabilitation & therapeutic exercise',
    icon: 'rehab',
    short: 'Guided movement to rebuild mobility, strength, and stability, plus a simple plan for home.',
    body: [
      'Guided exercises help you move with more confidence as you recover. Programs are chosen for your injury and stage of recovery, and progress gradually.',
      'You will also get a short home program to do between visits. {rehabEquipment}',
    ],
    confirm: true,
  },
  {
    slug: 'soft-tissue-therapy',
    name: 'Soft-tissue therapy',
    icon: 'soft',
    short: 'Hands-on techniques for muscles and connective tissue that are tight or guarded after injury.',
    body: [
      'Muscles and connective tissue often tighten and guard after an injury. Soft-tissue techniques work directly with those tissues as part of your overall chiropractic care plan.',
      'Techniques used: [LIST TECHNIQUES — e.g., trigger point, instrument-assisted soft-tissue work, stretching].',
    ],
    confirm: true,
  },
];

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
