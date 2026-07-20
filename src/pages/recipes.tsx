import { useState, useEffect } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Clock, User, Leaf, X, ChevronRight } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";

import recipeSmoothie from "@assets/generated_images/recipe_smoothie.png";
import leavesImg from "@assets/generated_images/hero_leaves.jpg";
import smoothieImg2 from "@assets/generated_images/lifestyle_smoothie_2.jpg";
import powderImg2 from "@assets/generated_images/product_powder_2.jpg";
import leavesImg2 from "@assets/generated_images/hero_leaves_2.jpg";
import smoothieImg from "@assets/generated_images/lifestyle_smoothie.jpg";

interface Recipe {
  title: string;
  description: string;
  image: string;
  time: string;
  author: string;
  tags: string[];
  ingredients: string[];
  instructions: string[];
}

const recipes: Recipe[] = [
  {
    title: "Green Morning Smoothie",
    description: "A vibrant, energy-packed smoothie that transforms your morning routine into a nourishing ritual.",
    image: recipeSmoothie,
    time: "5 min",
    author: "Earthora Kitchen",
    tags: ["Smoothie", "Breakfast", "Vegan"],
    ingredients: [
      "1 tsp Earthora Moringa Powder",
      "1 ripe banana",
      "1 cup fresh spinach leaves",
      "1 cup unsweetened almond milk",
      "1 tbsp organic raw honey",
      "Handful of ice cubes"
    ],
    instructions: [
      "Combine all ingredients in a high-speed blender, starting with the liquid.",
      "Blend on high for 45-60 seconds until completely smooth and creamy.",
      "Pour into a tall glass, garnish with a mint leaf if desired, and enjoy fresh."
    ]
  },
  {
    title: "Moringa & Ginger Wellness Shot",
    description: "A concentrated wellness boost ΓÇö bright, invigorating, and packed with antioxidants to start your day.",
    image: leavesImg,
    time: "3 min",
    author: "Earthora Kitchen",
    tags: ["Shot", "Wellness", "Immune"],
    ingredients: [
      "1/2 tsp Earthora Moringa Powder",
      "1 inch fresh ginger root",
      "Juice of 1 fresh lemon",
      "1 tbsp warm water",
      "Pinch of cayenne pepper"
    ],
    instructions: [
      "Grate the fresh ginger root finely and squeeze it to extract raw ginger juice.",
      "In a small container, whisk the moringa powder with warm water until fully dissolved.",
      "Stir in the fresh lemon juice and the extracted ginger juice.",
      "Add a pinch of cayenne pepper, stir well, and drink immediately."
    ]
  },
  {
    title: "Tropical Moringa Bowl",
    description: "A creamy, dreamy acai-style bowl with the added nutritional depth of fresh moringa.",
    image: smoothieImg2,
    time: "10 min",
    author: "Earthora Kitchen",
    tags: ["Bowl", "Breakfast", "Gluten-Free"],
    ingredients: [
      "1 tsp Earthora Moringa Powder",
      "1 frozen sliced banana",
      "1/2 cup frozen mango chunks",
      "1/4 cup light coconut milk",
      "Toppings: granola, chia seeds, shredded coconut, fresh berries"
    ],
    instructions: [
      "Add the frozen banana slices, mango chunks, coconut milk, and moringa powder to a food processor or high-speed blender.",
      "Blend on low, using a tamper to push down the ingredients, until a thick, ice-cream-like consistency is achieved.",
      "Spoon into a cold serving bowl and arrange your toppings beautifully before eating."
    ]
  },
  {
    title: "Moringa Matcha Latte",
    description: "The ultimate superfood latte ΓÇö earthy moringa meets ceremonial matcha for a calm, focused energy.",
    image: powderImg2,
    time: "7 min",
    author: "Earthora Kitchen",
    tags: ["Drink", "Latte", "Warm"],
    ingredients: [
      "1/2 tsp Earthora Moringa Powder",
      "1 tsp ceremonial matcha powder",
      "1 cup warm oat milk",
      "1 tsp pure maple syrup",
      "Dash of organic cinnamon"
    ],
    instructions: [
      "Sift the matcha and moringa powder into a wide mug to remove any clumps.",
      "Add 2 oz of hot water (about 80┬░C/175┬░F) and whisk in a W-motion using a bamboo whisk until a frothy layer forms.",
      "Warm and froth the oat milk until pillowy.",
      "Slowly pour the frothed oat milk into the mug, stir in maple syrup, and finish with a dash of cinnamon."
    ]
  },
  {
    title: "Moringa Pesto Pasta",
    description: "A vibrant twist on classic pesto ΓÇö moringa adds an earthy depth and a stunning emerald hue.",
    image: leavesImg2,
    time: "20 min",
    author: "Earthora Kitchen",
    tags: ["Dinner", "Pasta", "Plant-Based"],
    ingredients: [
      "1 tbsp Earthora Moringa Powder",
      "200g artisanal pasta",
      "1/2 cup fresh sweet basil leaves",
      "1/4 cup toasted pine nuts",
      "2 tbsp extra virgin olive oil",
      "1 garlic clove, minced",
      "Pinch of sea salt"
    ],
    instructions: [
      "Boil your pasta in heavily salted water according to the package directions.",
      "While pasta cooks, blend basil, pine nuts, garlic, olive oil, moringa powder, and salt in a food processor until smooth.",
      "Drain the pasta, reserving 1/4 cup of the starchy cooking water.",
      "Toss the hot pasta with the moringa pesto, slowly adding splash of cooking water to create a silky coating."
    ]
  },
  {
    title: "Moringa Energy Bites",
    description: "No-bake, nutrient-dense bites that travel anywhere ΓÇö your pocket-sized green vitality.",
    image: smoothieImg,
    time: "15 min",
    author: "Earthora Kitchen",
    tags: ["Snack", "No-Bake", "Meal Prep"],
    ingredients: [
      "1 tbsp Earthora Moringa Powder",
      "1 cup soft Medjool dates, pitted",
      "1/2 cup rolled oats",
      "1/4 cup creamy almond butter",
      "2 tbsp raw cacao nibs",
      "Pinch of pink Himalayan sea salt"
    ],
    instructions: [
      "Place the pitted Medjool dates in a food processor and pulse until they form a sticky paste ball.",
      "Add the rolled oats, almond butter, moringa powder, and salt to the processor.",
      "Pulse until the ingredients are fully integrated and form a cohesive crumbly dough.",
      "Stir in the cacao nibs, roll the dough into 1-inch balls, and place on a tray. Chill for 30 minutes before serving."
    ]
  }
];

