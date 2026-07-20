/**
 * Earthora Product Image Upload Script
 * --------------------------------------
 * Uploads product images to the "product-images" Supabase storage bucket
 * and updates the products table with the correct public CDN URLs.
 *
 * PREREQUISITE: Run the SQL migration in Supabase SQL Editor first to create
 * the bucket and its RLS policies.
 *
 * Run: node scripts/upload-product-images.mjs
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://ivhmxnixagdjtgjgchmo.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aG14bml4YWdkanRnamdjaG1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMDAzNzgsImV4cCI6MjA5OTU3NjM3OH0.pkAG9VTXaf09HKj1wmKZsdVNAAiT7yv9ZQFR6FdTp4Y";

const BUCKET_NAME = "product-images";
const IMAGES_DIR = path.resolve(__dirname, "../attached_assets/generated_images");

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Map: product slug → { main image filename, hover image filename }
const PRODUCT_IMAGE_MAP = {
  capsules: { main: "product_capsules.jpg",  hover: "product_capsules_2.jpg" },
  powder:   { main: "product_powder.jpg",    hover: "product_powder_2.jpg"   },
  tablets:  { main: "product_tablets.jpg",   hover: "product_tablets_2.jpg"  },
  amla:     { main: "hero_leaves.jpg",       hover: "hero_leaves_2.jpg"      },
};

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png")  return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function uploadImage(filename) {
  const filePath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠  File not found: ${filePath}`);
    return null;
  }

  const fileBuffer = fs.readFileSync(filePath);
  const contentType = getMimeType(filename);

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filename, fileBuffer, { contentType, upsert: true });

  if (error) {
    console.error(`  ❌ Upload failed for ${filename}: ${error.message}`);
    return null;
  }

  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filename);
  return data.publicUrl;
}

async function updateProductImages(slug, mainUrl, hoverUrl) {
  const images = [
    { url: mainUrl,  is_primary: true  },
    { url: hoverUrl, is_primary: false },
  ];

  const { error } = await supabase
    .from("products")
    .update({ images: JSON.stringify(images) })
    .eq("slug", slug);

  if (error) {
    console.error(`  ❌ DB update failed for "${slug}": ${error.message}`);
    return false;
  }

  console.log(`  ✅ DB record updated for "${slug}"`);
  return true;
}

async function main() {
  console.log("🚀 Earthora Product Image Upload");
  console.log("=================================\n");
  console.log(`📁 Source:  ${IMAGES_DIR}`);
  console.log(`🪣 Bucket:  ${BUCKET_NAME}\n`);

  // Collect all unique filenames
  const allFiles = new Set(
    Object.values(PRODUCT_IMAGE_MAP).flatMap(({ main, hover }) => [main, hover])
  );

  console.log(`📤 Uploading ${allFiles.size} images...`);
  const uploadedUrls = {};
  for (const filename of allFiles) {
    process.stdout.write(`   ${filename.padEnd(32)}`);
    const url = await uploadImage(filename);
    if (url) {
      uploadedUrls[filename] = url;
      console.log("✅");
    } else {
      console.log("❌ skipped");
    }
  }

  console.log("\n🗄️  Updating products table...");
  for (const [slug, { main, hover }] of Object.entries(PRODUCT_IMAGE_MAP)) {
    const mainUrl  = uploadedUrls[main];
    const hoverUrl = uploadedUrls[hover] || mainUrl;
    if (!mainUrl) {
      console.warn(`   ⚠  Skipping "${slug}" — main image was not uploaded`);
      continue;
    }
    await updateProductImages(slug, mainUrl, hoverUrl);
  }

  console.log("\n🎉 Done! Product images are live on Supabase Storage.");
  console.log(`\n🔗 Bucket base URL:`);
  console.log(`   ${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/\n`);
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
