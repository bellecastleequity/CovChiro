import { HelpArticleView } from "@/components/help/help-pages";
import { providerHelp } from "@/lib/help/provider";
import { articleBySlug } from "@/lib/help/types";
import { requireActor } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const a = articleBySlug(providerHelp, (await params).slug);
  return { title: a ? `${a.title} · Help` : "Help center" };
}

export default async function ProviderHelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  await requireActor("provider");
  return <HelpArticleView center={providerHelp} slug={(await params).slug} />;
}
