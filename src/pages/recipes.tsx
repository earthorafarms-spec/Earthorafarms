import { useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Clock, User, Leaf, X, UtensilsCrossed, ChevronRight, BookOpen } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

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
    description: "A concentrated wellness boost — bright, invigorating, and packed with antioxidants to start your day.",
    image: leavesImg,
    time: "3 min",
    author: "Earthora Kitchen",
    tags: ["Shot", "Wellness", "Raw"],
    ingredients: [
      "1/2 tsp Earthora Moringa Powder",
      "1 inch fresh ginger knob",
      "1/2 fresh lemon (juiced)",
      "2 tbsp coconut water or pure filtered water",
      "Pinch of cayenne pepper (optional)"
    ],
    instructions: [
      "Grate or juice the fresh ginger knob.",
      "In a small glass, whisk moringa powder into lemon juice and coconut water until dissolved.",
      "Stir in ginger juice and a dash of cayenne. Drink immediately as a morning kickstart."
    ]
  },
  {
    title: "Iced Golden Moringa Latte",
    description: "A refreshing, soothing blend of moringa, turmeric, and creamy oat milk over ice.",
    image: smoothieImg2,
    time: "7 min",
    author: "Earthora Kitchen",
    tags: ["Latte", "Iced", "Dairy-Free"],
    ingredients: [
      "1 tsp Earthora Moringa Powder",
      "1/4 tsp ground turmeric",
      "1 cup creamy oat milk",
      "1 tbsp maple syrup",
      "1/4 tsp vanilla extract",
      "Ice cubes"
    ],
    instructions: [
      "Warm 2 tbsp of oat milk and whisk thoroughly with moringa powder and turmeric until lump-free.",
      "Add maple syrup and vanilla extract to the warm mixture.",
      "Fill a glass with ice, pour remaining cold oat milk over top, then layer the golden moringa mixture.",
      "Stir gently to combine before sipping."
    ]
  },
  {
    title: "Moringa Pesto Pasta",
    description: "A nutrient-rich twist on classic basil pesto — vibrant green, earthy, and bursting with flavor.",
    image: powderImg2,
    time: "15 min",
    author: "Chef Wellness",
    tags: ["Main", "Dinner", "Pesto"],
    ingredients: [
      "2 tbsp Earthora Moringa Powder",
      "2 cups fresh basil leaves",
      "1/2 cup pine nuts or walnuts",
      "2 cloves garlic",
      "1/2 cup extra virgin olive oil",
      "1/4 cup nutritional yeast or grated parmesan",
      "Sea salt and freshly cracked black pepper to taste"
    ],
    instructions: [
      "Pulse pine nuts and garlic in a food processor until coarsely chopped.",
      "Add fresh basil, moringa powder, and nutritional yeast/parmesan.",
      "With the processor running, slowly drizzle in olive oil until a smooth pesto forms.",
      "Season with salt and pepper. Toss with warm freshly cooked pasta."
    ]
  },
  {
    title: "Tropical Moringa Energy Bowls",
    description: "A thick, velvety smoothie bowl topped with fresh tropical fruit, coconut flakes, and chia seeds.",
    image: leavesImg2,
    time: "10 min",
    author: "Earthora Kitchen",
    tags: ["Bowl", "Breakfast", "Raw"],
    ingredients: [
      "1 tbsp Earthora Moringa Powder",
      "1 cup frozen mango chunks",
      "1/2 cup frozen pineapple chunks",
      "1/2 cup splash of coconut water",
      "Toppings: sliced kiwi, toasted coconut flakes, chia seeds, fresh berries"
    ],
    instructions: [
      "Blend frozen mango, pineapple, moringa powder, and coconut water using a tamper until thick and smooth.",
      "Spoon into a chilled bowl.",
      "Arrange kiwi slices, coconut flakes, chia seeds, and berries neatly over top and serve immediately."
    ]
  },
  {
    title: "Moringa Mint Infused Water",
    description: "Crisp, hydrating, and subtly herbal — the perfect all-day wellness water for clean hydration.",
    image: smoothieImg,
    time: "2 min",
    author: "Earthora Kitchen",
    tags: ["Hydration", "Drink", "Easy"],
    ingredients: [
      "1/2 tsp Earthora Moringa Powder",
      "1 liter fresh cold water",
      "4-5 fresh mint sprigs",
      "4 cucumber slices",
      "1/2 lime, thinly sliced"
    ],
    instructions: [
      "Whisk moringa powder into 100ml of warm water until fully dissolved.",
      "Pour into a glass pitcher filled with the remaining cold water and ice.",
      "Add mint sprigs, cucumber slices, and lime slices.",
      "Stir gently and let infuse for 10 minutes before serving."
    ]
  }
];

const containerVars: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const itemVars: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
};

