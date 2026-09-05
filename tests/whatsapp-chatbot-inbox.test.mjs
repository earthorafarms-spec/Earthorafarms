import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('WhatsApp inbox migration is private, idempotent, retryable and atomic with conversation state', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20260905000000_whatsapp_chatbot_inbox.sql', import.meta.url),
    'utf8',
  );

  assert.match(sql, /provider_message_id TEXT NOT NULL UNIQUE/i);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/i);
  assert.match(sql, /NOT EXISTS[\s\S]*earlier\.phone_number = event\.phone_number/i);
  assert.match(sql, /attempt_count < 5/i);
  assert.match(sql, /UPDATE public\.voice_call_sessions[\s\S]*UPDATE public\.whatsapp_message_events/i);
  assert.match(sql, /REVOKE ALL ON public\.whatsapp_message_events FROM anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.claim_next_whatsapp_message\(\) TO service_role/i);
  assert.doesNotMatch(sql, /GRANT.+(?:anon|authenticated)/i);

  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE voice_call_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_state JSONB NOT NULL DEFAULT '{}',
        expires_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE whatsapp_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone_number TEXT NOT NULL UNIQUE,
        voice_session_id UUID NOT NULL REFERENCES voice_call_sessions(id),
        last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.exec(sql);
    // Render/Supabase deploys may safely retry a migration step after an
    // interrupted release; a second application must remain harmless.
    await db.exec(sql);
    await db.exec('GRANT ALL ON voice_call_sessions, whatsapp_sessions TO service_role; SET ROLE service_role;');

    const sessionId = '10000000-0000-4000-8000-000000000001';
    await db.query('INSERT INTO voice_call_sessions(id) VALUES ($1)', [sessionId]);
    await db.query('INSERT INTO whatsapp_sessions(phone_number, voice_session_id) VALUES ($1, $2)', ['+919876543210', sessionId]);
    await db.query(
      `INSERT INTO whatsapp_message_events(provider_message_id, phone_number, message_text)
       VALUES ($1, $2, $3)`,
      ['wamid.test', '+919876543210', 'Show products'],
    );

    const claim = await db.query('SELECT * FROM claim_next_whatsapp_message()');
    assert.equal(claim.rows.length, 1);
    assert.equal(claim.rows[0].provider_message_id, 'wamid.test');
    assert.equal(claim.rows[0].attempt_count, 1);

    await db.query(
      'SELECT complete_whatsapp_message_turn($1, $2, $3::jsonb, $4)',
      [claim.rows[0].id, sessionId, JSON.stringify({ cart: [{ quantity: 2 }] }), 'Your cart has two items.'],
    );
    const saved = await db.query(`
      SELECT e.processing_status, e.reply_text, s.conversation_state
      FROM whatsapp_message_events e CROSS JOIN voice_call_sessions s
      WHERE e.id = $1 AND s.id = $2
    `, [claim.rows[0].id, sessionId]);
    assert.equal(saved.rows[0].processing_status, 'reply_ready');
    assert.equal(saved.rows[0].reply_text, 'Your cart has two items.');
    assert.equal(saved.rows[0].conversation_state.cart[0].quantity, 2);

    await assert.rejects(
      db.query(
        'INSERT INTO whatsapp_message_events(provider_message_id, phone_number) VALUES ($1, $2)',
        ['wamid.test', '+919876543210'],
      ),
      (error) => error.code === '23505',
    );

    await db.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(
      db.query('SELECT * FROM whatsapp_message_events'),
      (error) => error.code === '42501',
    );
  } finally {
    await db.close();
  }
});
