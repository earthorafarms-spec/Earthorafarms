import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";

const FAQS = [
  {
    q: "What is Earthora Farms?",
    a: "Earthora Farms offers moringa leaf wellness products. Our live product collection shows what is available now, with current prices and product details.",
  },
  {
    q: "How does moringa support daily wellness?",
    a: "The current Morilife+ product description says its moringa leaf tablets are rich in antioxidants, vitamins and minerals, and are intended to support immunity, digestion, energy, skin, hair and overall wellness. Check the product page and label for ingredients and directions.",
  },
  {
    q: "Are your products organic and third-party tested?",
    a: "Check each product page and label for its current ingredients and certifications. If you need a batch-specific test report or certificate, please ask our team to confirm what is available before ordering.",
  },
  {
    q: "What's the best way to take moringa?",
    a: "For Morilife+ Moringa Leaf Tablets, the approved label says to take 1–2 tablets once or twice daily, before breakfast or dinner. Follow the product label and ask a healthcare professional if you need individual advice.",
  },
  {
    q: "Do you ship across India?",
    a: "See our Shipping Policy for current shipping terms. The stated delivery estimate across India is 7–14 business days.",
  },
];

export function HomeFAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="bg-[#FAF9F5] py-24 lg:py-32 relative overflow-hidden">
      <div className="container mx-auto max-w-[880px] px-6 sm:px-10">
        <div className="flex flex-col items-center text-center mb-12 lg:mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full border border-black/15 bg-white text-[10px] font-inter font-semibold tracking-[0.25em] uppercase text-black/60 mb-6">
            FAQ
          </span>
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="font-dm font-normal text-[42px] leading-[1.02] sm:text-[56px] sm:leading-[1.02] lg:text-[68px] lg:leading-[0.98] tracking-[-0.04em] text-black"
          >
            Got <em className="not-italic text-black/45">questions?</em>
          </motion.h2>
        </div>

        <div className="space-y-3">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <motion.div
                key={f.q}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, delay: i * 0.04 }}
                className="bg-[#FEFDF9] rounded-2xl border border-black/8 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center justify-between text-left px-6 py-5 gap-5 hover:bg-black/[0.02] transition-colors"
                >
                  <span className="font-inter font-semibold text-base text-black">
                    {f.q}
                  </span>
                  <span
                    className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                      isOpen
                        ? "bg-[#2E5B32] text-white rotate-45"
                        : "bg-white border border-black/15 text-black"
                    }`}
                  >
                    <Plus className="w-4 h-4" />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="px-6 pb-6 font-inter text-sm leading-relaxed text-black/70 max-w-[64ch]">
                        {f.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
