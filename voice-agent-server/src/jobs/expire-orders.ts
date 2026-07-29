import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export function startExpiredOrdersJob(): void {
  // Run every 15 minutes: '*/15 * * * *'
  cron.schedule("*/15 * * * *", async () => {
    try {
      const { data, error } = await supabase.rpc("cancel_expired_voice_orders");
      if (error) {
        console.error("❌ [Expiry Job Error]:", error.message);
      } else {
        const cancelledCount = typeof data === "number" ? data : 0;
        console.log(`⏰ Expiry job: ${cancelledCount} orders cancelled`);
      }
    } catch (err: any) {
      console.error("❌ [Expiry Job Exception]:", err.message);
    }
  });

  console.log("⏱️ Scheduled 15-minute voice order auto-expiry cron job initialized.");
}
