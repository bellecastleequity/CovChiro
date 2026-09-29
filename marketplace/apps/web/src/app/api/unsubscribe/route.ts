import { NextResponse, type NextRequest } from "next/server";
import { leads } from "@cm/services";

/** RFC 8058 one-click unsubscribe (List-Unsubscribe-Post). */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (token) await leads.unsubscribe(token);
  return new NextResponse(null, { status: 200 });
}
