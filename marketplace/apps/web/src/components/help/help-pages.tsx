import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, GraduationCap, LifeBuoy, MessageCircle, Siren } from "lucide-react";
import { brand } from "@cm/config";
import { prisma } from "@cm/db";
import { getSettings, support, type Actor } from "@cm/services";
import { contactSupportAction, supportCloseAction, supportReplyAction } from "@/app/help-actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, PhiNotice, Select, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel, relative } from "@/lib/format";
import { articleBySlug, type HelpCenter } from "@/lib/help/types";
import { HelpSearch, type HelpSearchItem } from "./help-search";

const STATUS: Record<string, { label: string; tone: "amber" | "green" | "gray" }> = {
  OPEN: { label: "Waiting on our team", tone: "amber" },
  ANSWERED: { label: "We replied", tone: "green" },
  CLOSED: { label: "Closed", tone: "gray" },
};

/** Approved knowledge-base answers for this audience (maintained in Growth → Content). */
async function kbAnswers(audience: "clinic" | "provider") {
  const rows = await prisma.kbArticle
    .findMany({ where: { approved: true, active: true, audience: { in: [audience.toUpperCase(), "ALL"] } }, orderBy: { updatedAt: "desc" }, take: 200 })
    .catch(() => []);
  return rows;
}

export async function HelpHome({ center, actor }: { center: HelpCenter; actor: Actor }) {
  const [kb, mine] = await Promise.all([kbAnswers(center.audience), support.myRequests(actor)]);
  const items: HelpSearchItem[] = [
    ...center.articles.map((a) => ({ kind: "article" as const, title: a.title, summary: a.summary, keywords: `${a.keywords} ${a.category}`, href: `${center.base}/${a.slug}`, category: a.category })),
    ...kb.map((k) => ({ kind: "answer" as const, title: k.question, summary: "", keywords: `${k.topic} ${k.keywords.join(" ")}`, answer: k.answer, category: k.topic })),
  ];
  const answered = mine.filter((r) => r.status === "ANSWERED").length;
  const open = mine.filter((r) => r.status !== "CLOSED");
  return (
    <>
      <PageHeader eyebrow="Help center" title="How can we help?" description="Search the answers, browse by topic, or ask our team." />
      <Link href={`${center.base}/urgent`} className="mb-5 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 hover:border-red-300">
        <Siren className="size-6 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-red-900">Need help now?</div>
          <div className="text-sm text-red-800">A no-show, a problem at the clinic, something that can&apos;t wait: we&apos;ll call, text or email you within minutes.</div>
        </div>
        <ArrowRight className="size-5 shrink-0 text-red-600" />
      </Link>
      <div className="mb-6">
        <HelpSearch items={items} contactHref={`${center.base}/contact`} />
      </div>
      {answered ? (
        <Alert tone="success" className="mb-6" title={`We replied to ${answered === 1 ? "your request" : `${answered} of your requests`}`}>
          <Link href={`${center.base}/contact#requests`} className="font-medium underline">See the reply →</Link>
        </Alert>
      ) : null}
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Link href={`${center.base}/contact`} className="rounded-2xl border border-brand-200 bg-brand-50/50 p-4 hover:border-brand-400">
          <LifeBuoy className="size-5 text-brand-700" />
          <div className="mt-2 font-semibold text-slate-900">Contact support</div>
          <div className="text-sm text-slate-600">{open.length ? `${open.length} open request${open.length === 1 ? "" : "s"}` : "Ask our team anything"}</div>
        </Link>
        <Link href={center.academyBase} className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-300">
          <GraduationCap className="size-5 text-accent-600" />
          <div className="mt-2 font-semibold text-slate-900">Training</div>
          <div className="text-sm text-slate-600">Short lessons with quick checks</div>
        </Link>
        <Link href={`${center.base}/contact#requests`} className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-300">
          <MessageCircle className="size-5 text-accent-600" />
          <div className="mt-2 font-semibold text-slate-900">My requests</div>
          <div className="text-sm text-slate-600">{mine.length ? `${mine.length} in total` : "None yet"}</div>
        </Link>
      </div>

      <Card className="mb-8">
        <CardHeader title="Popular answers" />
        <ul className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">
          {center.articles
            .filter((a) => a.popular)
            .map((a) => (
              <li key={a.slug}>
                <Link href={`${center.base}/${a.slug}`} className="flex items-center gap-2 px-5 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 hover:text-brand-700">
                  <BookOpen className="size-4 shrink-0 text-slate-400" />
                  {a.title}
                </Link>
              </li>
            ))}
        </ul>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        {center.categories.map((c) => (
          <Card key={c.id} id={`c-${c.id}`}>
            <CardHeader title={c.title} description={c.description} />
            <ul className="divide-y divide-slate-100">
              {center.articles
                .filter((a) => a.category === c.id)
                .map((a) => (
                  <li key={a.slug}>
                    <Link href={`${center.base}/${a.slug}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-brand-700">
                      <span>{a.title}</span>
                      <ArrowRight className="size-4 shrink-0 text-slate-300" />
                    </Link>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>

      {kb.length ? (
        <Card className="mt-8">
          <CardHeader title="More answers" description="Common questions from clinics and providers." />
          <div className="divide-y divide-slate-100">
            {kb.slice(0, 40).map((k) => (
              <details key={k.id} className="px-5 py-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-800">{k.question}</summary>
                <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{k.answer}</p>
              </details>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}

export async function HelpArticleView({ center, slug }: { center: HelpCenter; slug: string }) {
  const a = articleBySlug(center, slug);
  if (!a) notFound();
  const s = await getSettings();
  const cat = center.categories.find((c) => c.id === a.category);
  const related = center.articles.filter((x) => x.category === a.category && x.slug !== a.slug).slice(0, 5);
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={center.base} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" />
        Help center{cat ? ` · ${cat.title}` : ""}
      </Link>
      <PageHeader title={a.title} description={a.summary} />
      <Card>
        <CardBody className="py-6 sm:px-8">{a.body(s, brand().name)}</CardBody>
      </Card>
      {a.links?.length || a.lesson ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {a.links?.map((l) => (
            <LinkButton key={l.href} href={l.href} variant="outline">
              <ExternalLink className="size-4" />
              {l.label}
            </LinkButton>
          ))}
          {a.lesson ? (
            <LinkButton href={`${center.academyBase}/${a.lesson}`} variant="ghost">
              <GraduationCap className="size-4" />
              Related training lesson
            </LinkButton>
          ) : null}
        </div>
      ) : null}
      <Card className="mt-6">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-slate-900">Still need help?</div>
            <div className="text-sm text-slate-600">Our team will get back to you. {s["support.replyTime"]}</div>
          </div>
          <LinkButton href={`${center.base}/contact?subject=${encodeURIComponent(a.title)}`}>
            <LifeBuoy className="size-4" />
            Contact support
          </LinkButton>
        </CardBody>
      </Card>
      {related.length ? (
        <Card className="mt-6">
          <CardHeader title="Related" />
          <ul className="divide-y divide-slate-100">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={`${center.base}/${r.slug}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-brand-700">
                  {r.title}
                  <ArrowRight className="size-4 shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

export async function HelpContact({ center, actor, subject }: { center: HelpCenter; actor: Actor; subject?: string }) {
  const s = await getSettings();
  const mine = await support.myRequests(actor);
  // Recent shifts this person is part of, to attach to the request.
  const since = new Date(Date.now() - 60 * 86_400_000);
  const shifts =
    center.audience === "clinic"
      ? await prisma.shift.findMany({ where: { location: { clinicOrgId: actor.clinicOrgId! }, startsAt: { gte: since }, status: { not: "DRAFT" } }, include: { location: { select: { name: true, timeZone: true } } }, orderBy: { startsAt: "desc" }, take: 30 })
      : await prisma.shift.findMany({ where: { assignments: { some: { providerId: actor.providerId! } }, startsAt: { gte: since } }, include: { location: { select: { name: true, timeZone: true } } }, orderBy: { startsAt: "desc" }, take: 30 });
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={center.base} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" />
        Help center
      </Link>
      <PageHeader title="Contact support" description={`Ask our team anything. ${s["support.replyTime"]} You'll get the reply here and by email.`} />
      <Card>
        <CardBody>
          <ActionForm action={contactSupportAction} className="space-y-4" successMessage={false}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Topic">
                <Select name="topic" defaultValue={s["support.topics"][0]}>
                  {s["support.topics"].map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="About a shift? (optional)">
                <Select name="shiftId" defaultValue="">
                  <option value="">Not about a specific shift</option>
                  {shifts.map((sh) => <option key={sh.id} value={sh.id}>{dateLabel(sh.startsAt, sh.location.timeZone)} · {sh.location.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Subject"><Input name="subject" required maxLength={140} defaultValue={subject ?? ""} placeholder="A few words about what you need" /></Field>
            <Field label="How can we help?">
              <Textarea name="body" required minLength={5} maxLength={4000} rows={6} placeholder="What happened, and what you'd like us to do." />
              <PhiNotice />
            </Field>
            <SubmitButton pendingText="Sending…">Send to our team</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
      <Card className="mt-6" id="requests">
        <CardHeader title="My requests" />
        {mine.length ? (
          <ul className="divide-y divide-slate-100">
            {mine.map((r) => (
              <li key={r.id}>
                <Link href={`${center.base}/requests/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-900">{r.subject}</div>
                    <div className="text-xs text-slate-500">{r.topic} · {r._count.messages} message{r._count.messages === 1 ? "" : "s"} · {relative(r.lastMessageAt)}</div>
                  </div>
                  <Badge tone={STATUS[r.status]?.tone ?? "gray"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <CardBody><p className="text-sm text-slate-500">No requests yet.</p></CardBody>
        )}
      </Card>
    </div>
  );
}

export async function HelpRequest({ center, actor, id, sent }: { center: HelpCenter; actor: Actor; id: string; sent?: boolean }) {
  const r = await support.myRequest(actor, id).catch(() => null);
  if (!r) notFound();
  const s = await getSettings();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`${center.base}/contact#requests`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" />
        My requests
      </Link>
      <PageHeader title={r.subject} description={`${r.topic} · opened ${dateLabel(r.createdAt)}`} actions={<Badge tone={STATUS[r.status]?.tone ?? "gray"}>{STATUS[r.status]?.label ?? r.status}</Badge>} />
      {sent ? <Alert tone="success" className="mb-4">Sent. {s["support.replyTime"]} We&apos;ll email you when we reply.</Alert> : null}
      <div className="space-y-3">
        {r.messages.map((m) => (
          <div key={m.id} className={m.fromStaff ? "mr-8 rounded-2xl border border-brand-200 bg-brand-50/60 p-4" : "ml-8 rounded-2xl border border-slate-200 bg-white p-4"}>
            <div className="mb-1 text-xs font-medium text-slate-500">{m.fromStaff ? `${brand().name} support` : "You"} · {relative(m.createdAt)}</div>
            <p className="whitespace-pre-line text-sm text-slate-800">{m.body}</p>
          </div>
        ))}
      </div>
      <Card className="mt-6">
        <CardBody className="space-y-3">
          <ActionForm action={supportReplyAction} className="space-y-3" resetOnSuccess>
            <input type="hidden" name="id" value={r.id} />
            <Field label={r.status === "CLOSED" ? "Reply to reopen" : "Reply"}>
              <Textarea name="body" required minLength={5} maxLength={4000} rows={4} />
              <PhiNotice />
            </Field>
            <SubmitButton>Send reply</SubmitButton>
          </ActionForm>
          {r.status !== "CLOSED" ? (
            <ActionForm action={supportCloseAction}>
              <input type="hidden" name="id" value={r.id} />
              <SubmitButton variant="ghost" size="sm">My question is answered, close it</SubmitButton>
            </ActionForm>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

