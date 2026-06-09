// Suspense fallback for /recipe/[id]. Required by cacheComponents.
// Mirrors the basic shape of the detail page (back link, title, meta,
// ingredient list, instructions) so the transition feels smooth instead
// of flashing empty.
export default function Loading() {
  return (
    <article className="space-y-8 animate-pulse">
      <div className="h-6 w-32 rounded-md bg-card" />
      <header className="space-y-4 -mt-4">
        <div className="h-10 w-3/4 bg-card rounded" />
        <div className="flex gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-5 w-16 rounded-full bg-card" />
          ))}
        </div>
      </header>
      <section className="space-y-4">
        <div className="border-t border-border pt-3">
          <div className="h-4 w-32 bg-card rounded" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-4 w-full bg-card rounded" />
          ))}
        </div>
      </section>
    </article>
  );
}
