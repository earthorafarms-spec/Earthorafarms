export function ProductCardSkeleton() {
  return (
    <div className="bg-[#FEFDF9] rounded-2xl border border-black/5 overflow-hidden flex flex-col shadow-sm animate-pulse">
      <div className="aspect-square bg-[#ECEDEC]" />
      <div className="p-6 flex flex-col gap-3">
        <div className="h-3 bg-black/8 rounded-full w-24" />
        <div className="h-5 bg-black/8 rounded-full w-3/4" />
        <div className="h-3 bg-black/8 rounded-full w-1/3" />
        <div className="mt-2 pt-4 border-t border-black/5 flex items-center justify-between">
          <div className="h-7 bg-black/8 rounded-full w-20" />
          <div className="flex gap-2">
            <div className="w-10 h-10 bg-black/10 rounded-xl" />
            <div className="w-10 h-10 bg-black/5 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
