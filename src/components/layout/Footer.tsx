export function Footer() {
  return (
    <footer className="bg-foreground text-primary-foreground pt-20 pb-10">
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-20">
          <div className="col-span-2">
            <span className="font-serif text-3xl font-semibold tracking-tight block mb-6">
              Earthora
            </span>
            <p className="text-primary-foreground/60 font-light">
              <span className="whitespace-nowrap">The Ancient Tree of Life.</span> Reimagined for modern vitality. 100% pure, organic, sun-grown moringa.
            </p>
          </div>
          
          <div>
            <h4 className="font-medium mb-6">Shop</h4>
            <ul className="space-y-4 text-primary-foreground/60 text-sm font-light">
              <li><a href="/our-product" className="hover:text-white transition-colors">Moringa Powder</a></li>
              <li><a href="/our-product" className="hover:text-white transition-colors">Moringa Tablets</a></li>
              <li><a href="/our-product" className="hover:text-white transition-colors">Moringa Capsules</a></li>
              <li><a href="/our-product" className="hover:text-white transition-colors">Bundles</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-medium mb-6">Company</h4>
            <ul className="space-y-4 text-primary-foreground/60 text-sm font-light">
              <li><a href="/" className="hover:text-white transition-colors">Home</a></li>
              <li><a href="/gallery" className="hover:text-white transition-colors">Gallery</a></li>
              <li><a href="/recipes" className="hover:text-white transition-colors">Recipes</a></li>
              <li><a href="/contact" className="hover:text-white transition-colors">Contact</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-primary-foreground/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-primary-foreground/40">
          <p>© {new Date().getFullYear()} Earthora. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
