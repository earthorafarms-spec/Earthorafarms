-- ─── Recipes Table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recipes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT        NOT NULL,
  description      TEXT        NOT NULL DEFAULT '',
  cover_image_url  TEXT        NOT NULL DEFAULT '',
  prep_time        TEXT        NOT NULL DEFAULT '5 min',
  author           TEXT        NOT NULL DEFAULT 'Earthora Kitchen',
  tags             TEXT[]      NOT NULL DEFAULT '{}',
  ingredients      TEXT[]      NOT NULL DEFAULT '{}',
  instructions     TEXT[]      NOT NULL DEFAULT '{}',
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

-- Public can read
CREATE POLICY "public can read recipes"
  ON recipes FOR SELECT TO anon, authenticated USING (true);

-- Admins (anon key) can insert / update / delete
CREATE POLICY "anon can insert recipes"
  ON recipes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon can update recipes"
  ON recipes FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "anon can delete recipes"
  ON recipes FOR DELETE TO anon, authenticated USING (true);


-- ─── Gallery Items Table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gallery_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url   TEXT        NOT NULL,
  alt_text    TEXT        NOT NULL DEFAULT '',
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gallery_items ENABLE ROW LEVEL SECURITY;

-- Public can read
CREATE POLICY "public can read gallery_items"
  ON gallery_items FOR SELECT TO anon, authenticated USING (true);

-- Admins can manage
CREATE POLICY "anon can insert gallery_items"
  ON gallery_items FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon can update gallery_items"
  ON gallery_items FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "anon can delete gallery_items"
  ON gallery_items FOR DELETE TO anon, authenticated USING (true);


