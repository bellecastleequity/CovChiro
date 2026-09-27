<?php
// Knowledge base for coveragechiropractor.com's chat bot — sourced directly
// from this site's own FAQ, Help Center, pricing, and policy content so
// answers stay consistent with what's published on the page.

const FAQBOT_KB = [
    [
        'question' => 'What is chiropractic office coverage?',
        'keywords' => ['office coverage', 'vacation coverage', 'locum tenens', 'what is this'],
        'answer' => "Chiropractic office coverage is when a licensed doctor of chiropractic steps in to see your patients while you're away — for a vacation, continuing education, medical leave, or an open associate seat. Your patients keep their appointments and their care plan continues instead of your office closing.",
    ],
    [
        'question' => 'How do I book chiropractic vacation coverage?',
        'keywords' => ['book', 'booking', 'how to book', 'schedule coverage'],
        'answer' => "Choose your region and dates on the booking page, get an instant rate quote including mileage, and confirm with a 10% deposit. Coverage is confirmed immediately and a signed agreement is completed as part of checkout.",
    ],
    [
        'question' => 'Do you provide temporary chiropractic associate coverage?',
        'keywords' => ['temporary associate', 'locum tenens', 'fill in doctor'],
        'answer' => "Yes. Whether you call it office coverage, vacation coverage, or temporary associate support, it's the same service: a licensed, insured Doctor of Chiropractic seeing your patients on your protocols while you're out, comfortable handling high-volume schedules of 100+ patients a day.",
    ],
    [
        'question' => 'What areas of Florida are served?',
        'keywords' => ['areas', 'regions', 'north florida', 'central florida', 'south florida', 'orlando', 'tampa', 'jacksonville', 'miami', 'fort lauderdale', 'where'],
        'answer' => "Coverage is available across North, Central, and South Florida, including Orlando, Tampa, Jacksonville, Gainesville, Tallahassee, Miami, Fort Lauderdale, West Palm Beach, and Naples, with rates set by region.",
    ],
    [
        'question' => 'How much does chiropractic office coverage cost?',
        'keywords' => ['cost', 'price', 'pricing', 'rate', 'rates', 'how much'],
        'answer' => "Office coverage runs $325–$375 for a half day (up to 4 hours) and $575–$625 for a full day (up to 8 hours), depending on region, plus $0.20/mile one way from Orlando (32801). Additional coverage beyond 8 hours is billed at $100/hour.",
    ],
    [
        'question' => 'Do you also offer home visits or event coverage?',
        'keywords' => ['home visit', 'home visits', 'sporting event', 'corporate wellness'],
        'phrases' => ['home visit', 'sporting event', 'corporate wellness'],
        'answer' => "Home visits, sporting events, corporate wellness days, and travel work are booked separately at thefloridachiropractor.com — this site is for chiropractic office coverage only.",
    ],
    [
        'question' => 'Is same-day or emergency coverage available?',
        'keywords' => ['same day', 'emergency', 'urgent', 'tonight', 'last minute', 'midnight', 'short staffed'],
        'answer' => "Yes. Bookings are monitored 24/7 with fast responses at any hour — for illness, emergencies, or a practice that's suddenly short-staffed. Same-day and next-day dates also get an automatic 10% discount.",
    ],
    [
        'question' => "Do you offer help if I just need extra hands, not full coverage?",
        'keywords' => ['extra hands', 'busy', 'high volume', 'additional doctor', 'not away'],
        'answer' => "Yes. Office coverage isn't only for when you're away — it's also booked by practices that are in the office but simply need an additional doctor for a busy day, week, or month of high patient volume.",
    ],
    [
        'question' => 'Are there any discounts available?',
        'keywords' => ['discount', 'discounts', 'promo', 'save', 'deal', 'recurring clinic', 'loyalty'],
        'answer' => "Yes, applied automatically — no code needed. First-time practices get 10% off their first booking. After 3 full days of coverage (6 half days counts the same) you earn Recurring Clinic status: 5% off, active as long as you book at least once every 12 months. Any date still open within 24 hours of its start also gets an automatic 10% discount. These can stack and are shown live in your quote.",
    ],
    [
        'question' => 'How is coveragechiropractor.com different from a staffing agency?',
        'keywords' => ['staffing agency', 'mma chiropractors', 'all care consultants', 'chiro plus', 'chiro match makers', 'chirocover', 'agency', 'markup', 'placement fee'],
        'answer' => "Staffing agencies like MMA Chiropractors, All Care Consultants, Chiro Plus Agency, Chiro Match Makers, and ChiroCover match practices with doctors from a roster, typically for a placement fee. Coveragechiropractor.com skips that step — you book directly with the covering doctor at published rates, with instant online confirmation and no agency markup.",
    ],
    [
        'question' => 'How do I book 3.5 days of coverage?',
        'keywords' => ['half day', '3.5 days', 'add half day', 'partial day'],
        'answer' => 'Enter the number of full days, then check "Add a half day" — the half day is added right after your full days, back to back, priced at the half-day rate for your region.',
    ],
    [
        'question' => 'What counts as a half day vs a full day?',
        'keywords' => ['half day', 'full day', 'hours', 'meal break', 'lunch', 'overtime'],
        'answer' => "A half day covers up to 4 hours; a full day covers up to 8 hours. A full day includes one meal break of up to 60 minutes — time beyond that is billed at $100/hour, same as any coverage beyond the booked hours.",
    ],
    [
        'question' => 'Is coverage confirmed instantly?',
        'keywords' => ['confirmed', 'instant', 'instantly', 'callback', 'wait'],
        'answer' => "Yes — office coverage is confirmed the moment your 10% deposit is processed, with no waiting for a callback.",
    ],
    [
        'question' => 'How is mileage calculated?',
        'keywords' => ['mileage', 'miles', 'travel fee', 'gas', 'drive'],
        'answer' => "Mileage is calculated automatically from your ZIP code to the provider's base in Orlando (32801), tiered by distance: $0.20/mile up to 150 miles, $0.40/mile for 150–300 miles, and $0.60/mile plus a $110/night hotel allowance beyond 300 miles.",
    ],
    [
        'question' => 'Is a deposit required?',
        'keywords' => ['deposit', 'down payment', 'pay now', 'how much upfront'],
        'answer' => "Yes — a 10% deposit is charged by credit card at the time of booking. The remaining balance is invoiced after coverage is complete.",
    ],
    [
        'question' => 'When is my remaining balance due?',
        'keywords' => ['balance', 'remaining balance', 'invoice', 'pay later', 'final payment'],
        'answer' => "Once your coverage is marked complete, you'll receive an invoice for the remaining balance, payable by credit card via the invoice or directly in your account portal. Reminders are sent up to twice daily until it's paid in full.",
    ],
    [
        'question' => "What's the cancellation policy?",
        'keywords' => ['cancel', 'cancellation', 'refund', 'reschedule'],
        'answer' => "Free cancellation and a full refund up to 48 hours before your coverage start date. Cancelling inside 48 hours forfeits the deposit portion.",
    ],
    [
        'question' => 'How do I cancel a booking?',
        'keywords' => ['cancel booking', 'how do i cancel'],
        'answer' => "Open the booking in your account dashboard and select Cancel — you'll see exactly what's refundable before confirming.",
    ],
    [
        'question' => "What's in the Documents & forms tab?",
        'keywords' => ['documents', 'forms', 'w-9', 'w9', 'certificate of insurance', 'coi', 'malpractice declaration'],
        'answer' => "Once you have a booking, your dashboard shows a Documents tab with a signed agreement copy, W-9 request, certificate of insurance request, the malpractice declaration page, and coverage guidelines.",
    ],
    [
        'question' => 'Can I request a video interview with the doctor?',
        'keywords' => ['video interview', 'zoom', 'video call', 'meet the doctor'],
        'answer' => 'Yes, once you have a booking — a "Request video interview" option appears on your booking in the dashboard. These are 10-minute calls, Monday–Friday, 12:00–1:00pm, confirmed by email.',
    ],
    [
        'question' => 'How do I leave a review?',
        'keywords' => ['leave a review', 'rate my experience', 'feedback'],
        'answer' => 'Once a booking is paid in full — including the remaining balance — a "Leave a review" option appears on that booking in your dashboard.',
    ],
    [
        'question' => 'Can I specify dress code or techniques?',
        'keywords' => ['dress code', 'technique', 'techniques', 'diversified', 'gonstead', 'thompson', 'spinal decompression', 'manual therapy', 'ultrasound', 'e-stim'],
        'answer' => "Yes. The booking form includes a Coverage details section for dress code, techniques (Diversified, Gonstead, Thompson, Spinal Decompression, Manual Therapy, Ultrasound, E-Stim), notes, and a day-of point of contact.",
    ],
    [
        'question' => 'What is a standing day / recurring coverage arrangement?',
        'keywords' => ['standing day', 'recurring', 'weekly', 'biweekly', 'monthly', 'every week'],
        'answer' => "A standing day is a recurring coverage arrangement, not a one-off booking — reserve a weekly, biweekly, or monthly day and it's held exclusively for your practice. It's a request, not an instant booking: 12–23 committed coverage days gets 10% off, 24+ gets 15% off, and you'll hear back within one business day to confirm.",
    ],
    [
        'question' => 'What are promotional rate dates?',
        'keywords' => ['promotional rate', 'flex rate', 'discounted dates', 'special rate'],
        'answer' => "Promotional Rate Dates are specific dates pre-set at a discount based on doctor availability — not negotiated. If one lines up with your schedule, you can book it directly at that rate.",
    ],
    [
        'question' => 'Do you accept insurance or cash?',
        'keywords' => ['insurance', 'cash', 'hmo', 'ppo', 'medicare', 'medicaid', 'claims'],
        'phrases' => ['insurance'],
        'answer' => "Credit card payments only — no cash accepted. No insurance is billed and no insurance claims are filed; all rates are self-pay, due directly to Dr. McPherson.",
    ],
    [
        'question' => 'Is the doctor licensed and insured?',
        'keywords' => ['licensed', 'insured', 'license', 'malpractice', 'credentials'],
        'answer' => "Yes — Dr. Michael L. McPherson is a licensed, insured Doctor of Chiropractic in Florida & the U.S. Virgin Islands, a Palmer College of Chiropractic alumnus, and carries malpractice coverage.",
    ],
    [
        'question' => 'How do I contact the office?',
        'keywords' => ['contact', 'email', 'phone', 'reach', 'get in touch'],
        'answer' => "You're in the right place — send your question here in chat, or email drmichaelmcpherson@gmail.com. Dr. McPherson replies directly.",
    ],
];
