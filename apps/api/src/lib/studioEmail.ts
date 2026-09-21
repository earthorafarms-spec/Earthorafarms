/** Studio-only outbox delivery. No visitor data is stored in the receipt table. */
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { sql } from '../db/client.js';
import { emailPayload, sendEmail, type SendEmailInput } from './email.js';

type Part = 'ack' | 'notice' | 'callback';
type Receipt = { fingerprint: string; status: string; provider_id: string | null; expired: boolean; leased: boolean };

export function isStudioNotification(dedupeKey: string | null): dedupeKey is string {
  return typeof dedupeKey === 'string' && dedupeKey.startsWith('studio-request:');
}

function stopped(message: string): Error {
  return Object.assign(new Error(message), { uncertain: true });
}

export async function sendStudioEmail(dedupeKey: string, part: Part, input: SendEmailInput): Promise<string> {
  if (!isStudioNotification(dedupeKey)) throw new Error('Studio email requires a Studio request identity');
  if (!config.RESEND_API_KEY) throw new Error('Studio email provider is unavailable');
  const emailKey = 'studio-' + createHash('sha256').update(JSON.stringify([dedupeKey, part])).digest('hex');
  const hash = createHash('sha256').update(JSON.stringify(emailPayload(input))).digest('hex');
  const lease = randomUUID();
  // Commit the first-attempt timestamp BEFORE HTTP. A crash after provider acceptance
  // then remains retryable with the same key, never as a fresh untracked send.
  const claim = await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${emailKey},0))`;
    const [row] = await tx<Receipt[]>`SELECT fingerprint,status,provider_id,
      first_attempt_at < now() - interval '23 hours 55 minutes' AS expired,
      lease_until > now() AS leased FROM studio_email_receipts WHERE email_key=${emailKey} FOR UPDATE`;
    if (row?.fingerprint !== undefined && row.fingerprint !== hash)
      return { error: 'Studio email payload changed; reconcile the existing receipt before retrying.' };
    if (row?.status === 'sent' && row.provider_id) return { id: row.provider_id };
    if (row && (row.expired || row.status === 'uncertain')) {
      await tx`UPDATE studio_email_receipts SET status='uncertain',lease_token=NULL,lease_until=NULL WHERE email_key=${emailKey}`;
      return { error: 'Studio email outcome is uncertain beyond its safe retry window; reconcile with the provider.' };
    }
    if (row?.leased) return { busy: true };
    if (!row) {
      await tx`INSERT INTO studio_email_receipts (email_key,fingerprint,lease_token,lease_until)
        VALUES (${emailKey},${hash},${lease},now() + interval '60 seconds')`;
    } else {
      await tx`UPDATE studio_email_receipts SET lease_token=${lease},lease_until=now() + interval '60 seconds' WHERE email_key=${emailKey}`;
    }
    return { claimed: true };
  });
  if ('error' in claim && claim.error) throw stopped(claim.error);
  if ('id' in claim && claim.id) return claim.id;
  if ('busy' in claim) throw new Error('Studio email is already being delivered; retry after its lease.');
  try {
    const id = await sendEmail({ ...input, idempotencyKey: emailKey });
    if (!id) throw new Error('Email provider unavailable');
    // A later concurrent lease may have received the same cached provider result.
    // This precise provider receipt is sufficient to mark the immutable send done.
    await sql`UPDATE studio_email_receipts SET status='sent',provider_id=${id},sent_at=COALESCE(sent_at,now()),
      lease_token=NULL,lease_until=NULL WHERE email_key=${emailKey} AND fingerprint=${hash}`;
    return id;
  } catch {
    // Preserve the first-attempt timestamp even for known failures. A transport
    // exception can mean the provider sent the email but the response was lost.
    await sql`UPDATE studio_email_receipts SET lease_token=NULL,lease_until=NULL
      WHERE email_key=${emailKey} AND lease_token=${lease} AND status='sending'`;
    throw new Error('Studio email attempt did not complete; retry using its existing receipt.');
  }
}