export default function Recipes() {
  const [activeTag, setActiveTag] = useState<string>("All");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  const tags = ["All", "Smoothie", "Breakfast", "Latte", "Dinner", "Wellness"];

  const filteredRecipes = activeTag === "All"
    ? recipes
    : recipes.filter(r => r.tags.includes(activeTag));

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black selection:bg-black/10">
      <Navbar />

      {/* ── UNIQUE HERO: Minimal Editorial Header + Floating Recipe Card Highlight ── */}
      <section className="relative pt-32 lg:pt-36 pb-12 lg:pb-16 overflow-hidden bg-[#FAF9F5] border-b border-black/8">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <div className="grid lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7">
              <span className="font-inter text-xs uppercase tracking-widest text-emerald-800 font-semibold mb-3 block">
                Earthora Kitchen
              </span>
              <h1 className="font-dm font-normal tracking-[-0.05em] text-[40px] leading-[42px] sm:text-[60px] sm:leading-[56px] lg:text-[76px] lg:leading-[70px] text-black mb-4">
                Nourish your body, <br />
                <span className="text-black/40">one recipe at a time.</span>
              </h1>
              <p className="font-inter text-base text-black/60 max-w-lg leading-relaxed">
                Simple, delicious botanical rituals designed to seamlessly integrate pure moringa into your morning smoothies, lattes, and daily meals.
              </p>
            </div>

            {/* Featured Recipe Card Preview */}
            <div className="lg:col-span-5 hidden lg:block">
              <div
                onClick={() => setSelectedRecipe(recipes[0])}
                className="bg-[#FEFDF9] rounded-3xl border border-black/10 p-5 shadow-lg flex items-center gap-5 cursor-pointer hover:shadow-xl transition-all"
              >
                <img src={recipeSmoothie} alt="Featured" className="w-28 h-28 rounded-2xl object-cover" />
                <div>
                  <span className="text-[10px] font-inter uppercase font-semibold text-amber-700 tracking-wider">
                    Editor's Pick
                  </span>
                  <h3 className="font-dm text-xl text-black font-normal tracking-[-0.02em] mb-1">
                    Green Morning Smoothie
                  </h3>
                  <p className="font-inter text-xs text-black/50 line-clamp-2">
                    5-minute morning energy ritual.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Tag Filter Bar ── */}
      <section className="bg-[#F4F3EE] border-b border-black/8 sticky top-0 z-10 backdrop-blur-sm">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px] py-4 flex items-center gap-2 overflow-x-auto">
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(tag)}
              className={`px-4 py-2 rounded-xl font-inter text-xs sm:text-sm font-medium transition-all shrink-0 ${
                activeTag === tag
                  ? "bg-black text-white shadow-md"
                  : "bg-[#FEFDF9] text-black/60 border border-black/8 hover:border-black/20"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      {/* ── Recipe Cards Grid ── */}
      <section className="py-12 lg:py-20">
        <div className="container mx-auto px-6 sm:px-10 max-w-[1400px]">
          <motion.div
            variants={containerVars}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {filteredRecipes.map((recipe) => (
              <motion.div
                key={recipe.title}
                variants={itemVars}
                onClick={() => setSelectedRecipe(recipe)}
                className="group bg-[#FEFDF9] rounded-2xl border border-black/5 overflow-hidden flex flex-col shadow-sm hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-500 cursor-pointer"
              >
                <div className="relative aspect-[4/3] bg-[#ECEDEC] overflow-hidden">
                  <img
                    src={recipe.image}
                    alt={recipe.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                  />
                  <div className="absolute top-4 left-4 flex gap-2">
                    {recipe.tags.map((t) => (
                      <span key={t} className="px-3 py-1 rounded-full bg-black/70 backdrop-blur-md text-white font-inter text-xs">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="p-6 flex flex-col flex-1 justify-between">
                  <div>
                    <div className="flex items-center gap-4 text-xs font-inter text-black/40 mb-3">
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {recipe.time}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5" />
                        {recipe.author}
                      </span>
                    </div>

                    <h3 className="font-dm font-normal text-2xl text-black tracking-[-0.03em] mb-2 leading-tight">
                      {recipe.title}
                    </h3>

                    <p className="font-inter text-sm text-black/65 leading-relaxed tracking-[-0.02em] line-clamp-2 mb-6">
                      {recipe.description}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-black/8 flex items-center justify-between font-inter text-xs text-black font-medium group-hover:text-emerald-700 transition-colors">
                    <span>View Full Recipe</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Recipe Modal ── */}
      <AnimatePresence>
        {selectedRecipe && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#FEFDF9] rounded-3xl max-w-3xl w-full overflow-hidden border border-black/10 shadow-2xl relative max-h-[90vh] flex flex-col"
            >
              <button
                onClick={() => setSelectedRecipe(null)}
                className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="relative aspect-[16/9] bg-[#ECEDEC] shrink-0">
                <img src={selectedRecipe.image} alt={selectedRecipe.title} className="w-full h-full object-cover" />
              </div>

              <div className="p-6 sm:p-8 overflow-y-auto space-y-6">
                <div>
                  <h2 className="font-dm font-normal text-3xl sm:text-4xl text-black tracking-[-0.04em] mb-2">
                    {selectedRecipe.title}
                  </h2>
                  <p className="font-inter text-base text-black/65">{selectedRecipe.description}</p>
                </div>

                <div className="grid sm:grid-cols-2 gap-6 pt-6 border-t border-black/8">
                  <div>
                    <h3 className="font-dm text-lg text-black mb-3 font-medium">Ingredients</h3>
                    <ul className="space-y-2 font-inter text-sm text-black/80">
                      {selectedRecipe.ingredients.map((ing, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-2 shrink-0" />
                          <span>{ing}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-dm text-lg text-black mb-3 font-medium">Instructions</h3>
                    <ol className="space-y-3 font-inter text-sm text-black/80">
                      {selectedRecipe.instructions.map((inst, idx) => (
                        <li key={idx} className="flex items-start gap-3">
                          <span className="w-6 h-6 rounded-full bg-black/5 text-black font-dm text-xs flex items-center justify-center shrink-0 font-medium">
                            {idx + 1}
                          </span>
                          <span className="leading-relaxed">{inst}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <Footer />
    </div>
  );
}
