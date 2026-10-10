import { AppInstall } from "./app-install";
import Link from "next/link";
import { prisma } from "@cm/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/misc";
import { relative } from "@/lib/format";
import { clearShortCache } from "@/lib/short-cache";

/** Shared notifications page; marks everything read on view. */
export async function NotificationsPage({ userId }: { userId: string }) {
  const rows = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  clearShortCache();
  return (
    <>
      <PageHeader title="Notifications" />
      <Card className="mb-6"><CardHeader title="Phone & browser notifications" /><CardBody><AppInstall /></CardBody></Card>
      {rows.length ? (
        <Card className="divide-y divide-slate-100">
          {rows.map((n) => (
            <div key={n.id} className="flex gap-3 px-5 py-4">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand-600"}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}</div>
                {n.body ? <p className="text-sm text-slate-500">{n.body}</p> : null}
                <div className="mt-1 text-xs text-slate-400">{relative(n.createdAt)}</div>
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <Empty title="You're all caught up" />
      )}
    </>
  );
}
