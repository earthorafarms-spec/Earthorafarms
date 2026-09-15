export function PageSkeleton() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black animate-pulse">
      {/* Header Bar Skeleton */}
      <div className="h-20 w-full bg-[#FEFDF9] border-b border-black/5" />

      {/* Hero Banner Skeleton */}
      <div className="pt-32 pb-20 bg-[#0E0E0E] px-6 sm:px-10">
        <div className="max-w-[1400px] mx-auto space-y-4">
          <div className="h-6 w-36 bg-white/10 rounded-full" />
          <div className="h-16 sm:h-24 w-3/4 bg-white/15 rounded-2xl" />
          <div className="h-4 w-1/2 bg-white/10 rounded-lg" />
        </div>
      </div>

      {/* Main Content Grid Skeleton */}
      <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] py-16 space-y-8 flex-1">
        <div className="flex justify-between items-center pb-6 border-b border-black/5">
          <div className="h-8 w-48 bg-black/8 rounded-xl" />
          <div className="h-10 w-32 bg-black/5 rounded-xl" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-[#FEFDF9] rounded-2xl border border-black/5 p-6 space-y-4">
              <div className="aspect-video bg-black/5 rounded-xl" />
              <div className="h-5 bg-black/8 rounded-lg w-2/3" />
              <div className="h-3 bg-black/5 rounded-lg w-full" />
              <div className="h-3 bg-black/5 rounded-lg w-4/5" />
            </div>
          ))}
        </div>
      </div>

      {/* Footer Skeleton */}
      <div className="h-48 w-full bg-[#0F2318] border-t border-white/5" />
    </div>
  );
}
