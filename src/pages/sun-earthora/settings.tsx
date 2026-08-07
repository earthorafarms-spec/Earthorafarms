import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, Eye, EyeOff, Shield, Check, X, Loader2, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

export default function AdminSettings() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const { toast } = useToast();

  const canSave = currentPassword && newPassword && confirmPassword && newPassword === confirmPassword && newPassword.length >= 6;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    setSaving(true);
    setSuccess(false);

    try {
      const { data, error } = await supabase.functions.invoke("update-admin-password", {
        body: { currentPassword, newPassword },
      });

      if (error) throw error;

      if (data?.ok) {
        setSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        toast({ title: "Password updated", description: "Your admin portal password has been changed successfully." });
      } else {
        toast({ title: "Update failed", description: data?.error || "Could not update password.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to connect to server.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      key="settings"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-2xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-lg font-serif font-bold text-foreground">Settings</h2>
        <p className="text-sm text-foreground/45 mt-1">Manage your admin portal security and preferences.</p>
      </div>

      <div className="bg-white rounded-2xl border border-border/30 overflow-hidden shadow-sm">
        <div className="p-1.5">
          <div className="rounded-[calc(1rem-0.375rem)] bg-white">
            <div className="flex items-center gap-3 px-6 pt-6 pb-5 border-b border-border/10">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Admin Portal Password</h3>
                <p className="text-xs text-foreground/40 mt-0.5">Change the password used to access the admin panel.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Current password */}
              <div>
                <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">Current Password</label>
                <div className="relative group">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20" strokeWidth={1.5} />
                  <input
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => { setCurrentPassword(e.target.value); setSuccess(false); }}
                    placeholder="Enter current password"
                    className="w-full h-12 pl-10 pr-11 text-sm bg-white border-2 border-transparent rounded-xl outline-none ring-1 ring-border/40 focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-foreground/20 group-hover:ring-border/60"
                  />
                  <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground/25 hover:text-foreground/50 transition-colors">
                    {showCurrent ? <EyeOff className="w-4 h-4" strokeWidth={1.5} /> : <Eye className="w-4 h-4" strokeWidth={1.5} />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div>
                <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">New Password</label>
                <div className="relative group">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20" strokeWidth={1.5} />
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setSuccess(false); }}
                    placeholder="At least 6 characters"
                    className="w-full h-12 pl-10 pr-11 text-sm bg-white border-2 border-transparent rounded-xl outline-none ring-1 ring-border/40 focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-foreground/20 group-hover:ring-border/60"
                  />
                  <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground/25 hover:text-foreground/50 transition-colors">
                    {showNew ? <EyeOff className="w-4 h-4" strokeWidth={1.5} /> : <Eye className="w-4 h-4" strokeWidth={1.5} />}
                  </button>
                </div>
                {newPassword && newPassword.length > 0 && newPassword.length < 6 && (
                  <p className="text-[11px] text-red-400 mt-1.5 flex items-center gap-1">
                    <X className="w-3 h-3" strokeWidth={2} /> Minimum 6 characters
                  </p>
                )}
                {newPassword && newPassword.length >= 6 && (
                  <p className="text-[11px] text-emerald-500 mt-1.5 flex items-center gap-1">
                    <Check className="w-3 h-3" strokeWidth={2} /> Strong enough
                  </p>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label className="text-[11px] font-semibold text-foreground/50 uppercase tracking-widest mb-2 block">Confirm New Password</label>
                <div className="relative group">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/20" strokeWidth={1.5} />
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setSuccess(false); }}
                    placeholder="Re-enter new password"
                    className="w-full h-12 pl-10 pr-11 text-sm bg-white border-2 border-transparent rounded-xl outline-none ring-1 ring-border/40 focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-foreground/20 group-hover:ring-border/60"
                  />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground/25 hover:text-foreground/50 transition-colors">
                    {showConfirm ? <EyeOff className="w-4 h-4" strokeWidth={1.5} /> : <Eye className="w-4 h-4" strokeWidth={1.5} />}
                  </button>
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-[11px] text-red-400 mt-1.5 flex items-center gap-1">
                    <X className="w-3 h-3" strokeWidth={2} /> Passwords do not match
                  </p>
                )}
                {confirmPassword && newPassword === confirmPassword && newPassword.length >= 6 && (
                  <p className="text-[11px] text-emerald-500 mt-1.5 flex items-center gap-1">
                    <Check className="w-3 h-3" strokeWidth={2} /> Passwords match
                  </p>
                )}
              </div>

              {success && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <Check className="w-4 h-4 text-emerald-600" strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">Password changed</p>
                    <p className="text-xs text-emerald-600/70 mt-0.5">Your admin portal password has been updated successfully.</p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/10">
                <button
                  type="submit"
                  disabled={!canSave || saving}
                  className="group relative inline-flex items-center gap-2.5 h-11 px-6 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/25 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Shield className="w-4 h-4" strokeWidth={1.5} />
                  )}
                  {saving ? "Updating…" : "Update Password"}
                  {!saving && (
                    <span className="w-6 h-6 rounded-lg bg-white/15 flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
                      <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                    </span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
