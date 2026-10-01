import { PRIVATE_META } from "@/lib/seo";

/** Signed agreements and signing links are private: never indexed. */
export const metadata = PRIVATE_META;

export default function AgreementsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
