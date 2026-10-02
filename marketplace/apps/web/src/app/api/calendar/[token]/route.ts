import { calendar } from "@cm/services";

export const dynamic = "force-dynamic";

/** Private calendar feed (the token in the URL is the only key). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const ics = await calendar.feedForToken((await params).token);
  if (!ics) return new Response("Not found", { status: 404 });
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300", "Content-Disposition": 'inline; filename="coverage.ics"' } });
}