const containerVars: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVars: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
};

export default function Recipes() {
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  useEffect(() => {
    if (!selectedRecipe) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedRecipe(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedRecipe]);

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
              Recipes for a
              <br />
              <span className="text-secondary/90 italic">vibrant life.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="text-lg md:text-xl text-primary-foreground/80 font-light max-w-2xl"
            >
              Every recipe is crafted to highlight the pure, earthy depth of moringa while fitting seamlessly into your day.
            </motion.p>
          </div>
        </div>
      </section>

      <section className="py-24 md:py-32 bg-background">
        <div className="container mx-auto px-6 max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center max-w-2xl mx-auto mb-20"
          >
            <h2 className="text-sm font-medium uppercase tracking-widest text-primary mb-4">The Collection</h2>
            <h3 className="text-4xl md:text-5xl font-serif text-foreground mb-6">From Sunrise to Sunset.</h3>
            <p className="text-foreground/70 font-light text-lg">
              Every recipe is crafted to highlight the pure, earthy depth of moringa while fitting seamlessly into your day.
            </p>
          </motion.div>

          <motion.div
            variants={containerVars}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-16"
          >
            {recipes.map((recipe, i) => (
              <motion.article
                key={i}
                variants={itemVars}
                className="group flex flex-col cursor-pointer"
                onClick={() => setSelectedRecipe(recipe)}
              >
                <div className="relative aspect-[4/3] rounded-2xl overflow-hidden mb-5 bg-muted">
                  <img
                    src={recipe.image}
                    alt={recipe.title}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                    {recipe.tags.map((tag) => (
                      <span key={tag} className="px-3 py-1 text-xs font-medium bg-white/90 backdrop-blur-sm text-foreground rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-foreground/50 font-medium mb-3">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {recipe.time}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    {recipe.author}
                  </span>
                </div>

                <h4 className="text-xl font-serif text-foreground mb-2 group-hover:text-primary transition-colors">
                  {recipe.title}
                </h4>

                <p className="text-foreground/70 font-light text-sm leading-relaxed mb-5 flex-1">
                  {recipe.description}
                </p>

                <div className="border-t border-border pt-4 mt-auto">
                  <button
                    className="w-full text-sm font-medium text-primary hover:text-accent transition-colors flex items-center gap-2 group-hover:text-accent"
                  >
                    <Leaf className="w-3.5 h-3.5" />
                    <span>View Full Recipe</span>
                    <ChevronRight className="w-4 h-4 ml-auto transition-transform group-hover:translate-x-1 text-foreground/30" />
                  </button>
                </div>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Recipe Modal Popup */}
      <AnimatePresence>
        {selectedRecipe && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
              onClick={() => setSelectedRecipe(null)}
            />

            {/* Modal Box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-4 md:inset-x-12 md:inset-y-10 lg:inset-x-32 xl:inset-x-64 z-[101] bg-background rounded-3xl overflow-hidden shadow-2xl flex flex-col"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 shrink-0">
                <span className="text-xs font-semibold text-primary/80 uppercase tracking-widest flex items-center gap-1.5">
                  <Leaf className="w-3.5 h-3.5" />
                  Recipe Details
                </span>
                <button
                  onClick={() => setSelectedRecipe(null)}
                  className="p-2 rounded-full hover:bg-muted transition-colors text-foreground/60 hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Scrollable Content */}
              <div className="flex-1 overflow-y-auto">
                <div className="flex flex-col lg:flex-row min-h-full">
                  
                  {/* Left Column: Image & Details */}
                  <div className="lg:w-[45%] bg-muted/30 p-6 md:p-8 lg:p-10 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-border/20">
                    <div>
                      <div className="aspect-[4/3] rounded-2xl overflow-hidden mb-6 shadow-md">
                        <img
                          src={selectedRecipe.image}
                          alt={selectedRecipe.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      
                      <div className="flex flex-wrap gap-2 mb-4">
                        {selectedRecipe.tags.map((tag) => (
                          <span key={tag} className="px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary rounded-md">
                            {tag}
                          </span>
                        ))}
                      </div>

                      <h2 className="text-3xl font-serif text-foreground leading-tight mb-4">
                        {selectedRecipe.title}
                      </h2>
                      <p className="text-foreground/70 font-light text-sm leading-relaxed mb-6">
                        {selectedRecipe.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between border-t border-border/40 pt-6 mt-6">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">{selectedRecipe.time}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">{selectedRecipe.author}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Ingredients & Instructions */}
                  <div className="lg:w-[55%] p-6 md:p-8 lg:p-10 space-y-8">
                    
                    {/* Ingredients Section */}
                    <div>
                      <h3 className="text-xs font-semibold text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Ingredients List
                      </h3>
                      <ul className="grid sm:grid-cols-2 gap-3">
                        {selectedRecipe.ingredients.map((ing) => (
                          <li key={ing} className="text-sm text-foreground/80 font-light flex items-start gap-2.5 bg-card border border-border/40 p-3 rounded-xl shadow-2xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-secondary/80 mt-1.5 shrink-0" />
                            <span>{ing}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Instructions Section */}
                    <div>
                      <h3 className="text-xs font-semibold text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Preparation Steps
                      </h3>
                      <ol className="space-y-4">
                        {selectedRecipe.instructions.map((step, idx) => (
                          <li key={idx} className="flex gap-4">
                            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <p className="text-sm text-foreground/75 font-light leading-relaxed">
                              {step}
                            </p>
                          </li>
                        ))}
                      </ol>
                    </div>

                  </div>

                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <section className="py-24 bg-secondary/30">
        <div className="container mx-auto px-6 max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="text-4xl md:text-5xl font-serif text-foreground mb-6">
              Share your creation
            </h2>
            <p className="text-foreground/70 font-light text-lg mb-10 max-w-2xl mx-auto">
              Tag <span className="text-primary font-medium">@earthorafarms</span> on Instagram for a chance to be featured in our community kitchen.
            </p>
            <Button size="lg" className="h-14 px-8 text-lg">
              Follow Us
            </Button>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
