// Minimal Suspense fallback for /. Required by cacheComponents so the
// page's uncached data access (getFilterFacets, listRecipesForSection)
// has a boundary above it. Shows only on first cold load — once
// Activity caches the rendered home page, back-navigation reuses the
// cached DOM and never displays this skeleton.
export default function Loading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-20 rounded-full border border-border bg-card"
          />
        ))}
      </div>
      <div className="space-y-3">
        <div className="border-t border-border pt-3 space-y-1">
          <div className="h-4 w-40 bg-card rounded" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-32 rounded-md border border-border bg-card"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
