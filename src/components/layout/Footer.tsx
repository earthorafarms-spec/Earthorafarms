import { Instagram, Youtube, Twitter, ArrowUpRight, Leaf } from "lucide-react";

const shopLinks = [
  { label: "Moringa Powder", href: "/products" },
  { label: "Moringa Tablets", href: "/products" },
  { label: "Wellness Bundles", href: "/products" },
];

const exploreLinks = [
  { label: "Our Story", href: "/" },
  { label: "Health Benefits", href: "/#benefits" },
  { label: "Wellness Recipes", href: "/recipes" },
  { label: "Gallery", href: "/gallery" },
];

const supportLinks = [
  { label: "Contact Us", href: "/contact" },
  { label: "Shipping Policy", href: "#" },
  { label: "Returns & Refunds", href: "#" },
  { label: "FAQ", href: "#" },
];

export function Footer() {
  return (
    <footer className="bg-[#0F2318] text-white selection:bg-white selection:text-black">
      {/* Top Section */}
      <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] pt-16 lg:pt-24 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
          {/* Brand Column */}
          <div className="lg:col-span-5">
            {/* Logo */}
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-full bg-emerald-700 flex items-center justify-center">
                <Leaf className="w-4 h-4 text-white" />
              </div>
              <span className="font-dm font-medium text-[26px] tracking-[-0.05em] text-white">
                Earthora
              </span>
            </div>

            <p className="font-inter font-normal text-sm sm:text-base text-white/55 leading-[1.7] tracking-[-0.02em] max-w-[380px] mb-8">
              Pure, shade-dried Moringa oleifera grown in volcanic soil. No additives. No compromises. Just the ancient tree of life, reimagined for your modern wellness ritual.
            </p>

            {/* Newsletter */}
            <div className="mb-8">
              <p className="font-dm font-medium text-sm text-white/80 mb-3 tracking-wide">
                Join the wellness community
              </p>
              <div className="flex items-stretch gap-2 max-w-sm">
                <input
                  type="email"
                  placeholder="Your email address"
                  className="flex-1 bg-white/8 border border-white/15 rounded-xl px-4 py-3 font-inter text-sm text-white placeholder:text-white/35 focus:outline-none focus:border-white/35 transition-colors"
                />
                <button
                  type="button"
                  className="bg-white text-black px-5 rounded-xl font-inter font-medium text-sm hover:bg-white/90 transition-colors shrink-0 flex items-center gap-1.5 group"
                >
                  <span>Join</span>
                  <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </button>
              </div>
            </div>

            {/* Social Icons */}
            <div className="flex items-center gap-3">
              {[
                { Icon: Instagram, label: "Instagram", href: "#" },
                { Icon: Youtube, label: "YouTube", href: "#" },
                { Icon: Twitter, label: "Twitter / X", href: "#" },
              ].map(({ Icon, label, href }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="w-10 h-10 rounded-full border border-white/15 flex items-center justify-center text-white/50 hover:text-white hover:border-white/40 transition-all"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Links Columns */}
          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-10 lg:pt-2">
            {/* Shop */}
            <div>
              <h4 className="font-dm font-medium text-sm text-white mb-5 tracking-[0.03em] uppercase">
                Shop
              </h4>
              <ul className="space-y-3">
                {shopLinks.map(({ label, href }) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="font-inter text-sm text-white/50 hover:text-white transition-colors tracking-[-0.01em]"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Explore */}
            <div>
              <h4 className="font-dm font-medium text-sm text-white mb-5 tracking-[0.03em] uppercase">
                Explore
              </h4>
              <ul className="space-y-3">
                {exploreLinks.map(({ label, href }) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="font-inter text-sm text-white/50 hover:text-white transition-colors tracking-[-0.01em]"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Support */}
            <div>
              <h4 className="font-dm font-medium text-sm text-white mb-5 tracking-[0.03em] uppercase">
                Support
              </h4>
              <ul className="space-y-3">
                {supportLinks.map(({ label, href }) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="font-inter text-sm text-white/50 hover:text-white transition-colors tracking-[-0.01em]"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Large Brand Wordmark Divider */}
      <div className="border-t border-white/8 overflow-hidden">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <p
            className="font-dm font-normal tracking-[-0.05em] text-white/5 select-none pointer-events-none"
            style={{ fontSize: "clamp(80px, 15vw, 240px)", lineHeight: 0.85 }}
            aria-hidden="true"
          >
            Earthora
          </p>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-white/8">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="font-inter text-xs text-white/30 tracking-[-0.01em]">
            © {new Date().getFullYear()} Earthora Farms Pvt. Ltd. All rights reserved.
          </p>
          <div className="flex items-center gap-6 font-inter text-xs text-white/30">
            <a href="#" className="hover:text-white/70 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white/70 transition-colors">Terms of Use</a>
            <a href="#" className="hover:text-white/70 transition-colors">Cookie Settings</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
