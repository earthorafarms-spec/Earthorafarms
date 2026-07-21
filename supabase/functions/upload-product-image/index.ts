// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-password",
};

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let mismatch = ab.length !== bb.length ? 1 : 0;
  const len = Math.max(ab.length, bb.length);
  const aPadded = new Uint8Array(len);
  const bPadded = new Uint8Array(len);
  aPadded.set(ab);
  bPadded.set(bb);
  for (let i = 0; i < len; i++) {
    mismatch |= aPadded[i] ^ bPadded[i];
  }
  return mismatch === 0;
}

// @ts-ignore
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const productId = formData.get("product_id") as string;
    const productSlug = formData.get("product_slug") as string;
    const isPrimary = formData.get("is_primary") === "true";
    const altText = formData.get("alt") as string;
    const password = formData.get("password") as string;

    if (!file || !productId || !productSlug) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Verify admin password before allowing upload
    if (!password) {
      return new Response(JSON.stringify({ error: "Admin password required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const envPassword = Deno.env.get("ADMIN_PASSWORD");
    let passwordOk = false;

    if (envPassword) {
      passwordOk = constantTimeEqual(password, envPassword);
    }

    if (!passwordOk) {
      const { data: pwData } = await supabase
        .from("admin_settings")
        .select("value")
        .eq("key", "admin_password")
        .single();

      if (pwData) {
        passwordOk = constantTimeEqual(password, pwData.value);
      }
    }

    if (!passwordOk) {
      return new Response(JSON.stringify({ error: "Invalid admin password" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const fileExt = file.name.split(".").pop();
    const timestamp = Date.now();
    const fileName = `${productSlug}/${timestamp}.${fileExt}`;
    const rawFileName = `${productSlug}/${timestamp}_raw.${fileExt}`;

    // Upload original to private bucket
    const fileBuffer = await file.arrayBuffer();
    await supabase.storage
      .from("product-images-raw")
      .upload(rawFileName, fileBuffer, { contentType: file.type, upsert: true });

    // Upload to public bucket (same file for now)
    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(fileName, fileBuffer, { contentType: file.type, upsert: true });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from("product-images")
      .getPublicUrl(fileName);

    // Update the images JSONB array in the products table
    const { data: product } = await supabase
      .from("products")
      .select("images")
      .eq("id", productId)
      .single();

    const existingImages = (product?.images as any[]) || [];

    // If this is primary, unset all other primaries
    const updatedImages = existingImages.map((img: any) => ({
      ...img,
      is_primary: isPrimary ? false : img.is_primary,
    }));

    updatedImages.push({
      url: publicUrl,
      alt: altText || "",
      is_primary: isPrimary || existingImages.length === 0,
    });

    await supabase
      .from("products")
      .update({ images: updatedImages })
      .eq("id", productId);

    return new Response(JSON.stringify({ success: true, url: publicUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
