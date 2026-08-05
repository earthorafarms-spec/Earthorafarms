import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import {
  HelpCircle,
  Search,
  ChevronDown,
  Sparkles,
  Leaf,
  Truck,
  ShieldCheck,
  Phone,
  MessageCircle,
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

interface FAQItem {
  category: "product" | "health" | "shipping" | "orders";
  question: string;
  answer: string;
}

const faqData: FAQItem[] = [
  // Product & Usage
  {
    category: "product",
    question: "What makes Earthora Moringa different from ordinary green powders?",
    answer: "Earthora Moringa is 100% single-origin, shade-dried, and stone-ground at low temperatures directly on our Aptos farm. Unlike mass-manufactured heat-processed powders, our cold-processing preserves raw enzymes, chlorophyll, and 90+ bioavailable nutrients without added fillers or anti-caking agents.",
  },
  {
    category: "product",
    question: "What is the recommended daily dosage for Moringa Powder and Tablets?",
    answer: "For Earthora Moringa Powder: Take 1 teaspoon (approx 3-5g) daily mixed into smoothies, warm water, juice, or warm meals. For Earthora Pressed Tablets: Take 2 tablets (1000mg total) daily with water, preferably after breakfast or lunch.",
  },
  {
    category: "product",
    question: "Do your pressed tablets contain synthetic binders or magnesium stearate?",
    answer: "No, absolutely not. Our tablets are high-pressure pressed using 100% pure shade-dried moringa leaf powder with zero synthetic binders, fillers, lubricants, or coatings.",
  },
  {
    category: "product",
    question: "How should I store Earthora Moringa products to maintain freshness?",
    answer: "Store your resealable pouch or glass tablet jar in a cool, dry place away from direct sunlight. Ensure the zipper seal is completely pressed shut after each use. No refrigeration required.",
  },

  // Health Benefits
  {
    category: "health",
    question: "How long before I start feeling the health benefits of Moringa?",
    answer: "Most customers report noticeable improvements in daily sustained energy, digestive clarity, and mental focus within 5 to 7 days of consistent daily use. Long-term cellular and immune benefits accumulate after 3-4 weeks.",
  },
  {
    category: "health",
    question: "Does Earthora Moringa contain caffeine?",
    answer: "No! Moringa is naturally 100% caffeine-free. Its natural energy boost comes from high cellular bioavailability of Iron, B-complex vitamins, Magnesium, and essential amino acids that support natural ATP synthesis without jitters or crashes.",
  },
  {
    category: "health",
    question: "Is Earthora Moringa safe during pregnancy or breastfeeding?",
    answer: "While moringa leaf powder is a nutrient-dense food traditionally consumed by mothers, we recommend consulting your healthcare practitioner before introducing any new dietary supplement during pregnancy or lactation.",
  },

  // Shipping & Delivery
  {
    category: "shipping",
    question: "Do you offer free shipping across India?",
    answer: "Yes! We offer free standard express shipping on all prepaid orders across India with no minimum cart value required.",
  },
  {
    category: "shipping",
    question: "How fast will my order arrive?",
    answer: "Orders placed before 2:00 PM IST are dispatched the same day. Metro deliveries take 2–3 business days, tier-2 cities take 3–5 business days, and international shipments arrive within 5–9 business days.",
  },
  {
    category: "shipping",
    question: "Do you ship internationally?",
    answer: "Yes, we ship to over 30 countries globally via DHL Express and FedEx with real-time tracking.",
  },

  // Orders & Payment
  {
    category: "orders",
    question: "What payment methods do you accept?",
    answer: "We accept all major Credit/Debit Cards, UPI (GPay, PhonePe, Paytm), NetBanking, and Razorpay Payment Links across India.",
  },
  {
    category: "orders",
    question: "Can I modify or cancel my order after placing it?",
    answer: "Yes, you can modify or cancel your order anytime before dispatch (prior to 2:00 PM IST). You can cancel through your account dashboard or by contacting our support team.",
  },
];

const categories = [
  { id: "all", label: "All Questions" },
  { id: "product", label: "Products & Usage" },
  { id: "health", label: "Health & Nutrition" },
  { id: "shipping", label: "Shipping & Delivery" },
  { id: "orders", label: "Orders & Payments" },
];

export default function FAQ() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const filteredFAQs = useMemo(() => {
    return faqData.filter((item) => {
      const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
      const matchesSearch =
        item.question.toLowerCase().includes(search.toLowerCase()) ||
        item.answer.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [search, selectedCategory]);

  const toggleAccordion = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
      <Navbar />

      {/* ── Page Hero Header ── */}
      <section className="relative pt-36 pb-20 lg:pt-44 lg:pb-28 bg-[#0E0E0E] text-white overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06)_0,transparent_70%)] pointer-events-none" />
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 font-dm font-medium text-xs sm:text-sm text-white/80 tracking-[0.05em] uppercase backdrop-blur-md"
          >
            <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>Knowledge Center</span>
          </motion.div>

          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="lg:col-span-8"
            >
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[42px] leading-[44px] sm:text-[66px] sm:leading-[62px] lg:text-[84px] lg:leading-[78px] text-white">
                Frequently Asked <br />
                <span className="text-white/35">Questions.</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="lg:col-span-4 font-inter font-normal text-base sm:text-lg text-white/55 leading-relaxed tracking-[-0.02em]"
            >
              Everything you need to know about our organic moringa harvesting process, nutrition claims, order shipping, and payments.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── Search & Filter Pills ── */}
      <section className="py-10 border-b border-black/5 bg-[#FEFDF9] sticky top-[73px] z-30 backdrop-blur-md">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            
            {/* Category Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 scrollbar-none">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-4 py-2 rounded-full font-inter text-xs sm:text-sm font-medium whitespace-nowrap transition-all duration-200 ${
                    selectedCategory === cat.id
                      ? "bg-black text-white shadow-xs"
                      : "bg-[#FAF9F5] text-black/60 hover:text-black border border-black/5"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-black/40 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search questions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[#FAF9F5] border border-black/10 rounded-full pl-11 pr-4 py-2.5 font-inter text-xs sm:text-sm text-black placeholder:text-black/40 focus:outline-none focus:border-black/30 transition-colors"
              />
            </div>

          </div>
        </div>
      </section>

      {/* ── Accordion FAQ Grid ── */}
      <section className="py-16 lg:py-24">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1000px]">
          {filteredFAQs.length === 0 ? (
            <div className="text-center py-20 bg-[#FEFDF9] border border-black/5 rounded-3xl p-8">
              <HelpCircle className="w-12 h-12 text-black/20 mx-auto mb-4" />
              <h3 className="font-dm text-2xl text-black tracking-[-0.03em] mb-2">No matching questions found</h3>
              <p className="font-inter text-sm text-black/50 mb-6">Try adjusting your search terms or filter category.</p>
              <button
                onClick={() => { setSearch(""); setSelectedCategory("all"); }}
                className="px-5 py-2.5 rounded-xl bg-black text-white font-inter text-xs font-medium"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredFAQs.map((faq, idx) => {
                const isOpen = openIndex === idx;
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: idx * 0.03 }}
                    className="bg-[#FEFDF9] border border-black/5 rounded-2xl overflow-hidden shadow-xs hover:border-black/15 transition-colors"
                  >
                    <button
                      onClick={() => toggleAccordion(idx)}
                      className="w-full p-6 text-left flex items-center justify-between gap-4 select-none"
                    >
                      <span className="font-dm text-lg sm:text-xl font-normal text-black tracking-[-0.02em]">
                        {faq.question}
                      </span>
                      <div className={`w-8 h-8 rounded-full bg-[#FAF9F5] border border-black/5 flex items-center justify-center shrink-0 transition-transform duration-300 ${isOpen ? "rotate-180 bg-black text-white" : "text-black/60"}`}>
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        >
                          <div className="px-6 pb-6 pt-2 font-inter text-sm sm:text-base text-black/65 leading-relaxed border-t border-black/5 mt-1">
                            {faq.answer}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Contact Prompt ── */}
      <section className="py-20 bg-[#FEFDF9] border-t border-black/5 text-center">
        <div className="container mx-auto px-6 max-w-3xl">
          <div className="w-12 h-12 rounded-2xl bg-emerald-700 text-white flex items-center justify-center mx-auto mb-4">
            <MessageCircle className="w-6 h-6" />
          </div>
          <h2 className="font-dm text-3xl sm:text-4xl text-black tracking-[-0.04em] mb-3">
            Still have questions?
          </h2>
          <p className="font-inter text-sm sm:text-base text-black/60 leading-relaxed mb-8 max-w-xl mx-auto">
            Our farm customer care team is ready to help you with instant answers and order assistance.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/contact" className="px-6 py-3 rounded-xl bg-black text-white font-inter text-sm font-medium hover:bg-black/85 transition-colors">
              Contact Support
            </Link>
            <Link href="/our-product" className="px-6 py-3 rounded-xl border border-black/15 font-inter text-sm font-medium text-black hover:bg-black/5 transition-colors">
              Explore Our Products
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
