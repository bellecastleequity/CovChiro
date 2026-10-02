import { HelpArticleView } from "@/components/help/help-pages";
import { clinicHelp } from "@/lib/help/clinic";
import { articleBySlug } from "@/lib/help/types";
import { requireActor } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const a = articleBySlug(clinicHelp, (await params).slug);
  return { title: a ? `${a.title} · Help` : "Help center" };
}

export default async function ClinicHelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  await requireActor("clinic");
  return <HelpArticleView center={clinicHelp} slug={(await params).slug} />;
}
