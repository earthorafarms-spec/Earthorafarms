-- Earthora Farms baseline RLS policies.
-- Apply this in the Supabase project after confirming table and column names.
-- Admin access depends on app_metadata.role = 'admin' or app_metadata.admin = true.

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
    or coalesce((auth.jwt() -> 'app_metadata' ->> 'admin')::boolean, false);
$$;

do $$
begin
  if to_regclass('public.chat_sessions') is not null then
    execute 'alter table public.chat_sessions enable row level security';

    drop policy if exists "chat_sessions_insert_public" on public.chat_sessions;
    create policy "chat_sessions_insert_public"
      on public.chat_sessions
      for insert
      to anon, authenticated
      with check (user_id is null or user_id = auth.uid());

    drop policy if exists "chat_sessions_select_admin" on public.chat_sessions;
    create policy "chat_sessions_select_admin"
      on public.chat_sessions
      for select
      to authenticated
      using (public.is_admin());

    drop policy if exists "chat_sessions_select_own" on public.chat_sessions;
    create policy "chat_sessions_select_own"
      on public.chat_sessions
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if to_regclass('public.chat_messages') is not null then
    execute 'alter table public.chat_messages enable row level security';

    drop policy if exists "chat_messages_insert_public" on public.chat_messages;
    create policy "chat_messages_insert_public"
      on public.chat_messages
      for insert
      to anon, authenticated
      with check (
        exists (
          select 1
          from public.chat_sessions s
          where s.id = session_id
            and (s.user_id is null or s.user_id = auth.uid())
        )
      );

    drop policy if exists "chat_messages_select_admin" on public.chat_messages;
    create policy "chat_messages_select_admin"
      on public.chat_messages
      for select
      to authenticated
      using (public.is_admin());

    drop policy if exists "chat_messages_select_own" on public.chat_messages;
    create policy "chat_messages_select_own"
      on public.chat_messages
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.chat_sessions s
          where s.id = session_id
            and s.user_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if to_regclass('public.users') is not null then
    execute 'alter table public.users enable row level security';

    drop policy if exists "users_select_admin" on public.users;
    create policy "users_select_admin"
      on public.users
      for select
      to authenticated
      using (public.is_admin());

    drop policy if exists "users_select_own" on public.users;
    create policy "users_select_own"
      on public.users
      for select
      to authenticated
      using (id = auth.uid());
  end if;
end $$;
