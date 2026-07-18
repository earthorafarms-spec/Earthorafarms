# Security Deployment Checklist

Use this checklist before deploying the remediation work.

1. Set `OLLAMA_BASE_URL` and `OLLAMA_MODEL` as server-only Netlify environment variables.
2. Do not set any service-role key with a `VITE_` prefix.
3. Apply `supabase/migrations/20260718000000_security_policies.sql` in the Supabase project after confirming table names.
4. Give admin accounts an immutable Supabase `app_metadata` claim:

```json
{
  "role": "admin"
}
```

5. Confirm anonymous users cannot select `chat_sessions`, `chat_messages`, or `users`.
6. Confirm the public chat widget can insert only its own session/messages.
7. Confirm `/admin/*` only loads data for authenticated admin users.
8. Configure Netlify Forms for the `contact` form and enable spam filtering.
9. Set `CHAT_ALLOWED_ORIGINS` only if the chat function must be called cross-origin.
10. Rotate any Supabase service-role key that was ever placed in a client-prefixed variable.