-- ─── Seed: Recipes ────────────────────────────────────────────────────────────
INSERT INTO recipes (title, description, cover_image_url, prep_time, author, tags, ingredients, instructions, sort_order) VALUES
(
  'Green Morning Smoothie',
  'A vibrant, energy-packed smoothie that transforms your morning routine into a nourishing ritual.',
  'https://earthorafarms.netlify.app/assets/recipe_smoothie-BWVj3bkx.png',
  '5 min', 'Earthora Kitchen',
  ARRAY['Smoothie','Breakfast','Vegan'],
  ARRAY['1 tsp Earthora Moringa Powder','1 ripe banana','1 cup fresh spinach leaves','1 cup unsweetened almond milk','1 tbsp organic raw honey','Handful of ice cubes'],
  ARRAY['Combine all ingredients in a high-speed blender, starting with the liquid.','Blend on high for 45-60 seconds until completely smooth and creamy.','Pour into a tall glass, garnish with a mint leaf if desired, and enjoy fresh.'],
  1
),
(
  'Moringa & Ginger Wellness Shot',
  'A concentrated wellness boost — bright, invigorating, and packed with antioxidants to start your day.',
  'https://earthorafarms.netlify.app/assets/hero_leaves-CCb970ib.jpg',
  '3 min', 'Earthora Kitchen',
  ARRAY['Shot','Wellness','Immune'],
  ARRAY['1/2 tsp Earthora Moringa Powder','1 inch fresh ginger root','Juice of 1 fresh lemon','1 tbsp warm water','Pinch of cayenne pepper'],
  ARRAY['Grate the fresh ginger root finely and squeeze it to extract raw ginger juice.','In a small container, whisk the moringa powder with warm water until fully dissolved.','Stir in the fresh lemon juice and the extracted ginger juice.','Add a pinch of cayenne pepper, stir well, and drink immediately.'],
  2
),
(
  'Tropical Moringa Bowl',
  'A creamy, dreamy acai-style bowl with the added nutritional depth of fresh moringa.',
  'https://earthorafarms.netlify.app/assets/lifestyle_smoothie_2-CZsdvV7I.jpg',
  '10 min', 'Earthora Kitchen',
  ARRAY['Bowl','Breakfast','Gluten-Free'],
  ARRAY['1 tsp Earthora Moringa Powder','1 frozen sliced banana','1/2 cup frozen mango chunks','1/4 cup light coconut milk','Toppings: granola, coconut flakes, fresh mango'],
  ARRAY['Add frozen banana, mango, coconut milk, and moringa powder to a blender.','Blend until thick and creamy — add a splash more coconut milk if needed.','Pour into a bowl and top with granola, coconut flakes, and fresh mango slices.'],
  3
),
(
  'Moringa Golden Milk Latte',
  'A warming, anti-inflammatory latte that blends the ancient wisdom of turmeric with the superfood power of moringa.',
  'https://earthorafarms.netlify.app/assets/product_powder-Dzv-P3vk.jpg',
  '8 min', 'Earthora Kitchen',
  ARRAY['Latte','Evening','Anti-inflammatory'],
  ARRAY['1/2 tsp Earthora Moringa Powder','1/4 tsp turmeric','1/4 tsp cinnamon','1 cup oat milk or full-fat coconut milk','1 tsp raw honey','Pinch of black pepper'],
  ARRAY['Gently warm oat milk in a small saucepan over medium-low heat — do not boil.','Whisk in moringa powder, turmeric, cinnamon, and black pepper until fully dissolved.','Pour into a mug and stir in raw honey. Serve warm with a cinnamon stick.'],
  4
),
(
  'Moringa Energy Balls',
  'No-bake, nutrient-dense bites — the perfect on-the-go snack packed with plant protein and healthy fats.',
  'https://earthorafarms.netlify.app/assets/hero_leaves_2-MbP8wEe4.jpg',
  '15 min', 'Earthora Kitchen',
  ARRAY['Snack','No-Bake','High Protein'],
  ARRAY['1 tsp Earthora Moringa Powder','1 cup rolled oats','1/2 cup natural peanut butter','3 tbsp raw honey','1/4 cup dark chocolate chips','1 tsp vanilla extract'],
  ARRAY['Combine all ingredients in a large mixing bowl and stir until fully combined.','Refrigerate the mixture for 20 minutes to firm up.','Roll into 12 equal-sized balls and store in an airtight container in the fridge for up to 1 week.'],
  5
),
(
  'Moringa Detox Water',
  'A gentle daily detox — refreshing cucumber-lemon water supercharged with moringa and fresh mint.',
  'https://earthorafarms.netlify.app/assets/lifestyle_smoothie-DcT9S38S.jpg',
  '5 min', 'Earthora Kitchen',
  ARRAY['Drink','Detox','Hydration'],
  ARRAY['1/2 tsp Earthora Moringa Powder','1 litre cold filtered water','1/2 cucumber, thinly sliced','1/2 lemon, thinly sliced','Small handful of fresh mint leaves'],
  ARRAY['Dissolve moringa powder in 2 tablespoons of warm water, then pour into your water jug.','Add the cucumber slices, lemon slices, and fresh mint leaves.','Fill with cold filtered water, stir gently, and refrigerate for at least 30 minutes before drinking.'],
  6
);


-- ─── Seed: Gallery Items ──────────────────────────────────────────────────────
INSERT INTO gallery_items (image_url, alt_text, sort_order) VALUES
('https://earthorafarms.netlify.app/assets/farm_field_wide-M3Ui1jZQ.png',    'Wide view of our moringa farm at golden hour', 1),
('https://earthorafarms.netlify.app/assets/hero_leaves-CCb970ib.jpg',         'Sunlit moringa leaves swaying in the breeze', 2),
('https://earthorafarms.netlify.app/assets/farm_harvest_workers-9CdaqZXC.png','Farmers hand-harvesting fresh moringa leaves', 3),
('https://earthorafarms.netlify.app/assets/farm_leaves_closeup-DhIClXG_.png', 'Close-up of dewy moringa leaves in the morning', 4),
('https://earthorafarms.netlify.app/assets/farm_moringa_tree-u_qWXoVJ.png',   'A mature moringa tree standing tall on the farm', 5),
('https://earthorafarms.netlify.app/assets/hero_leaves_2-MbP8wEe4.jpg',       'Cluster of vibrant green moringa leaves', 6),
('https://earthorafarms.netlify.app/assets/farm_seedlings-CUNGZyFE.png',      'Young moringa seedlings in our farm nursery', 7),
('https://earthorafarms.netlify.app/assets/farm_sunset_aerial-CfJzHyE3.png',  'Aerial view of the farm stretching at sunset', 8);
