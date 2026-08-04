import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Cookie, Shield, Check, Settings, Save, AlertCircle } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useToast } from "@/hooks/use-toast";

export default function CookieSettings() {
  const { toast } = useToast();
  
  const [preferences, setPreferences] = useState({
    essential: true, // Always required
    analytics: true,
    functional: true,
    marketing: false,
  });

  useEffect(() => {
    const saved = localStorage.getItem("earthora_cookie_preferences");
    if (saved) {
      try {
        setPreferences((prev) => ({ ...prev, ...JSON.parse(saved) }));
      } catch (e) {
        console.error("Failed to parse cookie preferences", e);
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem("earthora_cookie_preferences", JSON.stringify(preferences));
    toast({
      title: "Preferences Saved",
      description: "Your cookie settings have been updated successfully.",
    });
  };

  const handleAcceptAll = () => {
    const all = { essential: true, analytics: true, functional: true, marketing: true };
    setPreferences(all);
    localStorage.setItem("earthora_cookie_preferences", JSON.stringify(all));
    toast({
      title: "All Cookies Accepted",
      description: "Thank you! All cookie categories are now enabled.",
    });
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
            <Cookie className="w-3.5 h-3.5 text-emerald-400" />
            <span>Privacy Controls</span>
          </motion.div>

          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="lg:col-span-8"
            >
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[42px] leading-[44px] sm:text-[66px] sm:leading-[62px] lg:text-[84px] lg:leading-[78px] text-white">
                Manage your cookie <br />
                <span className="text-white/35">preferences.</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="lg:col-span-4 font-inter font-normal text-base sm:text-lg text-white/55 leading-relaxed tracking-[-0.02em]"
            >
              We use cookies to personalize your shopping experience, preserve cart items, and analyze site performance.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── Cookie Toggles Content ── */}
      <section className="py-20 lg:py-28">
        <div className="container mx-auto px-6 sm:px-10 max-w-[900px]">
          
          <div className="bg-[#FEFDF9] p-8 sm:p-12 rounded-3xl border border-black/5 space-y-8 shadow-xs">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-black/10">
              <div>
                <h2 className="font-dm text-2xl text-black tracking-[-0.03em]">Cookie Categories</h2>
                <p className="font-inter text-xs text-black/50">Toggle individual categories to suit your preference</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  className="px-4 py-2.5 rounded-xl border border-black/15 font-inter text-xs font-medium text-black hover:bg-black/5 transition-colors"
                >
                  Accept All
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="px-5 py-2.5 rounded-xl bg-black text-white font-inter text-xs font-medium hover:bg-black/85 transition-colors flex items-center gap-2"
                >
                  <Save className="w-3.5 h-3.5" /> Save Preferences
                </button>
              </div>
            </div>

            {/* Essential Cookies */}
            <div className="p-6 rounded-2xl bg-[#FAF9F5] border border-black/5 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-dm text-lg text-black font-medium">Strictly Necessary Cookies</h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-black/10 text-black/70">Required</span>
                </div>
                <p className="font-inter text-xs sm:text-sm text-black/60 leading-relaxed">
                  Essential for core website functionality, secure checkout authentication, and cart state preservation. These cannot be disabled.
                </p>
              </div>
              <div className="w-12 h-6 rounded-full bg-emerald-800 p-1 flex items-center justify-end shrink-0 cursor-not-allowed">
                <div className="w-4 h-4 rounded-full bg-white shadow-xs" />
              </div>
            </div>

            {/* Performance & Analytics */}
            <div className="p-6 rounded-2xl bg-[#FAF9F5] border border-black/5 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="font-dm text-lg text-black font-medium">Performance & Analytics</h3>
                <p className="font-inter text-xs sm:text-sm text-black/60 leading-relaxed">
                  Helps us measure site traffic, popular moringa recipe views, and checkout performance to continuously improve your browsing experience.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreferences({ ...preferences, analytics: !preferences.analytics })}
                className={`w-12 h-6 rounded-full p-1 flex items-center transition-colors shrink-0 ${
                  preferences.analytics ? "bg-emerald-800 justify-end" : "bg-black/20 justify-start"
                }`}
              >
                <div className="w-4 h-4 rounded-full bg-white shadow-xs" />
              </button>
            </div>

            {/* Functional Cookies */}
            <div className="p-6 rounded-2xl bg-[#FAF9F5] border border-black/5 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="font-dm text-lg text-black font-medium">Functional & Personalization</h3>
                <p className="font-inter text-xs sm:text-sm text-black/60 leading-relaxed">
                  Remembers your country selection and preferred language (English, Hindi, Gujarati).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreferences({ ...preferences, functional: !preferences.functional })}
                className={`w-12 h-6 rounded-full p-1 flex items-center transition-colors shrink-0 ${
                  preferences.functional ? "bg-emerald-800 justify-end" : "bg-black/20 justify-start"
                }`}
              >
                <div className="w-4 h-4 rounded-full bg-white shadow-xs" />
              </button>
            </div>

          </div>

        </div>
      </section>

      <Footer />
    </div>
  );
}
