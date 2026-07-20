import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ivhmxnixagdjtgjgchmo.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aG14bml4YWdkanRnamdjaG1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMDAzNzgsImV4cCI6MjA5OTU3NjM3OH0.pkAG9VTXaf09HKj1wmKZsdVNAAiT7yv9ZQFR6FdTp4Y";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkSettings() {
  const { data, error } = await supabase
    .from("admin_settings")
    .select("*");
  
  if (error) {
    console.error("Error reading admin_settings:", error.message);
  } else {
    console.log("admin_settings content:", data);
  }
}

checkSettings();
