import { Leaf } from "lucide-react";

const CLAIMS = [
  "100% Organic",
  "90+ Nutrients",
  "46× Antioxidants",
  "Zero Additives",
  "Volcanic Soil Grown",
  "Non-GMO",
  "Vegan",
  "Ayurvedic Heritage",
];

export function HomeMarquee() {
  const track = [...CLAIMS, ...CLAIMS, ...CLAIMS];
  return (
    <section className="bg-[#0E0E0E] text-white py-5 overflow-hidden border-y border-white/10">
      <div
        className="flex whitespace-nowrap animate-[marquee_38s_linear_infinite]"
        style={{ willChange: "transform" }}
      >
        {track.map((claim, i) => (
          <div key={`${claim}-${i}`} className="flex items-center gap-6 px-6 shrink-0">
            <span className="font-dm text-base sm:text-lg tracking-[-0.01em] text-white/90">
              {claim}
            </span>
            <Leaf className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          </div>
        ))}
      </div>

      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-33.3333%); }
        }
      `}</style>
    </section>
  );
}
