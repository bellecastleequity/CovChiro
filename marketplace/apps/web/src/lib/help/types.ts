import type { SettingsMap } from "@cm/config";

/**
 * Help center articles (signed-in clinics and providers). Like the training academy, bodies are
 * functions of live Settings, so every number shown is the one in use today.
 */
export interface HelpArticle {
  slug: string;
  /** Category id (see HelpCenter.categories). */
  category: string;
  title: string;
  summary: string;
  /** Extra words people might search for. */
  keywords: string;
  body: (s: SettingsMap, brand: string) => React.ReactNode;
  /** The real screens this article is about. */
  links?: { href: string; label: string }[];
  /** Related training lesson slug (same audience). */
  lesson?: string;
  popular?: boolean;
}

export interface HelpCategory {
  id: string;
  title: string;
  description: string;
}

export interface HelpCenter {
  audience: "clinic" | "provider";
  base: string;
  academyBase: string;
  categories: HelpCategory[];
  articles: HelpArticle[];
}

export function articleBySlug(center: HelpCenter, slug: string) {
  return center.articles.find((a) => a.slug === slug) ?? null;
}
