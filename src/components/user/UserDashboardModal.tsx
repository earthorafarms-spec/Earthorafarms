import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, MapPin, ShoppingBag, Lock, Plus, Trash2, Edit2, Shield, Mail, Calendar, ChevronDown, Check, ArrowUpRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { useEscapeKey } from '@/hooks/useEscapeKey';

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
  useEscapeKey(onClose, isOpen);
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

    // Orders are stored in "Orders" table with order_user_id = user email
    (supabase.from('Orders') as any)
      .select('*')
      .eq('order_user_id', userEmail)
      .order('order_created_at', { ascending: false })
      .then(async ({ data: legacyData, error }: { data: any[] | null; error: any }) => {
        if (error) {
          console.error('Orders fetch error:', error.message);
          setOrders([]);
          setOrdersLoading(false);
          return;
        }

        if (!legacyData || legacyData.length === 0) {
          setOrders([]);
          setOrdersLoading(false);
          return;
        }

        // Fetch product details for each row (by slug or id)
        const mapped = await Promise.all(
          legacyData.map(async (item: any) => {
            // Try to get product by slug first, then by id
            let prod: any = null;
            const { data: bySlug } = await (supabase.from('products') as any)
              .select('id, name, slug, images')
              .eq('slug', item.order_product_id)
              .maybeSingle();
            if (bySlug) {
              prod = bySlug;
            } else {
              const { data: byId } = await (supabase.from('products') as any)
                .select('id, name, slug, images')
                .eq('id', item.order_product_id)
                .maybeSingle();
              prod = byId;
            }

            const qty = Number(item.order_product_quantity) || 1;
            const price = Number(item.order_product_price) || 0;

            return {
              id: item.id,
              order_number: String(item.id),
              status: 'processing',
              total_amount: price * qty,
              created_at: item.order_created_at || item.created_at,
              shipping_address: null,
              order_items: [
                {
                  id: item.id,
                  quantity: qty,
                  unit_price: price,
                  total_price: price * qty,
                  products: prod || { name: item.order_product_id, slug: item.order_product_id },
                },
              ],
            };
          })
        );

        setOrders(mapped);
        setOrdersLoading(false);
      });
  }, [isOpen, userEmail, activeTab]);


  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);

    try {
      const { data: existing } = await (supabase.from('User_details') as any)
        .select('user_email')
        .eq('user_email', userEmail)
        .maybeSingle();

      const payload = {
        user_email: userEmail,
        user_name: profile.name,
        user_phone: profile.phone,
        user_address: profile.address,
        user_city: profile.city,
        user_state: profile.state,
        user_zip: profile.zip,
        user_country: profile.country,
      };

      const { error } = existing
        ? await (supabase.from('User_details') as any).update(payload).eq('user_email', userEmail)
        : await (supabase.from('User_details') as any).insert([payload]);

      if (error) throw error;
      toast({ title: 'Profile updated', description: 'Your information has been saved.' });
    } catch (err: any) {
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    let updatedList: Address[];

    if (editingAddressId) {
      updatedList = additionalAddresses.map((a) => (a.id === editingAddressId ? { ...addressForm, id: editingAddressId } : a));
    } else {
      updatedList = [...additionalAddresses, { ...addressForm, id: String(Date.now()) }];
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
      toast({ title: 'Addresses updated', description: 'Destination saved.' });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    }
  };

  const handleDeleteAddress = async (id: string) => {
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
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 pointer-events-auto"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 15 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-4 md:inset-x-12 md:inset-y-8 lg:inset-x-24 lg:inset-y-10 max-w-6xl mx-auto z-50 bg-[#FAF9F5] text-black rounded-3xl overflow-hidden flex flex-col md:flex-row shadow-2xl pointer-events-auto border border-black/10"
          >
            {/* Sidebar */}
            <div className="w-full md:w-80 bg-[#0E0E0E] text-white border-b md:border-b-0 md:border-r border-white/10 p-6 md:p-8 flex flex-col justify-between shrink-0 relative overflow-hidden">
              <div className="space-y-8 relative z-10">
                {/* User info header */}
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-700 text-white font-dm font-medium text-xl flex items-center justify-center shrink-0 shadow-md">
                    {profile.name ? profile.name.split(' ').map((n) => n[0]).join('') : 'U'}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-dm font-normal text-lg truncate text-white tracking-[-0.02em]">
                      {profile.name || 'Customer Account'}
                    </h3>
                    <p className="font-inter text-xs text-white/50 truncate flex items-center gap-1.5 mt-0.5">
                      <Mail className="w-3.5 h-3.5" /> {user?.email}
                    </p>
                  </div>
                </div>

                <div className="h-px bg-white/10" />

                {/* Tab Navigation */}
                <div className="flex md:flex-col gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
                  {[
                    { id: 'profile', label: 'Profile Information', desc: 'Name, phone & primary address', icon: User },
                    { id: 'addresses', label: 'Shipping Destinations', desc: 'Saved delivery addresses', icon: MapPin },
                    { id: 'orders', label: 'My Orders', desc: 'Order history & status', icon: ShoppingBag },
                    { id: 'security', label: 'Security & Login', desc: 'Password & account protection', icon: Lock },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isSelected = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex items-center gap-3.5 px-4 py-3 rounded-xl text-left whitespace-nowrap md:whitespace-normal transition-all duration-300 w-full group relative ${
                          isSelected
                            ? 'bg-white text-black shadow-lg'
                            : 'text-white/60 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <div className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${isSelected ? 'bg-black/10 text-black' : 'bg-white/5 text-white/70'}`}>
                          <Icon className="w-4 h-4 shrink-0" />
                        </div>
                        <div className="hidden md:block min-w-0">
                          <p className="font-dm text-sm font-medium leading-tight">{tab.label}</p>
                          <p className={`font-inter text-[11px] truncate leading-none mt-1 ${isSelected ? 'text-black/60' : 'text-white/40'}`}>{tab.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={onClose}
                className="hidden md:flex items-center justify-center gap-2 h-11 border border-white/20 rounded-xl font-inter text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white transition-all relative z-10"
              >
                Close Settings
              </button>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[#FAF9F5]">
              {/* Header Bar */}
              <div className="flex items-center justify-between px-8 h-18 border-b border-black/8 shrink-0 bg-[#FEFDF9]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  <span className="font-inter text-xs font-medium text-black/50 uppercase tracking-wider">
                    {activeTab === 'profile' && 'Account Settings'}
                    {activeTab === 'addresses' && 'Saved Destinations'}
                    {activeTab === 'orders' && 'Order History'}
                    {activeTab === 'security' && 'Security & Password'}
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-xl bg-black/5 hover:bg-black/10 text-black/60 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Tab Content */}
              <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-6">
                {/* ── PROFILE TAB ── */}
                {activeTab === 'profile' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl space-y-6">
                    <div className="bg-[#FEFDF9] p-6 sm:p-8 rounded-3xl border border-black/5 shadow-sm">
                      <h3 className="font-dm font-normal text-2xl text-black tracking-[-0.03em] mb-1">
                        Personal Details
                      </h3>
                      <p className="font-inter text-sm text-black/60 mb-6">
                        Keep your contact details up to date for order notifications and shipping.
                      </p>

                      <form onSubmit={handleUpdateProfile} className="space-y-5 font-inter">
                        <div className="grid sm:grid-cols-2 gap-5">
                          <div>
                            <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">Full Name</label>
                            <input
                              type="text"
                              required
                              value={profile.name}
                              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                              placeholder="Jane Doe"
                              className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                            />
                          </div>
                          <div>
                            <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">Phone Number</label>
                            <input
                              type="tel"
                              value={profile.phone}
                              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                              placeholder="+91 9876543210"
                              className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                            />
                          </div>
                        </div>

                        <div className="h-px bg-black/8 my-6" />

                        <h4 className="font-dm text-lg text-black font-medium mb-3">Primary Shipping Address</h4>

                        <div>
                          <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">Street Address</label>
                          <input
                            type="text"
                            value={profile.address}
                            onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                            placeholder="Street name, house/apartment number"
                            className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                          />
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div className="col-span-2">
                            <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">City</label>
                            <input
                              type="text"
                              value={profile.city}
                              onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                              placeholder="City"
                              className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                            />
                          </div>
                          <div>
                            <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">State</label>
                            <input
                              type="text"
                              value={profile.state}
                              onChange={(e) => setProfile({ ...profile, state: e.target.value })}
                              placeholder="State"
                              className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                            />
                          </div>
                          <div>
                            <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">ZIP Code</label>
                            <input
                              type="text"
                              value={profile.zip}
                              onChange={(e) => setProfile({ ...profile, zip: e.target.value })}
                              placeholder="ZIP"
                              className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={profileLoading}
                          className="bg-black text-white px-6 py-3.5 rounded-xl font-inter font-medium text-sm hover:bg-black/85 transition-colors shadow-md flex items-center gap-2"
                        >
                          <span>{profileLoading ? 'Saving...' : 'Save Profile Changes'}</span>
                          <Check className="w-4 h-4" />
                        </button>
                      </form>
                    </div>
                  </motion.div>
                )}

                {/* ── ADDRESSES TAB ── */}
                {activeTab === 'addresses' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-dm font-normal text-2xl text-black tracking-[-0.03em]">Saved Destinations</h3>
                        <p className="font-inter text-sm text-black/60">Manage secondary addresses for quick checkout.</p>
                      </div>

                      <button
                        onClick={() => {
                          setEditingAddressId(null);
                          setAddressForm({ label: '', address: '', city: '', state: '', zip: '', country: '' });
                          setShowAddressForm(!showAddressForm);
                        }}
                        className="bg-black text-white px-4 py-2.5 rounded-xl font-inter font-medium text-xs flex items-center gap-2 hover:bg-black/85 transition-colors shadow-md"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add New Address</span>
                      </button>
                    </div>

                    {showAddressForm && (
                      <div className="bg-[#FEFDF9] p-6 rounded-3xl border border-black/10 shadow-lg font-inter">
                        <h4 className="font-dm text-lg text-black font-medium mb-4">
                          {editingAddressId ? 'Edit Address' : 'New Address'}
                        </h4>

                        <form onSubmit={handleSaveAddress} className="space-y-4">
                          <div>
                            <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">Label (e.g. Home, Office)</label>
                            <input
                              type="text"
                              required
                              value={addressForm.label}
                              onChange={(e) => setAddressForm({ ...addressForm, label: e.target.value })}
                              placeholder="Office"
                              className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                            />
                          </div>

                          <div>
                            <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">Street Address</label>
                            <input
                              type="text"
                              required
                              value={addressForm.address}
                              onChange={(e) => setAddressForm({ ...addressForm, address: e.target.value })}
                              placeholder="123 Business Park Rd"
                              className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                            />
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            <div>
                              <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">City</label>
                              <input
                                type="text"
                                required
                                value={addressForm.city}
                                onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })}
                                placeholder="City"
                                className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                              />
                            </div>
                            <div>
                              <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">State</label>
                              <input
                                type="text"
                                value={addressForm.state}
                                onChange={(e) => setAddressForm({ ...addressForm, state: e.target.value })}
                                placeholder="State"
                                className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                              />
                            </div>
                            <div>
                              <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">ZIP</label>
                              <input
                                type="text"
                                value={addressForm.zip}
                                onChange={(e) => setAddressForm({ ...addressForm, zip: e.target.value })}
                                placeholder="ZIP"
                                className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                              />
                            </div>
                          </div>

                          <div className="flex gap-3 pt-2">
                            <button
                              type="submit"
                              className="bg-black text-white px-5 py-3 rounded-xl font-inter font-medium text-xs hover:bg-black/85 transition-colors"
                            >
                              Save Address
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowAddressForm(false)}
                              className="border border-black/15 text-black px-5 py-3 rounded-xl font-inter font-medium text-xs hover:bg-black/5 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                    <div className="space-y-4">
                      {additionalAddresses.map((addr) => (
                        <div key={addr.id} className="bg-[#FEFDF9] p-6 rounded-2xl border border-black/5 flex items-center justify-between shadow-sm">
                          <div>
                            <span className="px-3 py-1 rounded-full bg-black/5 font-inter text-xs font-medium text-black uppercase tracking-wider block mb-2 w-fit">
                              {addr.label}
                            </span>
                            <p className="font-dm text-base text-black">{addr.address}</p>
                            <p className="font-inter text-xs text-black/50">
                              {addr.city}, {addr.state} {addr.zip}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setEditingAddressId(addr.id);
                                setAddressForm(addr);
                                setShowAddressForm(true);
                              }}
                              className="p-2 text-black/40 hover:text-black transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteAddress(addr.id)}
                              className="p-2 text-black/40 hover:text-rose-600 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}

                      {additionalAddresses.length === 0 && !showAddressForm && (
                        <div className="text-center py-12 text-black/40 font-inter text-sm bg-[#FEFDF9] rounded-2xl border border-black/5">
                          No additional addresses saved yet.
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* ── ORDERS TAB ── */}
                {activeTab === 'orders' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-dm font-normal text-2xl text-black tracking-[-0.03em]">Order History</h3>
                        <p className="font-inter text-sm text-black/60">View and track your previous purchases.</p>
                      </div>

                      {/* Sort Dropdown */}
                      <div className="relative">
                        <button
                          onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                          className="flex items-center gap-2 bg-[#FEFDF9] border border-black/10 rounded-xl px-4 py-2 font-inter text-xs text-black hover:border-black/25 transition-colors"
                        >
                          <span>Sort: {sortOptions.find((o) => o.value === sortBy)?.label}</span>
                          <ChevronDown className="w-3.5 h-3.5 text-black/40" />
                        </button>

                        {sortDropdownOpen && (
                          <div className="absolute right-0 mt-2 w-48 bg-[#FEFDF9] border border-black/10 rounded-xl shadow-xl z-20 overflow-hidden font-inter text-xs">
                            {sortOptions.map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => {
                                  setSortBy(opt.value as any);
                                  setSortDropdownOpen(false);
                                }}
                                className={`w-full text-left px-4 py-2.5 transition-colors hover:bg-[#F4F3EE] ${sortBy === opt.value ? 'font-medium text-black' : 'text-black/60'}`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {ordersLoading ? (
                      <div className="space-y-4">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className="h-28 bg-[#FEFDF9] rounded-2xl animate-pulse border border-black/5" />
                        ))}
                      </div>
                    ) : processedOrders.length === 0 ? (
                      <div className="text-center py-16 text-black/40 font-inter text-sm bg-[#FEFDF9] rounded-2xl border border-black/5">
                        No orders placed yet.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {processedOrders.map((order) => {
                          const rawDate = order.created_at || order.order_created_at;
                          const formattedDate = rawDate && !isNaN(new Date(rawDate).getTime())
                            ? new Date(rawDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                            : 'Recently';

                          const itemsList = order.order_items || [];

                          return (
                            <div key={order.id} className="bg-[#FEFDF9] p-6 rounded-2xl border border-black/5 shadow-sm space-y-4">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-black/8 font-inter text-xs text-black/60">
                                <div className="flex items-center gap-3">
                                  <span className="font-dm font-normal text-base text-black">
                                    Order #{String(order.order_number || order.id || '').slice(0, 8)}
                                  </span>
                                  <span className={`px-3 py-1 rounded-full text-[11px] font-medium uppercase tracking-wider ${
                                    order.status === 'completed' || order.status === 'delivered'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}>
                                    {order.status || 'Processing'}
                                  </span>
                                </div>

                                <div className="flex items-center gap-4 text-black/60">
                                  <span>{formattedDate}</span>
                                  <span className="font-dm font-normal text-lg text-black font-semibold">
                                    ₹{Number(order.total_amount || 0).toLocaleString('en-IN')}
                                  </span>
                                </div>
                              </div>

                              {/* Purchased Items List */}
                              {itemsList.length > 0 && (
                                <div className="space-y-2 pt-1">
                                  {itemsList.map((item: any, idx: number) => {
                                    const prodName = item.products?.name || item.product_id || 'Moringa Product';
                                    const qty = item.quantity || 1;
                                    const unitPrice = item.unit_price || item.total_price || 0;

                                    return (
                                      <div key={item.id || idx} className="flex items-center justify-between text-xs font-inter bg-[#F4F3EE]/50 p-2.5 rounded-xl border border-black/5">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                          <div className="w-7 h-7 rounded-lg bg-emerald-800/10 flex items-center justify-center text-emerald-900 font-bold text-[10px] shrink-0">
                                            {qty}x
                                          </div>
                                          <span className="font-medium text-black truncate">{prodName}</span>
                                        </div>
                                        <span className="font-semibold text-black/80 shrink-0 ml-2">
                                          ₹{Number(unitPrice * qty).toLocaleString('en-IN')}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              <p className="font-inter text-xs text-black/50 pt-1">
                                Deliver to: {typeof order.shipping_address === 'object' && order.shipping_address?.address
                                  ? `${order.shipping_address.address}, ${order.shipping_address.city || ''}`
                                  : 'Primary Shipping Address'}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                )}

                {/* ── SECURITY TAB ── */}
                {activeTab === 'security' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl">
                    <div className="bg-[#FEFDF9] p-6 sm:p-8 rounded-3xl border border-black/5 shadow-sm font-inter">
                      <h3 className="font-dm font-normal text-2xl text-black tracking-[-0.03em] mb-1">
                        Change Password
                      </h3>
                      <p className="text-sm text-black/60 mb-6">
                        Update your account password for enhanced security.
                      </p>

                      <form onSubmit={handleUpdatePassword} className="space-y-4">
                        <div>
                          <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">New Password</label>
                          <input
                            type="password"
                            required
                            minLength={6}
                            value={password.new}
                            onChange={(e) => setPassword({ ...password, new: e.target.value })}
                            placeholder="••••••••"
                            className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                          />
                        </div>

                        <div>
                          <label className="text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">Confirm New Password</label>
                          <input
                            type="password"
                            required
                            minLength={6}
                            value={password.confirm}
                            onChange={(e) => setPassword({ ...password, confirm: e.target.value })}
                            placeholder="••••••••"
                            className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={securityLoading}
                          className="bg-black text-white px-6 py-3.5 rounded-xl font-inter font-medium text-sm hover:bg-black/85 transition-colors shadow-md flex items-center gap-2 mt-2"
                        >
                          <span>{securityLoading ? 'Updating...' : 'Update Password'}</span>
                          <Check className="w-4 h-4" />
                        </button>
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
