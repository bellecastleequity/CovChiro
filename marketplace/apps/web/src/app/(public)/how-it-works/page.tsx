export const metadata = { title: "How it works" };

const CLINIC = [
  ["Post the day", "Choose the location, profession, date and hours. Pricing is shown instantly."],
  ["Review matches", "See applicants and recommended providers with ratings, drive time and skills. Pick one, invite up to three, or let us choose."],
  ["Confirm & message", "A small deposit confirms the booking. Share arrival notes and chat in the app."],
  ["Rate & pay", "After the shift the balance is charged and both sides rate each other."],
];
const PROVIDER = [
  ["Get verified", "Add your licenses by state, malpractice, NPI and payout details."],
  ["See matching shifts", "Only shifts you're licensed and available for — with your pay and mileage."],
  ["Apply or accept", "Apply in a tap or accept an invitation. Overlapping applications withdraw automatically when you're confirmed."],
  ["Get paid", "Pay plus mileage is released to your bank after the shift's hold period."],
];

export default function HowItWorks() {
  return (
    <div className="container-page py-16">
      <h1 className="text-4xl font-semibold">How it works</h1>
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        {[
          ["For clinics", CLINIC],
          ["For providers", PROVIDER],
        ].map(([title, steps]) => (
          <div key={title as string}>
            <h2 className="text-lg font-semibold text-brand-700">{title as string}</h2>
            <ol className="mt-5 space-y-5">
              {(steps as string[][]).map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">{i + 1}</span>
                  <div>
                    <div className="font-semibold">{t}</div>
                    <p className="text-sm text-slate-600">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
