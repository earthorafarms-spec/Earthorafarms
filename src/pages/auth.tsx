import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Leaf, Eye, EyeOff, Mail, Lock, User, Check, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import leavesImg from "@assets/generated_images/hero_leaves_2.jpg";

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="min-h-[100dvh] flex bg-background text-foreground selection:bg-primary/20 overflow-hidden">
      
      {/* Brand Visual Column - Left (hidden on mobile/tablet) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-primary items-center justify-center p-12">
        <div className="absolute inset-0 z-0">
          <img 
            src={leavesImg} 
            alt="Moringa Leaves" 
            className="w-full h-full object-cover opacity-30 scale-105 filter blur-[2px]"
          />
          <div className="absolute inset-0 bg-gradient-to-tr from-primary via-primary/95 to-transparent mix-blend-multiply" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08)_0,transparent_60%)]" />
        </div>

        <div className="relative z-10 max-w-lg w-full space-y-12">
          {/* Logo / Brand Header */}
          <Link href="/">
            <div className="inline-flex items-center gap-3 cursor-pointer group">
              <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 transition-transform duration-500 group-hover:rotate-12">
                <Leaf className="w-6 h-6 text-secondary" strokeWidth={1.5} />
              </div>
              <span className="font-serif text-2xl text-white tracking-wide">Earthora Farms</span>
            </div>
          </Link>

          {/* Testimonial or USP Card */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-2xl relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full blur-xl pointer-events-none" />
            <h2 className="text-3xl font-serif text-white leading-snug mb-6">
              Empowering wellness, <br />
              <span className="text-secondary italic">directly from our roots.</span>
            </h2>
            <div className="space-y-4 text-white/80 font-light text-sm">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-secondary/20 flex items-center justify-center text-secondary">
                  <Check className="w-3 h-3" />
                </div>
                <span>100% Pure, Organic Moringa Wellness</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-secondary/20 flex items-center justify-center text-secondary">
                  <Check className="w-3 h-3" />
                </div>
                <span>Directly sourced from solar-powered farms</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-secondary/20 flex items-center justify-center text-secondary">
                  <Check className="w-3 h-3" />
                </div>
                <span>Eco-friendly, sustainable processing methods</span>
              </div>
            </div>
          </motion.div>
          
          <p className="text-white/40 text-xs font-light tracking-wider uppercase">
            © 2026 Earthora Farms PVT LTD. All rights reserved.
          </p>
        </div>
      </div>

      {/* Form Interaction Column - Right */}
      <div className="w-full lg:w-1/2 flex flex-col justify-between py-12 px-6 sm:px-12 md:px-20 lg:px-16 xl:px-24 bg-card/40 backdrop-blur-sm border-l border-border/10 relative">
        
        {/* Floating Top Header for Mobile */}
        <div className="flex items-center justify-between lg:justify-end w-full">
          <Link href="/">
            <div className="inline-flex items-center gap-2 cursor-pointer lg:hidden">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Leaf className="w-4.5 h-4.5 text-primary" strokeWidth={1.5} />
              </div>
              <span className="font-serif text-lg text-foreground tracking-wide">Earthora</span>
            </div>
          </Link>
          <Link href="/">
            <span className="inline-flex items-center gap-1.5 text-sm text-foreground/50 hover:text-primary transition-colors cursor-pointer font-medium">
              Go to Home Page
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </Link>
        </div>

        {/* Core Form Card */}
        <div className="my-auto max-w-md w-full mx-auto py-12">
          <div className="mb-8">
            <h1 className="text-4xl font-serif text-foreground mb-3 tracking-tight">
              {isLogin ? "Welcome back" : "Create account"}
            </h1>
            <p className="text-foreground/50 font-light text-sm">
              {isLogin
                ? "Sign in to manage orders and explore your wellness journey."
                : "Join the community & harvest the pure energy of Moringa."}
            </p>
          </div>

          {/* Toggle Switcher */}
          <div className="bg-muted/70 rounded-xl p-1 mb-8 flex border border-border/20">
            <button
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-300 ${
                isLogin ? "bg-card text-foreground shadow-sm" : "text-foreground/50 hover:text-foreground"
              }`}
            >
              Log In
            </button>
            <button
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-300 ${
                !isLogin ? "bg-card text-foreground shadow-sm" : "text-foreground/50 hover:text-foreground"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Animate Form Switching */}
          <AnimatePresence mode="wait">
            <motion.form
              key={isLogin ? "login" : "signup"}
              initial={{ opacity: 0, x: isLogin ? -10 : 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isLogin ? 10 : -10 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              onSubmit={(e) => e.preventDefault()}
              className="space-y-5"
            >
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" strokeWidth={1.5} />
                    <Input 
                      id="fullName" 
                      placeholder="Jane Doe" 
                      className="h-12 pl-11 bg-background/50 border-border/50 focus-visible:ring-primary/20" 
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="authEmail">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" strokeWidth={1.5} />
                  <Input 
                    id="authEmail" 
                    type="email" 
                    placeholder="jane@example.com" 
                    className="h-12 pl-11 bg-background/50 border-border/50 focus-visible:ring-primary/20" 
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="authPassword">Password</Label>
                  {isLogin && (
                    <a href="#" className="text-xs text-primary hover:text-accent font-medium transition-colors">
                      Forgot password?
                    </a>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" strokeWidth={1.5} />
                  <Input
                    id="authPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    className="h-12 pl-11 pr-11 bg-background/50 border-border/50 focus-visible:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/60 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full h-12 text-base shadow-sm hover:shadow transition-all duration-300 mt-2">
                {isLogin ? "Sign In" : "Register"}
              </Button>
            </motion.form>
          </AnimatePresence>

          <div className="mt-8 pt-6 border-t border-border/40">
            <p className="text-xs text-center text-foreground/40 font-light leading-relaxed">
              By continuing, you agree to our{" "}
              <a href="#" className="text-primary/80 hover:text-accent font-medium transition-colors">Terms of Service</a>{" "}
              and{" "}
              <a href="#" className="text-primary/80 hover:text-accent font-medium transition-colors">Privacy Policy</a>.
            </p>
          </div>
        </div>

        {/* Footer for Mobile/Desktop Right side */}
        <div className="text-center lg:hidden">
          <p className="text-[10px] text-foreground/30 font-light">
            © 2026 Earthora Farms PVT LTD.
          </p>
        </div>
        <div className="hidden lg:block" />
        
      </div>
    </div>
  );
}