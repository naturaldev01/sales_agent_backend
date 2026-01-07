/**
 * Script to upload template images to Supabase Storage
 * Run with: npx ts-node --skip-project scripts/upload-template-images.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://sfsgwmxuyoojdtfmcxvg.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TEMPLATE_IMAGES_DIR = path.join(__dirname, '..', 'template_images');
const BUCKET_NAME = 'template-images';

// Treatment category to filename mapping
const TREATMENT_TEMPLATE_MAP: Record<string, Record<string, string>> = {
  hair_transplant: {
    en: 'en-hairtransplant-man.jpeg',
    default: 'en-hairtransplant-man.jpeg',
  },
  hair_transplant_female: {
    ar: 'ar-female-hairtransplant.jpeg',
    default: 'ar-female-hairtransplant.jpeg',
  },
  dental: {
    en: 'en-dental-1.jpeg',
    default: 'en-dental-1.jpeg',
  },
  rhinoplasty: {
    en: 'en-rhinoplasty.jpeg',
    default: 'en-rhinoplasty.jpeg',
  },
  breast: {
    fr: 'fr-breast.jpeg',
    ar: 'ar-breast.jpeg',
    default: 'fr-breast.jpeg',
  },
  liposuction: {
    en: 'en-fullbody-female.jpeg',
    default: 'en-fullbody-female.jpeg',
  },
  bbl: {
    en: 'en-fullbody-female.jpeg',
    default: 'en-fullbody-female.jpeg',
  },
  arm_lift: {
    en: 'en-armlift.jpeg',
    default: 'en-armlift.jpeg',
  },
  facelift: {
    fr: 'fr-facelift-1.jpeg',
    default: 'fr-facelift-1.jpeg',
  },
};

async function uploadTemplateImages() {
  console.log('Starting template image upload...');
  console.log(`Source directory: ${TEMPLATE_IMAGES_DIR}`);

  // Get all unique filenames from the mapping
  const filesToUpload = new Set<string>();
  for (const category of Object.values(TREATMENT_TEMPLATE_MAP)) {
    for (const filename of Object.values(category)) {
      filesToUpload.add(filename);
    }
  }

  // Also add any additional files in the directory
  if (fs.existsSync(TEMPLATE_IMAGES_DIR)) {
    const dirFiles = fs.readdirSync(TEMPLATE_IMAGES_DIR);
    for (const file of dirFiles) {
      if (file.endsWith('.jpeg') || file.endsWith('.jpg') || file.endsWith('.png')) {
        filesToUpload.add(file);
      }
    }
  }

  console.log(`Found ${filesToUpload.size} files to upload`);

  const uploadedUrls: Record<string, string> = {};

  for (const filename of filesToUpload) {
    const filePath = path.join(TEMPLATE_IMAGES_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  File not found: ${filename}`);
      continue;
    }

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const storagePath = filename; // Store directly in bucket root

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, fileBuffer, {
          contentType: 'image/jpeg',
          upsert: true, // Overwrite if exists
        });

      if (uploadError) {
        console.error(`❌ Failed to upload ${filename}:`, uploadError.message);
        continue;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(storagePath);

      uploadedUrls[filename] = urlData.publicUrl;
      console.log(`✅ Uploaded: ${filename} -> ${urlData.publicUrl}`);
    } catch (error) {
      console.error(`❌ Error uploading ${filename}:`, error);
    }
  }

  console.log('\n📊 Upload Summary:');
  console.log(`Total files: ${filesToUpload.size}`);
  console.log(`Successfully uploaded: ${Object.keys(uploadedUrls).length}`);

  // Update photo_checklists table with URLs
  console.log('\n📝 Updating photo_checklists table...');
  
  for (const [filename, url] of Object.entries(uploadedUrls)) {
    const templatePath = `template_images/${filename}`;
    
    const { error: updateError } = await supabase
      .from('photo_checklists')
      .update({ template_image_url: url })
      .eq('template_image_path', templatePath);

    if (updateError) {
      console.error(`❌ Failed to update URL for ${templatePath}:`, updateError.message);
    } else {
      console.log(`✅ Updated photo_checklists: ${templatePath} -> ${url}`);
    }
  }

  console.log('\n✨ Template image upload complete!');
  return uploadedUrls;
}

// Run the script
uploadTemplateImages()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
