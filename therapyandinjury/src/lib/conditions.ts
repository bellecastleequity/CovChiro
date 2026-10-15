// Educational condition pages (/conditions/<slug>/). Written for search intent people
// actually type ("whiplash after car accident", "delayed pain after car accident") while
// staying within Florida advertising rules: general education, hedged language, no promised
// results, and a clear "when to get medical care first" section on every page.

export type Condition = {
  slug: string;
  name: string;
  title: string;
  description: string;
  lede: string;
  sections: { h: string; p?: string[]; list?: string[] }[];
  signs: string[];
  medicalFirst: string[];
  faqs: { q: string; a: string }[];
};

const RED_FLAGS = [
  'Severe or worsening headache, confusion, repeated vomiting, or unusual drowsiness',
  'Numbness, tingling, or weakness in the arms or legs',
  'Loss of bladder or bowel control',
  'Chest pain, abdominal pain, or trouble breathing',
  'Loss of consciousness at any point, or changes in vision or speech',
];

export const conditions: Condition[] = [
  {
    slug: 'whiplash',
    name: 'Whiplash',
    title: 'Whiplash After a Car Accident: Signs & Care | Florida',
    description:
      'Whiplash is a neck injury from rapid back-and-forth motion, common in rear-end crashes. Learn the signs, when to get medical care first, and what to expect.',
    lede: 'Whiplash is a neck injury caused by a sudden back-and-forth movement of the head, most often in a rear-end collision. It can happen even in low-speed crashes.',
    sections: [
      {
        h: 'What happens in a whiplash injury',
        p: [
          'When a vehicle is struck, the body moves with the seat while the head lags behind and then snaps forward. That quick motion can strain the muscles, ligaments, and joints of the neck and upper back.',
          'Symptoms are not always immediate. Some people feel fine at the scene and notice stiffness or soreness later that day or over the next few days.',
        ],
      },
      {
        h: 'How a chiropractic evaluation works',
        p: [
          'At Therapy & Injury, a Florida-licensed chiropractic physician takes a history of the accident and your symptoms, then examines posture, range of motion, and muscle and joint function, with orthopedic and neurological screening tests.',
          'If your exam suggests you need imaging or a medical evaluation, we refer you to an independent medical provider. If chiropractic care is appropriate, we explain the plan in plain language before starting, which may include gentle adjustments, soft-tissue therapy, and guided exercise.',
        ],
      },
      {
        h: 'Florida PIP and the 14-day window',
        p: [
          'If the injury came from a car accident, Florida PIP generally requires that you receive initial care within 14 days of the crash for PIP benefits to apply. See our guide to the 14-day rule for details.',
        ],
      },
    ],
    signs: [
      'Neck pain and stiffness',
      'Less range of motion when turning or tilting the head',
      'Headaches, often starting at the base of the skull',
      'Pain or tightness in the shoulders or upper back',
      'Tingling in the arms, fatigue, or dizziness',
    ],
    medicalFirst: RED_FLAGS,
    faqs: [
      {
        q: 'Can whiplash show up days after a car accident?',
        a: 'Yes. Some people notice whiplash symptoms hours or days after a collision rather than at the scene. If you were in a crash, a check-up within 14 days also keeps Florida PIP benefits available.',
      },
      {
        q: 'Can a chiropractor help with whiplash?',
        a: 'A chiropractic physician can evaluate the neck and upper back after a crash and, when appropriate, provide chiropractic care. Results vary from person to person. If you need imaging or a medical evaluation, we refer you to an independent medical provider.',
      },
    ],
  },
  {
    slug: 'neck-pain',
    name: 'Neck pain',
    title: 'Neck Pain After an Accident or Daily Strain | Chiropractic',
    description:
      'Neck pain can follow a car accident or build up from posture, work, and sleep. Learn common causes, warning signs, and what a chiropractic evaluation involves.',
    lede: 'Neck pain is one of the most common reasons people seek chiropractic care, whether it started with a car accident or built up slowly from desk work, phones, or sleep position.',
    sections: [
      {
        h: 'Common causes',
        list: [
          'Car accidents and other sudden jolts (see whiplash)',
          'Long hours looking down at a phone or laptop',
          'A pillow or sleep position that leaves the neck twisted',
          'Muscle strain from lifting, sports, or repetitive work',
          'Stress, which often shows up as tight shoulders and neck',
        ],
      },
      {
        h: 'How a chiropractic evaluation works',
        p: [
          'Your chiropractic physician asks when the pain started, what makes it better or worse, and how it affects sleep and work, then examines posture, movement, and the joints and muscles of the neck and upper back.',
          'Care is tailored to you and explained before it starts. It may include chiropractic adjustments, soft-tissue therapy, and exercises you can do at home. If anything suggests you need a medical evaluation, we refer you to an independent medical provider.',
        ],
      },
      {
        h: 'Everyday habits that may help',
        list: [
          'Raise screens to about eye level',
          'Take short movement breaks through the day',
          'Set your car headrest close to the back of your head',
          'Choose a pillow that keeps your neck roughly in line with your spine',
        ],
      },
    ],
    signs: ['Stiffness or soreness in the neck', 'Pain when turning your head', 'Tight shoulders or upper back', 'Headaches that start at the neck'],
    medicalFirst: RED_FLAGS,
    faqs: [
      {
        q: 'Should I see a chiropractor or a medical doctor for neck pain?',
        a: 'If you have any warning signs such as numbness, weakness, or a severe headache, see a medical provider or go to the emergency room first. For other neck pain, a chiropractic physician can evaluate you and refer you to an independent medical provider if needed.',
      },
    ],
  },
  {
    slug: 'back-pain',
    name: 'Back pain',
    title: 'Back Pain After a Car Accident or Lifting | Chiropractic',
    description:
      'Low and mid-back pain can follow a crash, a lift, or long days sitting. Learn common causes, warning signs, and how a chiropractic evaluation works.',
    lede: 'Back pain, in the lower or mid back, can follow a car accident, a heavy lift, or long days of sitting. Most people experience it at some point.',
    sections: [
      {
        h: 'Common causes',
        list: [
          'The force of a car accident, even at low speed',
          'Lifting or twisting with a heavy load',
          'Long periods of sitting or driving',
          'Muscle strain from sports, yard work, or a new activity',
        ],
      },
      {
        h: 'How a chiropractic evaluation works',
        p: [
          'We start with your history and a chiropractic exam of posture, movement, and the joints and muscles of the back and hips, including orthopedic and neurological screening tests.',
          'If care is appropriate, your chiropractic physician explains the plan first. It may include adjustments, soft-tissue therapy, and rehabilitation exercises. If you need imaging or a medical evaluation, we refer you to an independent medical provider.',
        ],
      },
    ],
    signs: ['Aching or stiffness in the lower or mid back', 'Pain when bending, lifting, or standing up', 'Muscle tightness or spasms', 'Pain that spreads into the hips'],
    medicalFirst: [...RED_FLAGS, 'Back pain with fever, or after a significant fall'],
    faqs: [
      {
        q: 'Is back pain after a car accident normal?',
        a: 'Back pain is a common complaint after a collision, and it can appear later rather than right away. Any new pain after a crash is worth having evaluated, and Florida PIP generally requires initial care within 14 days.',
      },
    ],
  },
  {
    slug: 'headaches-after-a-car-accident',
    name: 'Headaches after a car accident',
    title: 'Headaches After a Car Accident: When to Get Checked',
    description:
      'Headaches after a crash can come from the neck, or signal a head injury that needs medical care first. Learn the warning signs and when to get checked.',
    lede: 'Headaches are common after a car accident. Some come from strained muscles and joints in the neck. Others can signal a concussion or head injury, which needs a medical evaluation first.',
    sections: [
      {
        h: 'Get medical care first if you hit your head',
        p: [
          'If you hit your head, lost consciousness, or have confusion, memory problems, vomiting, vision changes, or a headache that keeps getting worse, see a medical provider or go to the emergency room before any chiropractic care.',
        ],
      },
      {
        h: 'Headaches that start in the neck',
        p: [
          'After a whiplash-type injury, tight muscles and irritated joints in the upper neck can contribute to headaches, often felt at the base of the skull and sometimes behind the eyes.',
          'A chiropractic physician can evaluate the neck and upper back and, when appropriate, provide chiropractic care. If anything points to a head injury or another medical cause, we refer you to an independent medical provider.',
        ],
      },
    ],
    signs: ['Headache starting at the base of the skull', 'Neck stiffness alongside the headache', 'Headache that worsens with certain neck positions'],
    medicalFirst: RED_FLAGS,
    faqs: [
      {
        q: 'Should I see a chiropractor for a headache after a car accident?',
        a: 'If you hit your head or have any concussion warning signs, see a medical provider first. If a medical cause has been ruled out and the headache seems related to neck strain, a chiropractic evaluation may be an option.',
      },
    ],
  },
  {
    slug: 'delayed-pain-after-a-car-accident',
    name: 'Delayed pain after a car accident',
    title: 'Delayed Pain After a Car Accident: Why & What to Do',
    description:
      'Feel fine after a crash but sore days later? Delayed pain is common. Learn why it happens, which symptoms to watch for, and why Florida’s 14-day PIP window matters.',
    lede: 'Many people walk away from a crash feeling fine, then wake up sore a day or two later. Delayed pain is common, and it’s one reason Florida’s 14-day PIP window matters.',
    sections: [
      {
        h: 'Why pain can show up later',
        p: [
          'Stress and adrenaline after an accident can mask discomfort for hours. Inflammation and muscle guarding can also build over the following days, so stiffness and soreness may peak a day or more after the crash.',
        ],
      },
      {
        h: 'Symptoms worth noting',
        list: [
          'Neck or shoulder stiffness',
          'Headaches',
          'Back pain or tightness',
          'Tingling or numbness (see a medical provider promptly)',
          'Trouble sleeping or concentrating',
        ],
      },
      {
        h: 'Don’t wait out the 14-day window',
        p: [
          'Florida PIP generally requires initial care within 14 days of an accident for benefits to apply. If you were in a crash, getting checked inside that window keeps your options open, even if your symptoms seem minor.',
        ],
      },
    ],
    signs: ['Soreness that appears the next morning', 'Stiffness that builds over a few days', 'New headaches after the crash'],
    medicalFirst: RED_FLAGS,
    faqs: [
      {
        q: 'How long after a car accident can pain start?',
        a: 'Some people notice pain within hours; for others it takes a day or several days. Keep track of new symptoms and get checked within 14 days to keep Florida PIP benefits available.',
      },
      {
        q: 'Should I get checked if I feel fine after an accident?',
        a: 'A check-up gives you a baseline and keeps you inside Florida’s 14-day PIP window in case symptoms appear later.',
      },
    ],
  },
];
