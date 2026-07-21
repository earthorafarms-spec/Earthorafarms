import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://ivhmxnixagdjtgjgchmo.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aG14bml4YWdkanRnamdjaG1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDAwMDM3OCwiZXhwIjoyMDk5NTc2Mzc4fQ.PD7BDcnMdX5WQY9wckpMEJJtdpQlJNvP46Ij__AP_iI";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  const { data: prods } = await supabase.from("products").select("id, name, slug, images");
  console.log("=== Products ===");
  console.log(JSON.stringify(prods, null, 2));
}

run();
