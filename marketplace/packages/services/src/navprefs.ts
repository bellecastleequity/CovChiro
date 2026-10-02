import { cleanNavOrder } from "@cm/core";
import { prisma } from "@cm/db";

/** Each person's side-menu order per area, kept as a Setting row "nav.order.<userId>.<area>" (no schema needed). */
const key = (userId: string, root: string) => `nav.order.${userId}.${root.replace(/^\//, "")}`;

export async function getNavOrder(userId: string, root: string): Promise<string[] | null> {
  const row = await prisma.setting.findUnique({ where: { key: key(userId, root) } });
  return row && Array.isArray(row.value) ? (row.value as string[]) : null;
}

export async function saveNavOrder(userId: string, root: string, hrefs: unknown) {
  const order = cleanNavOrder(root, hrefs);
  if (!order.length) return resetNavOrder(userId, root);
  await prisma.setting.upsert({ where: { key: key(userId, root) }, create: { key: key(userId, root), value: order, updatedById: userId }, update: { value: order, updatedById: userId } });
}

export async function resetNavOrder(userId: string, root: string) {
  await prisma.setting.deleteMany({ where: { key: key(userId, root) } });
}
