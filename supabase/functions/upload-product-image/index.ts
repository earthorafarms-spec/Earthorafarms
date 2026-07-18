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

    if (!file || !productId || !productSlug) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
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
