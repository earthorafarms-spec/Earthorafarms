import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, Phone, MapPin, Clock, Send, MessageSquare } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

const contactInfo = [
  { icon: Mail, label: "Email", value: "contactus@earthorafarms.com", href: "mailto:contactus@earthorafarms.com" },
  { icon: Phone, label: "Phone", value: "+91 9228153821", href: "tel:+919228153821" },
  { icon: MapPin, label: "Farm Location", value: "123 Green Valley Rd, Aptos, CA 95003" },
  { icon: Clock, label: "Operating Hours", value: "Mon – Fri, 9 AM – 6 PM IST" },
];

export default function Contact() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    topic: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  // Helper to detect programming code, HTML tags, scripts, and SQL syntax
  const containsCode = (text: string): boolean => {
    if (!text) return false;
    const codePatterns = [
      /<[a-z][\s\S]*>/i,                 // HTML/XML tags (<script>, <div>, <iframe>, etc.)
      /javascript\s*:/i,                  // javascript: protocol
      /on\w+\s*=/i,                       // Event handlers (onload=, onerror=, etc.)
      /eval\s*\(/i,                       // JS eval()
      /alert\s*\(/i,                      // JS alert()
      /console\.(log|error|warn)\s*\(/i, // Console calls
      /function\s*\w*\s*\(/i,            // JS function definition
      /const\s+\w+\s*=/i,                // JS const declaration
      /let\s+\w+\s*=/i,                  // JS let declaration
      /var\s+\w+\s*=/i,                  // JS var declaration
      /import\s+[\s\S]+from/i,           // JS import statement
      /<\?php/i,                         // PHP opening tags
      /SELECT\s+[\s\S]+FROM/i,            // SQL SELECT
      /INSERT\s+INTO/i,                   // SQL INSERT
      /DROP\s+TABLE/i,                    // SQL DROP
      /DELETE\s+FROM/i,                  // SQL DELETE
      /EXEC\s*\(/i,                       // SQL EXEC
      /[{}]/                             // Code block braces (prevent JSON/script blocks)
    ];
    return codePatterns.some((pattern) => pattern.test(text));
  };

  // Strip unsafe characters (< > { }) automatically
  const sanitizeInput = (val: string): string => {
    return val.replace(/[<>{}]/g, "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 1. Block any submission containing programming code or scripts
    if (containsCode(form.name) || containsCode(form.topic) || containsCode(form.message)) {
      setError("Security Violation: Programming code, HTML tags, script snippets, or code blocks are not permitted in the contact form.");
      toast({
        title: "Code not allowed",
        description: "Please remove any programming code or HTML tags from your message.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    // Sanitize input values
    const cleanName = sanitizeInput(form.name);
    const cleanEmail = form.email.trim();
    const cleanPhone = sanitizeInput(form.phone);
    const cleanTopic = sanitizeInput(form.topic);
    const cleanMessage = sanitizeInput(form.message);

    try {
      const { error: dbErr } = await (supabase.from("Contact_details") as any)
        .insert({
          contact_name: cleanName,
          contact_email: cleanEmail,
          contact_phone: cleanPhone,
          contact_topic: cleanTopic,
          contact_message: cleanMessage,
        });

      if (dbErr) throw dbErr;

      // Call the edge function to send email notification
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

        await fetch(`${supabaseUrl}/functions/v1/send-contact-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            topic: cleanTopic,
            message: cleanMessage,
          }),
        });
      } catch (emailErr) {
        console.warn("[Contact] Email notification warning:", emailErr);
      }

      setForm({ name: "", email: "", phone: "", topic: "", message: "" });
      toast({ title: "Message sent", description: "Thanks for reaching out. We will reply as soon as possible." });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to send your message right now.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
      <Navbar />

      {/* ── UNIQUE HERO: Organic Clean Centered Header ── */}
      <section className="relative pt-36 lg:pt-40 pb-12 lg:pb-16 text-center">
        <div className="container mx-auto px-6 max-w-3xl">
          <motion.span
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-inter text-xs font-semibold uppercase tracking-widest text-emerald-800 mb-3 block"
          >
            We're Here For You
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="font-dm font-normal tracking-[-0.05em] text-[42px] leading-[44px] sm:text-[60px] sm:leading-[56px] lg:text-[72px] lg:leading-[66px] text-black mb-4"
          >
            Let's Start a Conversation.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="font-inter text-base sm:text-lg text-black/60 leading-relaxed"
          >
            Have questions about our moringa, order tracking, or wholesale options? Drop us a note below and our farm team will reply within 24 hours.
          </motion.p>
        </div>
      </section>

      {/* ── Main Contact Section ── */}
      <section className="py-8 lg:py-16">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16">
            {/* Info Cards Column */}
            <div className="lg:col-span-5 space-y-6">
              <div className="mb-4">
                <h2 className="font-dm font-normal text-3xl text-black tracking-[-0.04em] mb-1">
                  Direct Channels
                </h2>
                <p className="font-inter text-sm text-black/60">
                  Reach out directly via email or telephone.
                </p>
              </div>

              {contactInfo.map((info, idx) => (
                <div
                  key={idx}
                  className="bg-[#FEFDF9] rounded-2xl p-6 border border-black/5 flex items-start gap-5 shadow-sm"
                >
                  <div className="w-12 h-12 rounded-xl bg-black text-white flex items-center justify-center shrink-0">
                    <info.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-inter text-xs text-black/40 uppercase tracking-wider font-medium block mb-1">
                      {info.label}
                    </span>
                    {info.href ? (
                      <a href={info.href} className="font-dm text-xl text-black hover:text-emerald-800 transition-colors tracking-[-0.02em]">
                        {info.value}
                      </a>
                    ) : (
                      <span className="font-dm text-xl text-black tracking-[-0.02em]">
                        {info.value}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Form Column */}
            <div className="lg:col-span-7">
              <div className="bg-[#FEFDF9] rounded-3xl p-8 sm:p-12 border border-black/5 shadow-xl">
                <h2 className="font-dm font-normal text-3xl sm:text-4xl text-black tracking-[-0.04em] mb-2">
                  Send a Message
                </h2>
                <p className="font-inter text-sm text-black/60 mb-8">
                  Fill out the form below and our wellness support team will reply within 24 hours.
                </p>

                {error && (
                  <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-inter text-sm">
                    {error}
                  </div>
                )}

                <form
                  onSubmit={handleSubmit}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    toast({
                      title: "File attachments disabled",
                      description: "File uploads are disabled on this contact form for security.",
                      variant: "destructive",
                    });
                  }}
                  className="space-y-6"
                >
                  <div className="grid sm:grid-cols-2 gap-6">
                    <div>
                      <label className="font-inter text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: sanitizeInput(e.target.value) })}
                        placeholder="John Doe"
                        className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 font-inter text-sm text-black placeholder:text-black/30 focus:outline-none focus:border-black/30 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="font-inter text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">
                        Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value.replace(/[<>{}]/g, "") })}
                        placeholder="john@example.com"
                        className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 font-inter text-sm text-black placeholder:text-black/30 focus:outline-none focus:border-black/30 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-6">
                    <div>
                      <label className="font-inter text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: sanitizeInput(e.target.value) })}
                        placeholder="+1 (555) 000-0000"
                        className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 font-inter text-sm text-black placeholder:text-black/30 focus:outline-none focus:border-black/30 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="font-inter text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">
                        Topic
                      </label>
                      <input
                        type="text"
                        value={form.topic}
                        onChange={(e) => setForm({ ...form, topic: sanitizeInput(e.target.value) })}
                        placeholder="General Inquiry, Order Status..."
                        className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 font-inter text-sm text-black placeholder:text-black/30 focus:outline-none focus:border-black/30 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="font-inter text-xs uppercase tracking-wider text-black/60 font-medium block mb-2">
                      Message
                    </label>
                    <textarea
                      required
                      rows={5}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: sanitizeInput(e.target.value) })}
                      placeholder="How can we help you?"
                      className="w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 font-inter text-sm text-black placeholder:text-black/30 focus:outline-none focus:border-black/30 transition-colors resize-none"
                    />
                  </div>

                  <p className="font-inter text-[11px] text-black/40 text-center">
                    🔒 File attachments and programming scripts/code snippets are disabled for form security.
                  </p>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-black text-white py-4 rounded-xl font-inter font-medium text-base hover:bg-black/85 transition-colors shadow-lg flex items-center justify-center gap-2 group disabled:opacity-50"
                  >
                    <span>{submitting ? "Sending..." : "Send Message"}</span>
                    <Send className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
