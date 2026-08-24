-- Seed product_knowledge from existing products table data.
-- Run this once in your Supabase SQL editor (or as a migration).
-- It reads health_benefits, usage_instructions, ingredients, and faqs
-- from every active product and creates approved product_knowledge rows.
-- Safe to re-run: ON CONFLICT DO NOTHING skips already-existing rows.

DO $$
DECLARE
  r              products%ROWTYPE;
  faq_item       JSONB;
  faq_question   TEXT;
  faq_answer     TEXT;
  benefits_text  TEXT;
BEGIN
  FOR r IN SELECT * FROM products WHERE status = 'active' LOOP

    -- ── description ───────────────────────────────────────────────────────────
    IF r.description IS NOT NULL AND length(trim(r.description)) > 10 THEN
      INSERT INTO product_knowledge
        (product_id, category, content, status, locale)
      VALUES
        (r.id, 'description', trim(r.description), 'approved', 'en-IN')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── benefits ──────────────────────────────────────────────────────────────
    -- health_benefits is a TEXT[] column — join with a separator so the agent
    -- receives the full list as a single readable paragraph.
    IF r.health_benefits IS NOT NULL AND array_length(r.health_benefits, 1) > 0 THEN
      benefits_text := array_to_string(r.health_benefits, '. ');
      INSERT INTO product_knowledge
        (product_id, category, content, status, locale)
      VALUES
        (r.id, 'benefits', benefits_text, 'approved', 'en-IN')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── directions (usage) ────────────────────────────────────────────────────
    IF r.usage_instructions IS NOT NULL AND length(trim(r.usage_instructions)) > 5 THEN
      INSERT INTO product_knowledge
        (product_id, category, content, status, locale)
      VALUES
        (r.id, 'directions', trim(r.usage_instructions), 'approved', 'en-IN')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── ingredients ───────────────────────────────────────────────────────────
    IF r.ingredients IS NOT NULL AND length(trim(r.ingredients)) > 5 THEN
      INSERT INTO product_knowledge
        (product_id, category, content, status, locale)
      VALUES
        (r.id, 'ingredients', trim(r.ingredients), 'approved', 'en-IN')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── faq entries (one row per question-answer pair) ────────────────────────
    IF r.faqs IS NOT NULL AND jsonb_array_length(r.faqs) > 0 THEN
      FOR faq_item IN SELECT jsonb_array_elements(r.faqs) LOOP
        faq_question := trim(faq_item->>'question');
        faq_answer   := trim(faq_item->>'answer');
        IF faq_question IS NOT NULL AND faq_answer IS NOT NULL
           AND length(faq_question) > 0 AND length(faq_answer) > 0 THEN
          INSERT INTO product_knowledge
            (product_id, category, question, content, status, locale)
          VALUES
            (r.id, 'faq', faq_question, faq_answer, 'approved', 'en-IN')
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;

  END LOOP;

  RAISE NOTICE 'product_knowledge seed complete.';
END;
$$;

-- ── Verify what was inserted ──────────────────────────────────────────────────
SELECT
  p.name        AS product_name,
  pk.category,
  left(pk.content, 80) AS content_preview,
  pk.status,
  pk.locale
FROM product_knowledge pk
JOIN products p ON p.id = pk.product_id
ORDER BY p.name, pk.category;
