import { youtubeId } from "@/lib/academy/types";

/** Unlisted YouTube walkthrough for a lesson; IDs come from the academy.videos setting. Renders nothing until one is set. */
export function LessonVideo({ value, title }: { value: string | undefined; title: string }) {
  const id = youtubeId(value);
  if (!id) return null;
  return (
    <div className="mb-6 aspect-video overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 shadow-card">
      <iframe
        className="size-full"
        src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`}
        title={`${title} — video`}
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}
