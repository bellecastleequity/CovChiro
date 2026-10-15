import { JoinPage } from "./join-page";

export const dynamic = "force-dynamic";
// Campaign sign-up link (the search page for students is /chiropractic-students): not indexed.
export const metadata = { title: "Graduating soon? Join the chiropractic coverage network", robots: { index: false, follow: true } };

export default async function Join({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <JoinPage search={await searchParams} />;
}
