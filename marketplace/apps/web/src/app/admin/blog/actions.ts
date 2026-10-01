"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { blog } from "@cm/services";
import { formAction as baseFormAction, str } from "@/lib/action";
import { requireActor } from "@/lib/session";

const me = () => requireActor("admin");
const formAction: typeof baseFormAction = (fn) => baseFormAction(fn, { technical: true });
const rv = (slug?: string) => {
  revalidatePath("/admin/blog", "layout");
  revalidatePath("/blog");
  if (slug) revalidatePath(`/blog/${slug}`);
};

export const draftAction = formAction(async (fd) => {
  const { actor } = await me();
  const { post } = await blog.draftPost(actor, { topic: str(fd, "topic"), audience: str(fd, "audience"), keywords: str(fd, "keywords"), notes: str(fd, "notes") });
  rv();
  redirect(`/admin/blog/${post.id}?drafted=1`);
});

export const suggestAction = formAction(async (fd) => {
  const { actor } = await me();
  const topics = await blog.suggestTopics(actor, str(fd, "audience"));
  return { ok: `${topics.length} ideas. Pick one to draft.`, data: topics };
});

export const newPostAction = formAction(async (fd) => {
  const { actor } = await me();
  const post = await blog.createPost(actor, { title: str(fd, "title") });
  rv();
  redirect(`/admin/blog/${post.id}`);
});

export const savePostAction = formAction(async (fd) => {
  const { actor } = await me();
  const post = await blog.savePost(actor, str(fd, "id"), {
    title: str(fd, "title"), slug: str(fd, "slug"), description: str(fd, "description"), body: str(fd, "body"), audience: str(fd, "audience"), keywords: str(fd, "keywords"),
  });
  rv(post.slug);
  return "Saved.";
});

export const publishPostAction = formAction(async (fd) => {
  const { actor } = await me();
  const post = await blog.publishPost(actor, str(fd, "id"));
  rv(post.slug);
  return `Published at /blog/${post.slug}.`;
});

export const statusPostAction = formAction(async (fd) => {
  const { actor } = await me();
  const status = str(fd, "status") === "ARCHIVED" ? "ARCHIVED" : "DRAFT";
  const post = await blog.setPostStatus(actor, str(fd, "id"), status);
  rv(post.slug);
  return status === "ARCHIVED" ? "Archived." : "Unpublished; it's a draft again.";
});

export const deletePostAction = formAction(async (fd) => {
  const { actor } = await me();
  await blog.deletePost(actor, str(fd, "id"));
  rv();
  redirect("/admin/blog");
});
