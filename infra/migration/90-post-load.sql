-- After data load: reset sequences, disable RLS (the API is the auth layer), drop dead Supabase-only surface.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.relname AS tbl, a.attname AS col, pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS seq
           FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
             AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL LOOP
    EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 0) + 1, false)', r.seq, r.col, r.tbl);
  END LOOP;
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
