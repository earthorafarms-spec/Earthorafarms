import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Leaf, Eye, EyeOff, Mail, Lock, User, ArrowUpRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import leavesImg from "@assets/generated_images/hero_leaves_2.jpg";

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) {
      const redirectPath = sessionStorage.getItem("post_auth_redirect") || "/";
      sessionStorage.removeItem("post_auth_redirect");
      setLocation(redirectPath);
    }
  }, [user, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        toast({ title: "Signed in", description: "Welcome back to Earthora Farms." });
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { name: fullName.trim() },
          },
        });
        if (error) throw error;

        const { error: dbError } = await (supabase.from("User_details") as any)
          .upsert(
            {
              user_email: email.trim(),
              user_name: fullName.trim(),
            },
            { onConflict: "user_email" }
          );

        if (dbError) {
          console.warn("User profile details note:", dbError.message);
        }

        toast({
          title: "Account created",
          description: "Check your email if confirmation is enabled, or log in.",
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Authentication failed.";
      setFormError(message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (loginState: boolean) => {
    setIsLogin(loginState);
    setFormError("");
  };

  return (
    <div className="min-h-[100dvh] w-full flex bg-[#0E0E0E] text-white selection:bg-white selection:text-black relative overflow-hidden">
      {/* ── Left Ambient Artwork Column (Desktop) ── */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-12 lg:p-16 border-r border-white/10">
        <div className="absolute inset-0 z-0">
          <img
            src={leavesImg}
            alt="Moringa Leaves"
            className="w-full h-full object-cover opacity-40 scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0E0E0E] via-[#0E0E0E]/60 to-transparent" />
        </div>

        <div className="relative z-10">
          <Link href="/">
            <div className="inline-flex items-center gap-2 cursor-pointer">
              <div className="w-9 h-9 rounded-full bg-emerald-700 flex items-center justify-center">
                <Leaf className="w-5 h-5 text-white" />
              </div>
              <span className="font-dm font-medium text-2xl tracking-[-0.05em] text-white">
                Earthora
              </span>
            </div>
          </Link>
        </div>

        <div className="relative z-10 max-w-lg">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="font-dm font-normal text-4xl lg:text-5xl text-white tracking-[-0.04em] leading-tight mb-4"
          >
            The ancient tree of life. <br />
            <span className="text-white/40">Reimagined for you.</span>
          </motion.h2>
          <p className="font-inter font-normal text-base text-white/60 leading-relaxed">
            Create an account to track your botanical orders, save favorite wellness products, and receive exclusive harvest updates.
          </p>
        </div>

        <div className="relative z-10 font-inter text-xs text-white/30">
          © {new Date().getFullYear()} Earthora Farms Pvt. Ltd. All rights reserved.
        </div>
      </div>

      {/* ── Right Form Column ── */}
      <div className="w-full lg:w-1/2 flex flex-col justify-between p-6 sm:p-12 lg:p-16 bg-[#FAF9F5] text-black">
        <div className="flex items-center justify-between w-full">
          <Link href="/">
            <div className="inline-flex items-center gap-2 cursor-pointer lg:hidden">
              <div className="w-8 h-8 rounded-full bg-emerald-700 flex items-center justify-center">
                <Leaf className="w-4 h-4 text-white" />
              </div>
              <span className="font-dm font-medium text-xl text-black">Earthora</span>
            </div>
          </Link>

          <Link href="/" className="ml-auto">
            <span className="inline-flex items-center gap-1 font-inter text-sm font-medium text-black/60 hover:text-black transition-colors cursor-pointer">
              <span>Return Home</span>
              <ArrowUpRight className="w-4 h-4" />
            </span>
          </Link>
        </div>

        <div className="my-auto max-w-md w-full mx-auto py-8">
          <div className="mb-8">
            <h1 className="font-dm font-normal text-4xl text-black tracking-[-0.04em] mb-2">
              {isLogin ? "Welcome back" : "Create account"}
            </h1>
            <p className="font-inter text-sm text-black/60">
              {isLogin
                ? "Sign in to manage orders and explore your wellness journey."
                : "Join the community and harvest the pure energy of Moringa."}
            </p>
          </div>

          {/* Toggle pill */}
          <div className="bg-[#ECEDEC] rounded-xl p-1 mb-8 flex border border-black/5">
            <button
              type="button"
              onClick={() => switchMode(true)}
              className={`flex-1 py-2.5 font-inter text-sm font-medium rounded-lg transition-all ${
                isLogin ? "bg-[#FEFDF9] text-black shadow-sm" : "text-black/50 hover:text-black"
              }`}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => switchMode(false)}
              className={`flex-1 py-2.5 font-inter text-sm font-medium rounded-lg transition-all ${
                !isLogin ? "bg-[#FEFDF9] text-black shadow-sm" : "text-black/50 hover:text-black"
              }`}
            >
              Sign Up
            </button>
          </div>

          {formError && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-inter text-sm">
              {formError}
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.form
              key={isLogin ? "login" : "signup"}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              onSubmit={handleSubmit}
              className="space-y-5"
            >
              {!isLogin && (
                <div>
                  <label className="font-inter text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
                    <input
                      type="text"
                      required
                      placeholder="Jane Doe"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl pl-11 pr-4 py-3 font-inter text-sm text-black placeholder:text-black/30 focus:outline-none focus:border-black/30 transition-colors"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="font-inter text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
                  <input
                    type="email"
                    required
                    placeholder="jane@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl pl-11 pr-4 py-3 font-inter text-sm text-black placeholder:text-black/30 focus:outline-none focus:border-black/30 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="font-inter text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl pl-11 pr-12 py-3 font-inter text-sm text-black placeholder:text-black/30 focus:outline-none focus:border-black/30 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-black/30 hover:text-black"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-black text-white py-4 rounded-xl font-inter font-medium text-base hover:bg-black/85 transition-colors shadow-lg flex items-center justify-center gap-2 group disabled:opacity-50 mt-4"
              >
                <span>{loading ? "Processing..." : isLogin ? "Log In" : "Create Account"}</span>
                <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
            </motion.form>
          </AnimatePresence>
        </div>

        <div className="text-center font-inter text-xs text-black/40">
          By signing in, you agree to our Terms of Use and Privacy Policy.
        </div>
      </div>
    </div>
  );
}
