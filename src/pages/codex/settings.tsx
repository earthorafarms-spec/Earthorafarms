import { useState } from "react";
import { motion } from "framer-motion";
import {
  Lock, KeyRound, Loader2, CheckCircle2
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

export default function CodexSettings() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: "Validation failed", description: "All fields are required.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Validation failed", description: "New passwords do not match.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      // 1. Verify current password
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke("verify-codex", {
        body: { password: currentPassword },
      });
      if (verifyError || !verifyData?.ok) {
        throw new Error("Current developer password is incorrect.");
      }

      // 2. Write new password
      const { error: updateError } = await (supabase as any)
        .from("admin_settings")
        .upsert(
          { key: "codex_password", value: newPassword, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );
      if (updateError) throw updateError;

      // Update current session password
      sessionStorage.setItem("codex_password", newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Configuration Updated", description: "Developer access password successfully changed." });
    } catch (err: any) {
      toast({ title: "Password change failed", description: err.message || "An error occurred.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-8 font-mono">
      <div>
        <h1 className="text-2xl font-bold text-foreground font-serif">Console Settings</h1>
        <p className="text-xs text-foreground/45 mt-1">Configure access keys and developer configurations</p>
      </div>

      <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-foreground mb-5 flex items-center gap-2">
          <KeyRound className="w-4.5 h-4.5 text-primary" />
          Update Codex Access Password
        </h3>

        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-foreground/45">Current Password</label>
            <div className="relative">
              <input
                type="password"
                placeholder="••••••••"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading}
                className="w-full h-11 pl-10 pr-4 text-xs bg-[#fafaf8] border border-border/60 rounded-xl outline-none focus:border-primary/20 transition-all text-foreground placeholder:text-foreground/20 font-medium text-center"
              />
              <Lock className="w-3.5 h-3.5 text-foreground/35 absolute left-3.5 top-3.5" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-foreground/45">New Password</label>
              <div className="relative">
                <input
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  className="w-full h-11 pl-10 pr-4 text-xs bg-[#fafaf8] border border-border/60 rounded-xl outline-none focus:border-primary/20 transition-all text-foreground placeholder:text-foreground/20 font-medium text-center"
                />
                <Lock className="w-3.5 h-3.5 text-foreground/35 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-foreground/45">Confirm New Password</label>
              <div className="relative">
                <input
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  className="w-full h-11 pl-10 pr-4 text-xs bg-[#fafaf8] border border-border/60 rounded-xl outline-none focus:border-primary/20 transition-all text-foreground placeholder:text-foreground/20 font-medium text-center"
                />
                <Lock className="w-3.5 h-3.5 text-foreground/35 absolute left-3.5 top-3.5" />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-primary text-primary-foreground font-semibold text-xs rounded-xl flex items-center justify-center transition-all hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Verifying Configuration...</>
            ) : (
              <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Save Changes</>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
