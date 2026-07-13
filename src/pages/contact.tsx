import { motion } from "framer-motion";
import { Mail, Phone, MapPin, Clock, Send } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import leavesImg from "@assets/generated_images/hero_leaves.jpg";

const contactInfo = [
  { icon: Mail, label: "Email", value: "hello@earthorafarms.com", href: "mailto:hello@earthorafarms.com" },
  { icon: Phone, label: "Phone", value: "+1 (555) 123-4567", href: "tel:+15551234567" },
  { icon: MapPin, label: "Address", value: "123 Green Valley Rd, Aptos, CA 95003" },
  { icon: Clock, label: "Hours", value: "Mon – Fri, 9 AM – 6 PM PST" },
];

export default function Contact() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/20">
      <Navbar />

      <section className="relative pt-40 pb-24 md:pt-48 md:pb-32 overflow-hidden bg-primary">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05)_0,transparent_70%)]" />
        <div className="container mx-auto px-6 max-w-7xl relative z-10">
          <div className="max-w-3xl">


            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="text-5xl md:text-7xl font-serif text-primary-foreground leading-[1.1] tracking-tight mb-6"
            >
              We'd love to
              <br />
              <span className="text-secondary/90 italic">hear from you.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="text-lg md:text-xl text-primary-foreground/80 font-light max-w-2xl"
            >
              Whether you have a question about our products, want to partner with us, or just want to say hello — we're all ears.
            </motion.p>
          </div>
        </div>
      </section>

      <section className="py-24 md:py-32 bg-background">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="grid lg:grid-cols-5 gap-16 lg:gap-24">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-3"
            >
              <h2 className="text-sm font-medium uppercase tracking-widest text-primary mb-4">Send a Message</h2>
              <h3 className="text-3xl md:text-4xl font-serif text-foreground mb-8">Drop us a line.</h3>

              <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input id="name" placeholder="Jane Doe" className="h-12" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input id="email" type="email" placeholder="jane@example.com" className="h-12" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input id="subject" placeholder="How can we help?" className="h-12" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea id="message" placeholder="Tell us more about what's on your mind..." className="min-h-[160px] resize-none" />
                </div>

                <Button type="submit" size="lg" className="h-14 px-10 text-lg w-full sm:w-auto">
                  <Send className="w-4 h-4 mr-2" />
                  Send Message
                </Button>
              </form>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
              className="lg:col-span-2"
            >
              <div className="sticky top-32">
                <div className="relative aspect-[4/3] rounded-2xl overflow-hidden mb-10">
                  <img src={leavesImg} alt="Earthora Farms" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4">
                    <p className="text-white/90 text-sm font-light italic">Rooted in nature, grown with care.</p>
                  </div>
                </div>

                <div className="space-y-6">
                  {contactInfo.map((item) => (
                    <div key={item.label} className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <item.icon className="w-4 h-4 text-primary" strokeWidth={1.5} />
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-foreground/50 mb-0.5">{item.label}</p>
                        {item.href ? (
                          <a href={item.href} className="text-foreground hover:text-primary transition-colors">
                            {item.value}
                          </a>
                        ) : (
                          <p className="text-foreground">{item.value}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-10 pt-10 border-t border-border">
                  <p className="text-sm text-foreground/60 font-light leading-relaxed">
                    We typically respond within 24 hours during business days. For wholesale inquiries, please mention it in your message.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-24 bg-secondary/30 overflow-hidden">
        <div className="container mx-auto px-6 max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center max-w-2xl mx-auto mb-16"
          >
            <h2 className="text-sm font-medium uppercase tracking-widest text-primary mb-4">Stay Connected</h2>
            <h3 className="text-4xl md:text-5xl font-serif text-foreground mb-6">Follow the journey.</h3>
            <p className="text-foreground/70 font-light text-lg">
              Join our community for seasonal updates, exclusive recipes, and a deeper look into life on the farm.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-wrap justify-center gap-4"
          >
            {["Instagram", "Facebook", "Pinterest", "TikTok"].map((platform) => (
              <a
                key={platform}
                href="#"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border bg-card hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-300 text-sm font-medium"
              >
                {platform}
              </a>
            ))}
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
