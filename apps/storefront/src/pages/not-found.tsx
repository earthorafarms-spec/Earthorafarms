import { motion } from "framer-motion";
import { Link } from "wouter";
import { AlertCircle, ArrowLeft, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0E0E0E] text-white p-6 relative overflow-hidden selection:bg-white selection:text-black">
      {/* Background radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06)_0,transparent_75%)] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-md w-full bg-[#181818] border border-white/10 rounded-3xl p-8 sm:p-10 text-center shadow-2xl relative z-10"
      >
        <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/15 text-amber-300 flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8" />
        </div>

        <span className="font-dm font-normal text-6xl text-white tracking-[-0.05em] block mb-2">
          404
        </span>

        <h1 className="font-dm font-normal text-2xl text-white tracking-[-0.03em] mb-3">
          Page Not Found
        </h1>

        <p className="font-inter font-normal text-sm text-white/60 leading-relaxed mb-8">
          The page you are looking for doesn't exist or has been moved to another botanical path.
        </p>

        <Link
          href="/"
          className="w-full bg-white text-black py-4 rounded-xl font-inter font-medium text-sm hover:bg-white/90 transition-colors shadow-lg inline-flex items-center justify-center gap-2 group"
        >
          <Home className="w-4 h-4" />
          <span>Return To Homepage</span>
        </Link>
      </motion.div>
    </div>
  );
}
