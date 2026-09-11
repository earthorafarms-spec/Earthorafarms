import { supabase } from '../voice-service/src/lib/supabaseClient.js';
import { sendWhatsAppLowStockAlert } from './provider.js';

const LOW_STOCK_PHONE = '917572866635';

interface LowStockAlert {
  id: number;
  product_name: string;
  stock_at_alert: number;
  threshold: number;
  recipients: string[] | null;
}

/**
 * Delivers pending database-generated alerts directly from the WhatsApp
 * service. This is a safety net for installations where the Supabase Database
 * Webhook is not configured; the atomic status claim prevents duplicate sends
 * if the webhook and poller race.
 */
export async function drainLowStockAlerts(log: { error: (obj: unknown, message: string) => void }): Promise<number> {
  const { data: pending, error } = await supabase
    .from('sms_alert_logs')
    .select('id,product_name,stock_at_alert,threshold,recipients')
    .eq('triggered_by', 'auto_trigger')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) throw new Error(`low-stock alert lookup failed: ${error.message}`);

  let delivered = 0;
  for (const candidate of (pending ?? []) as LowStockAlert[]) {
    const { data: claimed, error: claimError } = await supabase
      .from('sms_alert_logs')
      .update({ status: 'processing' })
      .eq('id', candidate.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (claimError || !claimed) continue;

    try {
      await sendWhatsAppLowStockAlert(
        LOW_STOCK_PHONE,
        candidate.product_name || 'Unknown Product',
        Number(candidate.stock_at_alert || 0),
        Number(candidate.threshold || 15),
      );
      await supabase.from('sms_alert_logs').update({ status: 'delivered' }).eq('id', candidate.id);
      delivered++;
    } catch (sendError) {
      log.error({ err: sendError instanceof Error ? sendError.message : 'unknown error', alertId: candidate.id }, 'low-stock WhatsApp delivery failed');
      await supabase.from('sms_alert_logs').update({ status: 'failed' }).eq('id', candidate.id);
    }
  }

  return delivered;
}
