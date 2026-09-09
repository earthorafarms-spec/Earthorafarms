-- Keep the active Morilife+ knowledge base aligned with the latest product
-- record and the customer-facing FAQ. This migration is intentionally scoped
-- to the currently active Morilife+ product and is safe to re-run.

DO $$
DECLARE
  v_product_id UUID;
BEGIN
  SELECT id INTO v_product_id
  FROM products
  WHERE status = 'active'
    AND (slug = 'cheese' OR name = 'Morilife+ Moringa Leaf Tablets')
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RAISE NOTICE 'Active Morilife+ product not found; knowledge audit skipped.';
    RETURN;
  END IF;

  UPDATE product_knowledge
  SET content = 'Suggested use: Take 1–2 tablets once or twice daily, before breakfast or dinner. Follow the product label. If you have a health condition, take regular medicines, or are unsure about the right amount, consult a doctor.',
      status = 'approved', version = GREATEST(version, 2),
      approved_at = now(), approved_by = 'knowledge-audit'
  WHERE product_id = v_product_id AND category = 'dosage';

  UPDATE product_knowledge
  SET content = 'Take the tablets with water. Use them according to the suggested use on the product label: 1–2 tablets once or twice daily, before breakfast or dinner.',
      status = 'approved', version = GREATEST(version, 2),
      approved_at = now(), approved_by = 'knowledge-audit'
  WHERE product_id = v_product_id AND category = 'directions';

  UPDATE product_knowledge
  SET content = 'Store the tablets in a cool, dry place away from direct sunlight. Keep the container tightly closed after use. Refrigeration is not required.',
      status = 'approved', version = GREATEST(version, 2),
      approved_at = now(), approved_by = 'knowledge-audit'
  WHERE product_id = v_product_id AND category = 'storage';

  UPDATE product_knowledge
  SET content = 'If you are pregnant or breastfeeding, have a health problem, or take regular medicines, consult a doctor before using these tablets.',
      status = 'approved', version = GREATEST(version, 2),
      approved_at = now(), approved_by = 'knowledge-audit'
  WHERE product_id = v_product_id AND category = 'contraindications';
  IF NOT FOUND THEN
    INSERT INTO product_knowledge
      (product_id, category, content, locale, status, approved_at, approved_by)
    VALUES
      (v_product_id, 'contraindications',
       'If you are pregnant or breastfeeding, have a health problem, or take regular medicines, consult a doctor before using these tablets.',
       'en-IN', 'approved', now(), 'knowledge-audit');
  END IF;

  UPDATE product_knowledge
  SET content = 'No. The tablets are high-pressure pressed using 100% pure shade-dried moringa leaf powder, with no synthetic binders, fillers, lubricants, coatings, or magnesium stearate.',
      status = 'approved', version = GREATEST(version, 2),
      approved_at = now(), approved_by = 'knowledge-audit'
  WHERE product_id = v_product_id
    AND category = 'faq'
    AND question = 'Do the tablets contain synthetic binders, fillers, lubricants, coatings, or magnesium stearate?';
  IF NOT FOUND THEN
    INSERT INTO product_knowledge
      (product_id, category, question, content, locale, status, approved_at, approved_by)
    VALUES
      (v_product_id, 'faq',
       'Do the tablets contain synthetic binders, fillers, lubricants, coatings, or magnesium stearate?',
       'No. The tablets are high-pressure pressed using 100% pure shade-dried moringa leaf powder, with no synthetic binders, fillers, lubricants, coatings, or magnesium stearate.',
       'en-IN', 'approved', now(), 'knowledge-audit');
  END IF;

  UPDATE product_knowledge
  SET content = 'No. Moringa is naturally caffeine-free.',
      status = 'approved', version = GREATEST(version, 2),
      approved_at = now(), approved_by = 'knowledge-audit'
  WHERE product_id = v_product_id
    AND category = 'faq'
    AND question = 'Does the product contain caffeine?';
  IF NOT FOUND THEN
    INSERT INTO product_knowledge
      (product_id, category, question, content, locale, status, approved_at, approved_by)
    VALUES
      (v_product_id, 'faq', 'Does the product contain caffeine?',
       'No. Moringa is naturally caffeine-free.',
       'en-IN', 'approved', now(), 'knowledge-audit');
  END IF;
END;
$$;
