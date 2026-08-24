import { config } from '../config.js';

// Thin Resend wrapper — email delivery for the verification link.
// Deliberately the ONLY place that sends email; sole caller is tools/checkout.ts.
export async function sendVerificationEmail(toEmail: string, verificationUrl: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.RESEND_FROM_EMAIL,
        to: [toEmail],
        subject: 'Review your Earthora Farms order',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #FAF9F5; border-radius: 20px; border: 1px solid #CFDCD3; color: #15271D;">
            <div style="background: #26593B; padding: 24px; border-radius: 14px; margin-bottom: 24px; text-align: center;">
              <h1 style="color: #FAF8F3; margin: 0; font-size: 20px; font-weight: normal; font-family: Georgia, serif;">Review your order</h1>
            </div>
            <div style="background: #ffffff; border-radius: 14px; padding: 24px; border: 1px solid #E1E8E3; margin-bottom: 24px;">
              <p style="margin: 0 0 16px; font-size: 14px; color: #444; line-height: 1.6;">
                Thanks for talking with the Earthora Farms voice assistant. Please review your order and
                delivery details below, edit anything that's not right, then continue to secure payment.
              </p>
              <p style="text-align: center; margin: 24px 0;">
                <a href="${verificationUrl}" style="display: inline-block; background: #26593B; color: #FAF8F3; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: bold; font-size: 14px;">
                  Review &amp; Pay
                </a>
              </p>
              <p style="margin: 0; font-size: 12px; color: #888;">
                This link expires soon. If it has expired, just call back and ask for a new one.
              </p>
            </div>
            <p style="text-align: center; font-size: 12px; color: #777; margin: 0;">
              Earthora Farms &middot; <a href="https://earthorafarms.com" style="color: #26593B;">earthorafarms.com</a>
            </p>
          </div>
        `,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Tata SmartFlow SMS — sends the same verification link via SMS to the
// customer's phone. Uses the same credentials as the send-sms-alert Supabase
// Edge function. No-op (returns false) when SmartFlow is not configured.
export async function sendVerificationSms(toPhone: string, verificationUrl: string): Promise<boolean> {
  if (!config.smartflowConfigured) return false;
  try {
    const normalised = toPhone.startsWith('+') ? toPhone : `+91${toPhone.replace(/\D/g, '')}`;
    const message =
      `Earthora Farms: Review & pay your order here:\n${verificationUrl}\nLink expires in ${config.VOICE_CHECKOUT_TTL_MINUTES} mins.`;
    const res = await fetch(`${config.SMARTFLOW_BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.SMARTFLOW_API_KEY}`,
      },
      body: JSON.stringify({
        from: config.SMARTFLOW_SENDER_ID,
        to: normalised,
        message,
        type: 'text',
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
