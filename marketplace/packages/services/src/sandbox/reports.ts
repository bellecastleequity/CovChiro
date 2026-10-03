import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { requireAdmin, type Actor } from "../context";
import { assertSandbox } from "./cast";
import { recentErrors } from "./errors";

/**
 * "Report a problem" on the test site: what the tester was looking at, who they
 * were (and which demo login, when using Act as), their note, their browser, and
 * the errors recorded around that moment.
 */

export interface ReportInput {
  note: string;
  path?: string | null;
  /** Browser, screen size and the page's own recent errors. */
  client?: { userAgent?: string; viewport?: string; browserErrors?: string[] } | null;
}

export async function createReport(who: { userId: string | null; name: string; email: string | null; adminUserId?: string | null }, input: ReportInput) {
  assertSandbox();
  const note = input.note.trim();
  if (note.length < 3) throw new DomainError("VALIDATION", "Tell us briefly what happened.");
  if (note.length > 4000) throw new DomainError("VALIDATION", "Keep it under 4,000 characters.");
  // Using Act as: the real person is the admin behind it; the demo login is what they were using.
  let reporter = { name: who.name, email: who.email, userId: who.userId };
  let actingAs: string | null = null;
  if (who.adminUserId && who.adminUserId !== who.userId) {
    const admin = await prisma.user.findUnique({ where: { id: who.adminUserId }, select: { id: true, name: true, email: true } });
    if (admin) {
      actingAs = `${who.name} (${who.email ?? "demo login"})`;
      reporter = { name: admin.name, email: admin.email, userId: admin.id };
    }
  }
  const errors = await recentErrors(who.userId);
  const r = await prisma.sandboxReport.create({
    data: {
      userId: reporter.userId,
      reporterName: reporter.name.slice(0, 200),
      reporterEmail: reporter.email,
      actingAs,
      path: input.path?.slice(0, 500) ?? null,
      note,
      context: {
        userAgent: input.client?.userAgent?.slice(0, 300) ?? null,
        viewport: input.client?.viewport?.slice(0, 40) ?? null,
        browserErrors: (input.client?.browserErrors ?? []).slice(0, 5).map((e) => e.slice(0, 500)),
        serverErrors: errors.map((e) => ({ source: e.source, message: e.message, path: e.path, at: e.lastAt.toISOString(), count: e.count })),
      },
    },
  });
  return r.id;
}

export async function listReports(actor: Actor, status: "OPEN" | "DONE" = "OPEN") {
  requireAdmin(actor);
  return prisma.sandboxReport.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 100 });
}

export async function setReportStatus(actor: Actor, id: string, done: boolean) {
  requireAdmin(actor);
  await prisma.sandboxReport.update({ where: { id }, data: { status: done ? "DONE" : "OPEN", resolvedAt: done ? new Date() : null } });
  return done ? "Marked done." : "Reopened.";
}
