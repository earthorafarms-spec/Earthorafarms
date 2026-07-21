export function ProductCardSkeleton() {
  return (
    <div className="bg-card rounded-xl border border-border/60 overflow-hidden flex flex-col animate-pulse">
      <div className="aspect-square bg-muted" />
      <div className="p-5 flex flex-col gap-3">
        <div className="h-3 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/2" />
        <div className="h-6 bg-muted rounded w-1/3" />
        <div className="flex gap-2 mt-2">
          <div className="flex-1 h-10 bg-muted rounded-lg" />
          <div className="flex-1 h-10 bg-muted rounded-lg" />
        </div>
      </div>
    </div>
  );
}
