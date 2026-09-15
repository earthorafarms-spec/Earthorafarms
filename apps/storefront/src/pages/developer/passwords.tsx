import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Plus, ShieldCheck, Trash, Users, KeyRound, Eye, EyeOff } from "lucide-react";
import { api, authApi, type StaffUser } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin (Sun-Earthora)" },
  { value: "developer", label: "Developer" },
  { value: "kacc", label: "KACC accounting" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

const inputClass = "w-full h-11 px-4 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-200 text-xs focus:border-indigo-500/50";

/** Staff accounts: every portal now has per-person credentials (email + password + email OTP) enforced by the API. */
export default function DeveloperPasswords() {
  const { toast } = useToast();
  const [me, setMe] = useState<StaffUser | null>(null);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRoles, setNewRoles] = useState<string[]>(["kacc"]);
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [ownCurrent, setOwnCurrent] = useState("");
  const [ownNext, setOwnNext] = useState("");
  const [savingOwn, setSavingOwn] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [m, list] = await Promise.all([authApi.me(), api<{ users: StaffUser[] }>("/api/staff")]);
      setMe(m.user); setUsers(list.users);
    } catch (err: any) {
      toast({ title: "Failed to load staff accounts", description: err.message, variant: "destructive" });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const createUser = async () => {
    if (!newEmail.includes("@") || newPassword.length < 8 || newRoles.length === 0) {
      toast({ title: "Validation error", description: "Valid email, 8+ character password and at least one role are required.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await api("/api/staff", { method: "POST", json: { email: newEmail.trim().toLowerCase(), name: newName.trim(), password: newPassword, roles: newRoles } });
      toast({ title: "Account created", description: `${newEmail} can now sign in.` });
      setNewEmail(""); setNewName(""); setNewPassword(""); setNewRoles(["kacc"]); load();
    } catch (err: any) { toast({ title: "Creation failed", description: err.message, variant: "destructive" }); }
    finally { setCreating(false); }
  };

  const saveReset = async (id: string) => {
    if (resetPassword.length < 8) { toast({ title: "Validation error", description: "Password must be at least 8 characters.", variant: "destructive" }); return; }
    try {
      await api(`/api/staff/${id}`, { method: "PATCH", json: { password: resetPassword } });
      toast({ title: "Password updated" }); setResetFor(null); setResetPassword("");
    } catch (err: any) { toast({ title: "Update failed", description: err.message, variant: "destructive" }); }
  };

  const toggleStatus = async (u: StaffUser) => {
    try { await api(`/api/staff/${u.id}`, { method: "PATCH", json: { status: u.status === "active" ? "disabled" : "active" } }); load(); }
    catch (err: any) { toast({ title: "Update failed", description: err.message, variant: "destructive" }); }
  };

  const remove = async (u: StaffUser) => {
    if (!confirm(`Remove access for ${u.email}?`)) return;
    try { await api(`/api/staff/${u.id}`, { method: "DELETE" }); toast({ title: "Access removed", description: u.email }); load(); }
    catch (err: any) { toast({ title: "Deletion failed", description: err.message, variant: "destructive" }); }
  };

  const changeOwn = async () => {
    if (ownNext.length < 12) { toast({ title: "Validation error", description: "Use at least 12 characters.", variant: "destructive" }); return; }
    setSavingOwn(true);
    try {
      await authApi.changePassword(ownCurrent, ownNext);
      toast({ title: "Password changed", description: "Sign in again with your new password." });
      window.location.reload();
    } catch (err: any) { toast({ title: "Change failed", description: err.message, variant: "destructive" }); }
    finally { setSavingOwn(false); }
  };

  return (
    <div className="space-y-8 font-sans">
      <div>
        <h2 className="text-xl font-serif font-bold text-white">Staff accounts & access</h2>
        <p className="text-xs text-slate-500 mt-1">Each person signs in with their own email, password and a one-time code. Roles decide which portals open: Admin → Sun-Earthora, Developer → this console, KACC → accounting.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        <div className="bg-slate-900/40 rounded-2xl border border-slate-800 p-6 shadow-xl space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center"><KeyRound className="w-5 h-5 text-indigo-400" /></div>
            <div><h3 className="text-sm font-semibold text-white">Your password</h3><p className="text-xs text-slate-500 mt-0.5">{me?.email ?? "—"}</p></div>
          </div>
          <input type="password" value={ownCurrent} onChange={(e) => setOwnCurrent(e.target.value)} placeholder="Current password" className={inputClass} autoComplete="current-password" />
          <input type="password" value={ownNext} onChange={(e) => setOwnNext(e.target.value)} placeholder="New password (12+ characters)" className={inputClass} autoComplete="new-password" />
          <button onClick={changeOwn} disabled={savingOwn || !ownCurrent || !ownNext} className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-2">
            {savingOwn ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Update password
          </button>
        </div>

        <div className="bg-slate-900/40 rounded-2xl border border-slate-800 p-6 shadow-xl space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center"><Plus className="w-5 h-5 text-emerald-400" /></div>
            <div><h3 className="text-sm font-semibold text-white">Add a staff account</h3><p className="text-xs text-slate-500 mt-0.5">They receive sign-in codes at this email.</p></div>
          </div>
          <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email address" className={inputClass} />
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className={inputClass} />
          <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Initial password (8+ characters)" className={inputClass} />
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map((r) => (
              <button key={r.value} type="button" onClick={() => setNewRoles((prev) => prev.includes(r.value) ? prev.filter((x) => x !== r.value) : [...prev, r.value])}
                className={`px-3 h-8 rounded-lg text-[11px] font-semibold border transition ${newRoles.includes(r.value) ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-200" : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"}`}>
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={createUser} disabled={creating} className="h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-2">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create account
          </button>
        </div>
      </div>

      <div className="bg-slate-900/40 rounded-2xl border border-slate-800 p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center"><Users className="w-5 h-5 text-slate-300" /></div>
          <div><h3 className="text-sm font-semibold text-white">All accounts</h3><p className="text-xs text-slate-500 mt-0.5">{users.length} account{users.length === 1 ? "" : "s"}</p></div>
        </div>
        {loading ? <div className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div> : (
          <div className="divide-y divide-slate-800">
            {users.map((u) => (
              <motion.div key={u.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-[220px] flex-1">
                  <div className="text-sm text-slate-100 font-medium">{u.email} {u.id === me?.id && <span className="text-[10px] text-indigo-300 ml-1">(you)</span>}</div>
                  <div className="text-[11px] text-slate-500">{u.name || "—"} · {u.roles.join(", ")} · {u.status}</div>
                </div>
                {resetFor === u.id ? (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <input type={showReset ? "text" : "password"} value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="New password" className={`${inputClass} w-56 pr-9`} />
                      <button type="button" onClick={() => setShowReset(!showReset)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">{showReset ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                    </div>
                    <button onClick={() => saveReset(u.id)} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold">Save</button>
                    <button onClick={() => { setResetFor(null); setResetPassword(""); }} className="h-9 px-3 rounded-lg bg-slate-800 text-slate-300 text-[11px]">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setResetFor(u.id)} className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold">Reset password</button>
                    {!u.roles.includes("owner") && (
                      <>
                        <button onClick={() => toggleStatus(u)} className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold">{u.status === "active" ? "Disable" : "Enable"}</button>
                        <button onClick={() => remove(u)} className="h-9 w-9 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 flex items-center justify-center"><Trash className="w-4 h-4" /></button>
                      </>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
