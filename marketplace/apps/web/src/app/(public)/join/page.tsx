import { JoinPage } from "./join-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Graduating soon? Join the chiropractic coverage network" };

export default async function Join({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <JoinPage search={await searchParams} />;
}
