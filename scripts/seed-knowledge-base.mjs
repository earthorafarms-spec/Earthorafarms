// scripts/seed-knowledge-base.mjs
// Product PRICES and STOCK are NOT stored here — the voice agent always calls
// list_products() or check_product_stock() tools for live data. This table is qualitative content only.

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Load .env file manually
if (fs.existsSync(".env")) {
  const envConfig = fs.readFileSync(".env", "utf8");
  for (const line of envConfig.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const [key, ...values] = trimmed.split("=");
      process.env[key.trim()] = values.join("=").trim().replace(/^["']|["']$/g, '');
    }
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/VITE_SUPABASE_ANON_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Static Q&A dataset extracted from source files (health-benefits.tsx, contact.tsx, recipes.tsx, products.tsx)
const staticKnowledgeRows = [
  // ── Health Benefits & Nutrition (src/pages/health-benefits.tsx) ──
  {
    topic: "moringa nutrition claims",
    question: "How much Vitamin C is in Earthora Moringa compared to oranges?",
    answer: "Earthora Moringa contains 7x more Vitamin C than fresh oranges, delivering potent immune support and antioxidants.",
    source_page: "/health-benefits",
  },
  {
    topic: "moringa nutrition claims",
    question: "How much Vitamin A is in Earthora Moringa compared to carrots?",
    answer: "Earthora Moringa provides 4x more Vitamin A than organic carrots, supporting cellular skin radiance and vision.",
    source_page: "/health-benefits",
  },
  {
    topic: "moringa nutrition claims",
    question: "How much Calcium is in Earthora Moringa compared to milk?",
    answer: "Earthora Moringa contains 4x more Calcium than whole milk to support bone health and muscle function.",
    source_page: "/health-benefits",
  },
  {
    topic: "moringa nutrition claims",
    question: "How much Iron is in Earthora Moringa compared to spinach?",
    answer: "Earthora Moringa provides 3x more bioavailable Iron than raw spinach, helping maintain steady oxygen transport and energy.",
    source_page: "/health-benefits",
  },
  {
    topic: "moringa nutrition claims",
    question: "How much Potassium is in Earthora Moringa compared to bananas?",
    answer: "Earthora Moringa has 3x more Potassium than ripe bananas to support muscle recovery and fluid balance.",
    source_page: "/health-benefits",
  },
  {
    topic: "moringa nutrition claims",
    question: "What is the protein profile of Earthora Moringa?",
    answer: "Earthora Moringa delivers 2 grams of protein per teaspoon containing all 9 essential amino acids, making it a complete plant protein source.",
    source_page: "/health-benefits",
  },
  {
    topic: "energy & vitality",
    question: "Does moringa cause energy crashes or caffeine jitters?",
    answer: "No. Unlike caffeine or sugar stimulants that cause adrenal fatigue, Moringa provides steady cellular energy by delivering bioavailable iron, magnesium, and essential B-complex vitamins directly to your mitochondria with zero jitters or crashes.",
    source_page: "/health-benefits",
  },
  {
    topic: "immune system",
    question: "How does Moringa support the immune system?",
    answer: "Moringa leaves contain over 46 active antioxidants, including quercetin, chlorogenic acid, and high concentrations of Vitamin C and Zinc to neutralize free radicals and strengthen daily immunity.",
    source_page: "/health-benefits",
  },
  {
    topic: "cognitive health",
    question: "What are the cognitive benefits of taking Moringa?",
    answer: "Moringa contains Vitamin E, Vitamin C, Zinc, and iron, along with 18 amino acids, supporting healthy neurotransmitter activity, brain fog reduction, and sharp mental clarity.",
    source_page: "/health-benefits",
  },
  {
    topic: "skin health",
    question: "How does Moringa promote skin glow and health?",
    answer: "High levels of Vitamin A and E promote natural collagen synthesis, combat premature cellular aging, and nourish your skin from within.",
    source_page: "/health-benefits",
  },

  // ── Usage & Recipes (src/pages/recipes.tsx) ──
  {
    topic: "moringa usage",
    question: "How do I make a Green Morning Smoothie with Moringa powder?",
    answer: "Blend 1 tsp Earthora Moringa Powder with 1 ripe banana, 1 cup spinach, 1 cup almond milk, 1 tbsp raw honey, and ice for 45-60 seconds.",
    source_page: "/recipes",
  },
  {
    topic: "moringa usage",
    question: "How do I make a Moringa & Ginger Wellness Shot?",
    answer: "Whisk 1/2 tsp Earthora Moringa Powder into juice of 1/2 lemon, 2 tbsp coconut water, 1 inch grated fresh ginger, and a pinch of cayenne pepper.",
    source_page: "/recipes",
  },
  {
    topic: "moringa usage",
    question: "How do I make an Iced Golden Moringa Latte?",
    answer: "Warm 2 tbsp oat milk and whisk thoroughly with 1 tsp Moringa Powder and 1/4 tsp turmeric. Add 1 tbsp maple syrup, 1/4 tsp vanilla, and pour over cold oat milk and ice.",
    source_page: "/recipes",
  },

  // ── Company, Contact & Shipping Policies (src/pages/contact.tsx) ──
  {
    topic: "contact & support",
    question: "How can I contact Earthora Farms customer support?",
    answer: "You can reach Earthora Farms via email at contactus@earthorafarms.com or call +1 (555) 123-4567 during operating hours (Mon – Fri, 9 AM – 6 PM PST).",
    source_page: "/contact",
  },
  {
    topic: "farm location",
    question: "Where is Earthora Farms located?",
    answer: "Our farm is located at 123 Green Valley Rd, Aptos, CA 95003.",
    source_page: "/contact",
  },
  {
    topic: "shipping & delivery",
    question: "What are your shipping rates and response times?",
    answer: "We offer free standard shipping on all orders. Contact inquiries are answered within 24 business hours.",
    source_page: "/contact",
  },
];

async function seedKnowledgeBase() {
  console.log("🌱 Seeding knowledge_base table in Supabase...");

  let staticCount = 0;
  let productFaqCount = 0;

  // 1. Insert/Upsert static rows
  for (const row of staticKnowledgeRows) {
    // Check if matching row exists by topic and question
    const { data: existing } = await supabase
      .from("knowledge_base")
      .select("id")
      .eq("topic", row.topic)
      .eq("question", row.question)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("knowledge_base")
        .update({ answer: row.answer, source_page: row.source_page, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) console.error(`Error updating static row (${row.question}):`, error.message);
      else staticCount++;
    } else {
      const { error } = await supabase.from("knowledge_base").insert(row);
      if (error) console.error(`Error inserting static row (${row.question}):`, error.message);
      else staticCount++;
    }
  }

  // 2. Fetch live products from products table and build Q&As from highlights & FAQs
  const { data: products, error: prodErr } = await supabase
    .from("products")
    .select("id, name, slug, description, highlights, usage_instructions, faqs");

  if (prodErr) {
    console.error("❌ Error fetching live products from Supabase:", prodErr.message);
  } else if (products && products.length > 0) {
    for (const prod of products) {
      const pagePath = "/our-product";

      // Product Description Q&A
      if (prod.description) {
        const row = {
          topic: `product details - ${prod.name}`,
          question: `What is ${prod.name}?`,
          answer: prod.description,
          source_page: pagePath,
        };
        await upsertProductKnowledge(row);
        productFaqCount++;
      }

      // Usage Instructions Q&A
      if (prod.usage_instructions) {
        const row = {
          topic: `product usage - ${prod.name}`,
          question: `How do I use ${prod.name}?`,
          answer: prod.usage_instructions,
          source_page: pagePath,
        };
        await upsertProductKnowledge(row);
        productFaqCount++;
      }

      // Highlights Q&A
      if (Array.isArray(prod.highlights) && prod.highlights.length > 0) {
        const row = {
          topic: `product highlights - ${prod.name}`,
          question: `What are the key features of ${prod.name}?`,
          answer: prod.highlights.join(". "),
          source_page: pagePath,
        };
        await upsertProductKnowledge(row);
        productFaqCount++;
      }

      // FAQs JSONB array Q&As
      if (Array.isArray(prod.faqs) && prod.faqs.length > 0) {
        for (const faq of prod.faqs) {
          if (faq.q && faq.a) {
            const row = {
              topic: `product faq - ${prod.name}`,
              question: faq.q,
              answer: faq.a,
              source_page: pagePath,
            };
            await upsertProductKnowledge(row);
            productFaqCount++;
          }
        }
      }
    }
  }

  console.log(`✅ Knowledge base seeding complete!`);
  console.log(`📊 Summary: ${staticCount} static rows upserted, ${productFaqCount} product FAQ/highlight rows upserted.`);
}

async function upsertProductKnowledge(row) {
  const { data: existing } = await supabase
    .from("knowledge_base")
    .select("id")
    .eq("topic", row.topic)
    .eq("question", row.question)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("knowledge_base")
      .update({ answer: row.answer, source_page: row.source_page, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("knowledge_base").insert(row);
  }
}

seedKnowledgeBase().catch((err) => {
  console.error("❌ Uncaught error during seeding:", err);
  process.exit(1);
});
