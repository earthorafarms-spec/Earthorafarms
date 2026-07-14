import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section className="relative py-32 overflow-hidden bg-primary">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06)_0,transparent_100%)]" />
      
      <div className="container mx-auto px-6 max-w-4xl relative z-10 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="text-5xl md:text-7xl font-serif text-primary-foreground mb-8 leading-tight">
            Ready to feel alive?
          </h2>
          <p className="text-xl text-primary-foreground/80 mb-12 font-light max-w-2xl mx-auto">
            Join thousands who have transformed their morning ritual with the pure, unmatched potency of Earthora.
          </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center max-w-md mx-auto sm:max-w-none">
              <Link href="/our-product" className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto bg-primary-foreground text-primary hover:bg-secondary h-14 px-8 text-lg">
                  Shop the Collection
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="w-full sm:w-auto border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary h-14 px-8 text-lg">
                Join the Newsletter
              </Button>
            </div>
        </motion.div>
      </div>
    </section>
  );
}
