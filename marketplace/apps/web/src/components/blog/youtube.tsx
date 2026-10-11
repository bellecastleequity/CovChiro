/** A YouTube video, embedded through youtube-nocookie.com (no tracking cookies until it's played). */
export function YouTubeEmbed({ id, title, className }: { id: string; title: string; className?: string }) {
  return (
    <div className={`aspect-video overflow-hidden rounded-2xl bg-slate-900 shadow-sm ${className ?? ""}`}>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`}
        title={title}
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        className="size-full border-0"
      />
    </div>
  );
}
