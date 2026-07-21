import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, MapPin, ShoppingBag, Lock, Plus, Trash2, Edit2, ArrowUpDown, Shield, Mail, Calendar, ChevronDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Address {
  id: string;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

interface UserDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UserDashboardModal({ isOpen, onClose }: UserDashboardModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'profile' | 'addresses' | 'orders' | 'security'>('profile');

  const [profile, setProfile] = useState({
    name: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: '',
  });
  const [profileLoading, setProfileLoading] = useState(false);

  const [additionalAddresses, setAdditionalAddresses] = useState<Address[]>([]);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressForm, setAddressForm] = useState({
    label: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: '',
  });

  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'price_desc' | 'price_asc' | 'status'>('date_desc');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  const sortOptions = [
    { value: 'date_desc', label: 'Newest First' },
    { value: 'date_asc', label: 'Oldest First' },
    { value: 'price_desc', label: 'Price: High to Low' },
    { value: 'price_asc', label: 'Price: Low to High' },
    { value: 'status', label: 'Group by Status' },
  ];

  const [password, setPassword] = useState({ current: '', new: '', confirm: '' });
  const [securityLoading, setSecurityLoading] = useState(false);

  const userEmail = user?.email;

  useEffect(() => {
    if (!isOpen || !userEmail || (activeTab !== 'profile' && activeTab !== 'addresses')) return;
    setProfileLoading(true);

    (supabase.from('User_details') as any)
      .select('*')
      .eq('user_email', userEmail)
      .maybeSingle()
      .then(({ data, error }: { data: Record<string, unknown> | null; error: unknown }) => {
        if (!error && data) {
          setProfile({
            name: (data.user_name as string) || '',
            phone: (data.user_phone as string) || '',
            address: (data.user_address as string) || '',
            city: (data.user_city as string) || '',
            state: (data.user_state as string) || '',
            zip: (data.user_zip as string) || '',
            country: (data.user_country as string) || '',
          });
          setAdditionalAddresses((data.additional_addresses as Address[]) || []);
        } else if (!data) {
          setProfile((prev) => ({
            ...prev,
            name: user?.user_metadata?.full_name as string || user?.user_metadata?.name as string || '',
          }));
        }
        setProfileLoading(false);
      });
  }, [isOpen, userEmail, activeTab, user?.user_metadata]);

  useEffect(() => {
    if (!isOpen || !userEmail || activeTab !== 'orders') return;
    setOrdersLoading(true);

    supabase
      .from('orders')
      .select('*, order_items(*, products(name))')
      .eq('user_id', userEmail)
      .then(({ data, error }) => {
        if (!error && data) {
          setOrders(data as unknown as any[]);
        }
        setOrdersLoading(false);
      });
  }, [isOpen, userEmail, activeTab]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userEmail) return;
    setProfileLoading(true);

    try {
      const { error } = await (supabase.from('User_details') as any)
        .update({
          user_name: profile.name,
          user_phone: profile.phone,
          user_address: profile.address,
          user_city: profile.city,
          user_state: profile.state,
          user_zip: profile.zip,
          user_country: profile.country,
        })
        .eq('user_email', userEmail);

      if (error) throw error;
      toast({ title: 'Profile updated', description: 'Your details have been saved.' });
    } catch (err: any) {
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleAddressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userEmail) return;

    let updatedList: Address[] = [];
    if (editingAddressId) {
      updatedList = additionalAddresses.map((a) =>
        a.id === editingAddressId ? { ...addressForm, id: editingAddressId } : a
      );
    } else {
      updatedList = [...additionalAddresses, { ...addressForm, id: Math.random().toString(36).substring(2, 9) }];
    }

    try {
      const { error } = await (supabase.from('User_details') as any)
        .update({ additional_addresses: updatedList })
        .eq('user_email', userEmail);

      if (error) throw error;
      setAdditionalAddresses(updatedList);
      setShowAddressForm(false);
      setEditingAddressId(null);
      setAddressForm({ label: '', address: '', city: '', state: '', zip: '', country: '' });
      toast({ title: 'Address saved', description: 'Successfully updated your addresses.' });
    } catch (err: any) {
      toast({ title: 'Failed to save address', description: err.message, variant: 'destructive' });
    }
  };

  const handleDeleteAddress = async (id: string) => {
    if (!userEmail) return;
    const updatedList = additionalAddresses.filter((a) => a.id !== id);

    try {
      const { error } = await (supabase.from('User_details') as any)
        .update({ additional_addresses: updatedList })
        .eq('user_email', userEmail);

      if (error) throw error;
      setAdditionalAddresses(updatedList);
      toast({ title: 'Address deleted', description: 'Removed successfully.' });
    } catch (err: any) {
      toast({ title: 'Failed to delete', description: err.message, variant: 'destructive' });
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.new !== password.confirm) {
      toast({ title: 'Mismatch', description: 'New password and confirmation do not match.', variant: 'destructive' });
      return;
    }
    setSecurityLoading(true);

    try {
      const { error: authError } = await supabase.auth.updateUser({ password: password.new });
      if (authError) throw authError;

      const { error: dbError } = await (supabase.from('User_details') as any)
        .update({ user_password: password.new })
        .eq('user_email', userEmail);

      if (dbError) throw dbError;

      toast({ title: 'Password changed', description: 'Your password was updated successfully.' });
      setPassword({ current: '', new: '', confirm: '' });
    } catch (err: any) {
      toast({ title: 'Change failed', description: err.message, variant: 'destructive' });
    } finally {
      setSecurityLoading(false);
    }
  };

  const processedOrders = [...orders].sort((a, b) => {
    if (sortBy === 'date_desc') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (sortBy === 'date_asc') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (sortBy === 'price_desc') return Number(b.total_amount) - Number(a.total_amount);
    if (sortBy === 'price_asc') return Number(a.total_amount) - Number(b.total_amount);
    if (sortBy === 'status') return (a.status || '').localeCompare(b.status || '');
    return 0;
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0c140f]/60 backdrop-blur-md z-50 pointer-events-auto"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 15 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-4 md:inset-x-12 md:inset-y-8 lg:inset-x-28 lg:inset-y-12 max-w-6xl mx-auto z-50 bg-background rounded-3xl overflow-hidden flex flex-col md:flex-row shadow-[0_30px_100px_rgba(12,20,15,0.15)] pointer-events-auto border border-[#ebedd3]/10"
          >
            <div className="w-full md:w-80 bg-gradient-to-b from-[#132c1e] to-[#0c1c13] text-[#f2f4ec] border-b md:border-b-0 md:border-r border-[#f2f4ec]/10 p-8 flex flex-col justify-between shrink-0 relative overflow-hidden">
              <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-primary/10 blur-[80px]" />

              <div className="space-y-8 relative z-10">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground font-serif text-2xl font-bold shadow-md shadow-black/10">
                    {profile.name ? profile.name.split(' ').map((n) => n[0]).join('') : 'U'}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-serif font-semibold truncate text-[#ebedd3]">{profile.name || 'Customer Account'}</h3>
                    <p className="text-xs text-[#ebedd3]/60 truncate font-light flex items-center gap-1.5 mt-0.5"><Mail className="w-3.5 h-3.5" /> {user?.email}</p>
                  </div>
                </div>

                <div className="h-px bg-[#f2f4ec]/10" />

                <div className="flex md:flex-col gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
                  {[
                    { id: 'profile', label: 'Profile Information', desc: 'Manage name, phone, and main address', icon: User },
                    { id: 'addresses', label: 'Shipping Addresses', desc: 'Add or edit secondary destinations', icon: MapPin },
                    { id: 'orders', label: 'My Orders', desc: 'View history, statuses, and receipts', icon: ShoppingBag },
                    { id: 'security', label: 'Security & Login', desc: 'Change password and lock account', icon: Lock },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isSelected = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex items-center gap-4 px-4 py-3.5 rounded-2xl text-left whitespace-nowrap md:whitespace-normal transition-all duration-300 w-full group relative ${
                          isSelected
                            ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/10'
                            : 'text-[#ebedd3]/60 hover:bg-[#ebedd3]/5 hover:text-[#ebedd3]'
                        }`}
                      >
                        <div className={`w-8 h-8 flex items-center justify-center rounded-xl transition-colors duration-300 ${isSelected ? 'bg-white/10' : 'bg-white/5'}`}>
                          <Icon className="w-4 h-4 shrink-0" strokeWidth={1.8} />
                        </div>
                        <div className="hidden md:block min-w-0">
                          <p className="text-xs font-semibold leading-tight">{tab.label}</p>
                          <p className={`text-[10px] truncate leading-none mt-1 font-light ${isSelected ? 'text-primary-foreground/70' : 'text-[#ebedd3]/40'}`}>{tab.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={onClose}
                className="hidden md:flex items-center justify-center gap-2 h-12 border border-[#f2f4ec]/25 rounded-2xl text-xs font-semibold text-[#ebedd3]/70 hover:bg-white/5 hover:text-[#ebedd3] transition-all duration-300 relative z-10"
              >
                Close Settings
              </button>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden bg-[#fafaf8]">
              <div className="flex items-center justify-between px-8 h-20 border-b border-border/40 shrink-0 bg-white">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary/60" />
                  <span className="text-xs font-bold text-foreground/45 uppercase tracking-widest font-mono">
                    {activeTab === 'profile' && 'Account Profile'}
                    {activeTab === 'addresses' && 'Alternative Addresses'}
                    {activeTab === 'orders' && 'Billing & Orders'}
                    {activeTab === 'security' && 'Security Configuration'}
                  </span>
                </div>
                <button onClick={onClose} className="p-2.5 rounded-2xl bg-muted/30 hover:bg-muted text-foreground/60 transition-all duration-300">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 md:p-10 space-y-6">
                {activeTab === 'profile' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="max-w-2xl">
                    <div className="bg-white p-6 md:p-8 rounded-3xl border border-border/40 shadow-xs mb-6">
                      <h3 className="text-base font-serif font-bold text-foreground mb-1">Personal Details</h3>
                      <p className="text-xs text-foreground/40 mb-6">Keep your contact information up to date so we can contact you regarding shipments.</p>

                      <form onSubmit={handleUpdateProfile} className="space-y-5">
                        <div className="grid md:grid-cols-2 gap-5">
                          <div>
                            <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">Full Name</label>
                            <Input type="text" required value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Jane Doe" className="h-12 rounded-xl" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">Phone Number</label>
                            <Input type="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="e.g. +91 9876543210" className="h-12 rounded-xl" />
                          </div>
                        </div>
                        <div className="h-px bg-border/40 my-4" />
                        <h3 className="text-xs font-bold text-foreground/60 uppercase tracking-wider mb-3">Primary Shipping Address</h3>
                        <div>
                          <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">Street Address</label>
                          <Input type="text" value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} placeholder="Apartment, suite, street name" className="h-12 rounded-xl" />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="col-span-2">
                            <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">City</label>
                            <Input type="text" value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} placeholder="City" className="h-12 rounded-xl" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">State</label>
                            <Input type="text" value={profile.state} onChange={(e) => setProfile({ ...profile, state: e.target.value })} placeholder="State" className="h-12 rounded-xl" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">Postal Code</label>
                            <Input type="text" value={profile.zip} onChange={(e) => setProfile({ ...profile, zip: e.target.value })} placeholder="Zip" className="h-12 rounded-xl" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">Country</label>
                          <Input type="text" value={profile.country} onChange={(e) => setProfile({ ...profile, country: e.target.value })} placeholder="Country" className="h-12 rounded-xl" />
                        </div>
                        <div className="pt-4">
                          <Button type="submit" disabled={profileLoading} className="w-full md:w-auto h-12 px-8 gap-2 shadow-md rounded-xl">
                            {profileLoading ? 'Updating Details...' : 'Save Profile Details'}
                          </Button>
                        </div>
                      </form>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'addresses' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
                    {showAddressForm ? (
                      <form onSubmit={handleAddressSubmit} className="max-w-md space-y-5 bg-white p-6 md:p-8 rounded-3xl border border-border/40 shadow-xs">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-semibold text-foreground">{editingAddressId ? 'Edit Address Details' : 'Add Alternative Address'}</h3>
                          <button type="button" onClick={() => setShowAddressForm(false)} className="text-xs text-primary font-semibold hover:opacity-80">Cancel</button>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">Label (e.g., Office, Parents House)</label>
                          <Input type="text" required value={addressForm.label} onChange={(e) => setAddressForm({ ...addressForm, label: e.target.value })} placeholder="e.g. My Office" className="h-11 rounded-xl" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">Street Address</label>
                          <Input type="text" required value={addressForm.address} onChange={(e) => setAddressForm({ ...addressForm, address: e.target.value })} placeholder="Building name and street address" className="h-11 rounded-xl" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">City</label>
                            <Input type="text" required value={addressForm.city} onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })} placeholder="City" className="h-11 rounded-xl" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">State</label>
                            <Input type="text" required value={addressForm.state} onChange={(e) => setAddressForm({ ...addressForm, state: e.target.value })} placeholder="State" className="h-11 rounded-xl" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">Zip Code</label>
                            <Input type="text" required value={addressForm.zip} onChange={(e) => setAddressForm({ ...addressForm, zip: e.target.value })} placeholder="Zip" className="h-11 rounded-xl" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">Country</label>
                            <Input type="text" required value={addressForm.country} onChange={(e) => setAddressForm({ ...addressForm, country: e.target.value })} placeholder="Country" className="h-11 rounded-xl" />
                          </div>
                        </div>
                        <Button type="submit" className="w-full h-12 shadow-sm rounded-xl">Save Alternative Destination</Button>
                      </form>
                    ) : (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-base font-serif font-bold text-foreground">Saved Shipping Locations</h3>
                            <p className="text-xs text-foreground/40 mt-0.5">Use these destinations during checkout to quickly send packages elsewhere.</p>
                          </div>
                          <Button onClick={() => { setEditingAddressId(null); setAddressForm({ label: '', address: '', city: '', state: '', zip: '', country: '' }); setShowAddressForm(true); }} className="gap-2 h-11 rounded-xl">
                            <Plus className="w-4 h-4" /> Add Destination
                          </Button>
                        </div>

                        {additionalAddresses.length === 0 ? (
                          <div className="text-center py-16 border-2 border-dashed border-border/40 rounded-3xl bg-white max-w-xl">
                            <MapPin className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
                            <p className="text-xs text-foreground/45 font-medium">No alternative addresses saved.</p>
                            <p className="text-[11px] text-foreground/30 mt-1">Add additional shipping locations to quickly toggle between them on checkout.</p>
                          </div>
                        ) : (
                          <div className="grid md:grid-cols-2 gap-6">
                            {additionalAddresses.map((addr) => (
                              <div key={addr.id} className="p-6 border border-border/40 rounded-3xl bg-white flex flex-col justify-between hover:border-primary/30 shadow-xs hover:shadow-md transition-all duration-300">
                                <div>
                                  <div className="flex items-center justify-between mb-4">
                                    <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary px-3 py-1 rounded-lg">{addr.label}</span>
                                    <MapPin className="w-4 h-4 text-foreground/20" />
                                  </div>
                                  <p className="text-sm font-semibold text-foreground">{addr.address}</p>
                                  <p className="text-xs text-foreground/50 mt-1.5">{addr.city}, {addr.state} &middot; {addr.zip}</p>
                                  <p className="text-[11px] text-foreground/40 mt-1 font-light">{addr.country}</p>
                                </div>
                                <div className="flex items-center gap-4 mt-6 pt-4 border-t border-border/10">
                                  <button onClick={() => { setEditingAddressId(addr.id); setAddressForm(addr); setShowAddressForm(true); }} className="text-xs font-semibold text-foreground/50 hover:text-primary transition-colors flex items-center gap-1.5"><Edit2 className="w-3.5 h-3.5" /> Edit</button>
                                  <button onClick={() => handleDeleteAddress(addr.id)} className="text-xs font-semibold text-red-500/70 hover:text-red-600 transition-colors flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> Remove</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}

                {activeTab === 'orders' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
                    <div className="flex items-center justify-between border-b border-border/40 pb-5">
                      <div>
                        <h3 className="text-base font-serif font-bold text-foreground">Order Logs</h3>
                        <p className="text-xs text-foreground/40 mt-0.5">Keep track of your current status, item quantities, and totals.</p>
                      </div>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                          className="flex items-center gap-2 bg-white border border-border/60 hover:border-primary/40 rounded-xl px-4 py-2.5 text-xs font-semibold text-foreground/75 transition-all duration-300 shadow-xs min-w-[170px] justify-between cursor-pointer"
                        >
                          <span className="flex items-center gap-2">
                            <ArrowUpDown className="w-3.5 h-3.5 text-foreground/45" />
                            {sortOptions.find((o) => o.value === sortBy)?.label}
                          </span>
                          <ChevronDown className={`w-3.5 h-3.5 text-foreground/45 transition-transform duration-300 ${sortDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        <AnimatePresence>
                          {sortDropdownOpen && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setSortDropdownOpen(false)} />
                              <motion.div
                                initial={{ opacity: 0, y: -4, scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -4, scale: 0.96 }}
                                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                                className="absolute right-0 mt-2 w-48 z-20 bg-white border border-border/40 rounded-2xl shadow-xl overflow-hidden py-1.5"
                              >
                                {sortOptions.map((opt) => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => { setSortBy(opt.value as any); setSortDropdownOpen(false); }}
                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-xs text-left transition-colors hover:bg-[#fafaf8] ${
                                      sortBy === opt.value ? 'text-primary font-bold bg-primary/5' : 'text-foreground/60'
                                    }`}
                                  >
                                    {opt.label}
                                    {sortBy === opt.value && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                                  </button>
                                ))}
                              </motion.div>
                            </>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    {ordersLoading ? (
                      <div className="text-center py-16 text-xs text-foreground/45">Fetching billing archives...</div>
                    ) : processedOrders.length === 0 ? (
                      <div className="text-center py-20 border border-border/40 rounded-3xl bg-white max-w-xl">
                        <ShoppingBag className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
                        <p className="text-xs text-foreground/45 font-medium">No purchases logged yet.</p>
                        <p className="text-[11px] text-foreground/30 mt-1">Once you complete checkout, your order files will appear here.</p>
                      </div>
                    ) : (
                      <div className="grid md:grid-cols-2 gap-6">
                        {processedOrders.map((order) => (
                          <div key={order.id} className="bg-white border border-border/40 rounded-3xl p-6 shadow-xs space-y-4 hover:shadow-md hover:border-primary/20 transition-all duration-300 flex flex-col justify-between">
                            <div className="space-y-3">
                              <div className="flex items-start justify-between">
                                <div className="min-w-0">
                                  <p className="text-[9px] font-bold text-foreground/40 uppercase tracking-widest font-mono">Reference ID</p>
                                  <p className="font-mono text-xs font-semibold text-foreground truncate mt-0.5">{order.order_number || order.id}</p>
                                </div>
                                <span className={`px-2.5 py-1 text-[9px] font-bold rounded-lg border uppercase tracking-wider ${
                                  order.status === 'delivered' ? 'bg-green-50 text-green-700 border-green-200' :
                                  order.status === 'cancelled' ? 'bg-red-50 text-red-700 border-red-200' :
                                  'bg-amber-50 text-amber-700 border-amber-200'
                                }`}>
                                  {order.status}
                                </span>
                              </div>
                              <div className="h-px bg-border/40 my-2" />
                              <div className="space-y-2">
                                {(order.order_items || []).map((item: any) => (
                                  <div key={item.id} className="flex justify-between items-center text-xs">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="font-medium text-foreground truncate">{item.products?.name || 'Organic Product'}</span>
                                      <span className="text-foreground/40 shrink-0">x{item.quantity}</span>
                                    </div>
                                    <span className="font-bold text-foreground shrink-0">₹{item.total_price}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="mt-6 pt-4 border-t border-border/10">
                              <div className="flex items-center justify-between text-xs text-foreground/40">
                                <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {new Date(order.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                <span className="font-serif font-bold text-sm text-primary">₹{order.total_amount}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}

                {activeTab === 'security' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="max-w-md">
                    <div className="bg-white p-6 md:p-8 rounded-3xl border border-border/40 shadow-xs">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 bg-red-50 text-red-500 rounded-2xl">
                          <Shield className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-base font-serif font-bold text-foreground">Password Update</h3>
                          <p className="text-xs text-foreground/40 mt-0.5">Protect your account settings by regularly rotating credentials.</p>
                        </div>
                      </div>

                      <form onSubmit={handleUpdatePassword} className="space-y-5">
                        <div>
                          <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 block">New Password</label>
                          <Input type="password" required minLength={6} value={password.new} onChange={(e) => setPassword({ ...password, new: e.target.value })} placeholder="Enter 6+ characters" className="h-12 rounded-xl" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-[#0c140f]/50 uppercase tracking-wider mb-2 block">Confirm New Password</label>
                          <Input type="password" required minLength={6} value={password.confirm} onChange={(e) => setPassword({ ...password, confirm: e.target.value })} placeholder="Re-enter password" className="h-12 rounded-xl" />
                        </div>
                        <div className="pt-3">
                          <Button type="submit" disabled={securityLoading} className="w-full h-12 shadow-sm rounded-xl">
                            {securityLoading ? 'Synchronizing Credentials...' : 'Change Account Password'}
                          </Button>
                        </div>
                      </form>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
