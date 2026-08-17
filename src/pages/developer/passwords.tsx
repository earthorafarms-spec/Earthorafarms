import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Lock, Eye, EyeOff, ShieldCheck, Loader2, Save, Users, Key, AlertTriangle, Plus, Trash
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

type KaccUser = {
  id: number;
  email: string;
  password: string;
};

export default function DeveloperPasswords() {
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmAdminPassword, setConfirmAdminPassword] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [savingAdmin, setSavingAdmin] = useState(false);

  const [kaccUsers, setKaccUsers] = useState<KaccUser[]>([]);
  const [loadingKacc, setLoadingKacc] = useState(true);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [showKaccPass, setShowKaccPass] = useState<number | null>(null);

  // New Kacc user state
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);

  const { toast } = useToast();

  const fetchKaccUsers = async () => {
    setLoadingKacc(true);
    try {
      const { data, error } = await supabase
        .from("kacc_users")
        .select("*")
        .order("id", { ascending: true });

      if (error) throw error;
      setKaccUsers(data || []);
    } catch (err: any) {
      toast({ title: "Failed to load KACC accounts", description: err.message, variant: "destructive" });
    } finally {
      setLoadingKacc(false);
    }
  };

  const handleUpdateAdminPassword = async () => {
    if (!adminPassword || adminPassword.length < 6) {
      toast({ title: "Validation Error", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    if (adminPassword !== confirmAdminPassword) {
      toast({ title: "Validation Error", description: "Passwords do not match.", variant: "destructive" });
      return;
    }

    setSavingAdmin(true);
    try {
      // Upsert directly in admin_settings key 'admin_password'
      const { error } = await (supabase.from("admin_settings") as any)
        .upsert({ key: "admin_password", value: adminPassword }, { onConflict: "key" });

      if (error) throw error;

      toast({ title: "Admin Password Updated", description: "Successfully updated credentials for Sun-Earthora Admin portal." });
      setAdminPassword("");
      setConfirmAdminPassword("");
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleUpdateKaccPassword = async (id: number) => {
    if (!editPassword || editPassword.length < 6) {
      toast({ title: "Validation Error", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }

    try {
      const { error } = await (supabase.from("kacc_users") as any)
        .update({ password: editPassword })
        .eq("id", id);

      if (error) throw error;

      toast({ title: "KACC Password Updated", description: "Successfully changed credentials for Key Accounts account." });
      setEditingUserId(null);
      setEditPassword("");
      fetchKaccUsers();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  };

  const handleCreateKaccUser = async () => {
    if (!newEmail || !newPassword || newPassword.length < 6) {
      toast({ title: "Validation Error", description: "Provide a valid email and a 6+ character password.", variant: "destructive" });
      return;
    }

    setCreatingUser(true);
    try {
      const { error } = await (supabase.from("kacc_users") as any)
        .insert({ email: newEmail.trim().toLowerCase(), password: newPassword });

      if (error) throw error;

      toast({ title: "KACC User Created", description: `Successfully added ${newEmail} to the KACC portal.` });
      setNewEmail("");
      setNewPassword("");
      fetchKaccUsers();
    } catch (err: any) {
      toast({ title: "Creation failed", description: err.message, variant: "destructive" });
    } finally {
      setCreatingUser(false);
    }
  };

  const handleDeleteKaccUser = async (id: number, email: string) => {
    if (!confirm(`Are you sure you want to delete access for ${email}?`)) return;

    try {
      const { error } = await supabase
        .from("kacc_users")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast({ title: "KACC User Removed", description: `Access revoked for ${email}.` });
      fetchKaccUsers();
    } catch (err: any) {
      toast({ title: "Deletion failed", description: err.message, variant: "destructive" });
    }
  };

  useEffect(() => {
    fetchKaccUsers();
  }, []);

  return (
    <div className="space-y-8 font-sans">
      <div>
        <h2 className="text-xl font-serif font-bold text-white">System Security & Access Controls</h2>
        <p className="text-xs text-slate-500 mt-1">Manage portal administrative credentials, issue KACC credentials, and audit active users.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Sun-Earthora Admin Password Section */}
        <div className="bg-slate-900/40 rounded-2xl border border-slate-800 p-6 shadow-xl space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center">
              <Lock className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Sun-Earthora Admin Password</h3>
              <p className="text-xs text-slate-500 mt-0.5">Directly update the core system dashboard master key.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest block mb-2">New Admin Password</label>
              <div className="relative group">
                <input
                  type={showAdmin ? "text" : "password"}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Enter new admin password"
                  className="w-full h-11 pl-4 pr-11 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-200 text-xs focus:border-indigo-500/50"
                />
                <button
                  type="button"
                  onClick={() => setShowAdmin(!showAdmin)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showAdmin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest block mb-2">Confirm Admin Password</label>
              <input
                type="password"
                value={confirmAdminPassword}
                onChange={(e) => setConfirmAdminPassword(e.target.value)}
                placeholder="Confirm new admin password"
                className="w-full h-11 px-4 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-200 text-xs focus:border-indigo-500/50"
              />
            </div>
          </div>

          <button
            onClick={handleUpdateAdminPassword}
            disabled={savingAdmin}
            className="w-full h-11 bg-indigo-600 rounded-xl text-xs font-bold text-white shadow-lg shadow-indigo-500/10 hover:bg-indigo-500 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {savingAdmin ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>Update Admin Password</span>
          </button>
        </div>

        {/* KACC Portal User Management Section */}
        <div className="bg-slate-900/40 rounded-2xl border border-slate-800 p-6 shadow-xl space-y-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Key Accounts Portal Users</h3>
                <p className="text-xs text-slate-500 mt-0.5">Create and rotate credentials for KACC portal representatives.</p>
              </div>
            </div>

            {loadingKacc ? (
              <div className="h-44 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-3 pr-1">
                {kaccUsers.map((user) => (
                  <div key={user.id} className="bg-slate-950/60 rounded-xl border border-slate-800 p-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{user.email}</p>
                      {editingUserId === user.id ? (
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="password"
                            placeholder="6+ characters"
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                            className="h-8 px-2.5 bg-slate-900 border border-slate-700 rounded-lg text-[11px] text-white outline-none focus:border-indigo-500 w-32"
                          />
                          <button
                            onClick={() => handleUpdateKaccPassword(user.id)}
                            className="bg-indigo-600 text-white h-8 px-2.5 rounded-lg text-[10px] font-bold"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingUserId(null)}
                            className="text-slate-500 hover:text-slate-300 text-[10px] px-1"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-500 font-mono mt-1">
                          Password: {showKaccPass === user.id ? user.password : "••••••••"}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setShowKaccPass(showKaccPass === user.id ? null : user.id)}
                        className="text-[10px] font-semibold text-slate-400 hover:text-white"
                      >
                        {showKaccPass === user.id ? "Hide" : "Show"}
                      </button>
                      <button
                        onClick={() => { setEditingUserId(user.id); setEditPassword(""); }}
                        className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300"
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => handleDeleteKaccUser(user.id, user.email)}
                        className="text-slate-600 hover:text-rose-400 p-1 transition-colors"
                      >
                        <Trash className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create new KACC accounts */}
          <div className="border-t border-slate-800/80 pt-4 mt-4 space-y-3">
            <h4 className="text-xs font-bold text-slate-400 flex items-center gap-1.5 uppercase font-mono tracking-wider">
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span>Create KACC Account</span>
            </h4>
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                type="email"
                placeholder="Email Address"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="h-10 px-3 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-200 text-xs focus:border-indigo-500/50"
              />
              <input
                type="password"
                placeholder="Security Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-10 px-3 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-200 text-xs focus:border-indigo-500/50"
              />
            </div>
            <button
              onClick={handleCreateKaccUser}
              disabled={creatingUser}
              className="w-full h-10 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-slate-300 hover:bg-slate-900 transition-all flex items-center justify-center gap-1.5 hover:text-white"
            >
              {creatingUser && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Add Representative</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
