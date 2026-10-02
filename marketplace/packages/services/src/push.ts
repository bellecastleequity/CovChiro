import { brand, env } from "@cm/config";
import { prisma } from "@cm/db";
import { generateVapidKeys, pushSender, vapidKeysValid, type VapidKeys } from "@cm/integrations";
import { clock } from "./context";

/**
 * Phone / browser notifications (Web Push). Every in-app notification is also pushed to the
 * person's subscribed devices; the push itself is empty and the service worker (public/sw.js)
 * fetches /api/notifications/latest to show the title and link. VAPID keys come from
 * VAPID_PUBLIC_KEY + VAPID_PRIVATE_JWK, or are generated once and kept in the Setting
 * "system.vapid" (so nothing has to be set up).
 */

const KEY = "system.vapid";
let cached: VapidKeys | null = null;

export async function vapidKeys(): Promise<VapidKeys> {
  if (cached) return cached;
  const e = env();
  if (e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_JWK) {
    const k = { publicKey: e.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(e.VAPID_PRIVATE_JWK) };
    if (vapidKeysValid(k)) return (cached = k);
    console.error("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_JWK don't match; using the stored keys");
  }
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (row && vapidKeysValid(row.value as unknown as VapidKeys)) return (cached = row.value as unknown as VapidKeys);
  const fresh = generateVapidKeys();
  // First writer wins if two processes race.
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: fresh as never }, update: {} });
  const saved = await prisma.setting.findUniqueOrThrow({ where: { key: KEY } });
  return (cached = saved.value as unknown as VapidKeys);
}

export async function pushPublicKey() {
  return (await vapidKeys()).publicKey;
}

export async function subscribe(userId: string, sub: { endpoint: string; keys?: { p256dh?: string; auth?: string } }, userAgent?: string | null) {
  if (!/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000 || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Invalid subscription");
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
  });
}

export async function unsubscribe(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

export async function deviceCount(userId: string) {
  return prisma.pushSubscription.count({ where: { userId } });
}

/** Wake every subscribed device of this person (best effort, never throws). */
export async function pushToUser(userId: string) {
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    if (!subs.length) return 0;
    const keys = await vapidKeys();
    const subject = `mailto:${brand().supportEmail}`;
    let ok = 0;
    for (const s of subs) {
      const r = await pushSender().send(s.endpoint, keys, subject);
      if (r === "gone") await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      else if (r === "ok") ((ok += 1), await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: clock.now() } }).catch(() => undefined));
    }
    return ok;
  } catch (e) {
    console.error("[push] failed", e);
    return 0;
  }
}

/** What the service worker shows: the newest unread notification. */
export async function latestForUser(userId: string) {
  const n = await prisma.notification.findFirst({ where: { userId, readAt: null }, orderBy: { createdAt: "desc" } });
  return n ? { title: n.title, body: n.body ?? "", link: n.link ?? "/" } : null;
}
