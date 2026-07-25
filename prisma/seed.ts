import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { slugify } from '../src/utils/slugify';

const prisma = new PrismaClient();

const IMAGES_DIR = process.env.MARK254_IMAGES_DIR;
if (!IMAGES_DIR) {
  throw new Error('MARK254_IMAGES_DIR is not set in .env');
}
// Public URL prefix the Next.js app serves these same files under (public/images/mark254/...)
const PUBLIC_PREFIX = '/images/mark254';

const APPAREL_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

interface CategorySeed {
  folder: string;
  name: string;
  description: string;
}

interface ProductSeed {
  categoryFolder: string;
  name: string;
  description: string;
  price: number; // KES
  images: string[]; // filenames within the category folder
  sizes?: string[];
  colors?: string[];
  featured?: boolean;
  isNew?: boolean;
}

// collages_marketing and logo are intentionally excluded — not sellable products.
const categories: CategorySeed[] = [
  { folder: 'tshirts', name: 'T-Shirts', description: 'Everyday performance tees for training and the street.' },
  { folder: 'tshirts_oversized', name: 'Oversized Tees', description: 'Relaxed, oversized-fit streetwear tees.' },
  { folder: 'tanks', name: 'Tank Tops', description: 'Breathable racerback tanks for hot sessions.' },
  { folder: 'shorts', name: 'Shorts', description: 'Lightweight training shorts with secure pockets.' },
  { folder: 'shorts_2in1', name: '2-in-1 Shorts', description: 'Shorts with a built-in compression liner.' },
  { folder: 'joggers', name: 'Joggers', description: 'Tapered joggers for warm-ups and rest days.' },
  { folder: 'hoodies_pullover', name: 'Pullover Hoodies', description: 'Classic pullover hoodies, built for comfort.' },
  { folder: 'hoodies_zip', name: 'Zip-Up Hoodies', description: 'Full-zip hoodies for easy layering.' },
  { folder: 'hoodies_lightweight', name: 'Lightweight Hoodies', description: 'Breathable long-sleeve hooded tees for training.' },
  { folder: 'hoodies_sleeveless', name: 'Sleeveless Hoodies', description: 'Sleeveless hoodies for gym sessions.' },
  { folder: 'jackets', name: 'Jackets', description: 'Windbreakers, bombers, and running jackets.' },
  { folder: 'sports_bra', name: 'Sports Bras', description: 'Supportive racerback sports bras.' },
  { folder: 'caps', name: 'Caps', description: 'Embroidered six-panel caps.' },
  { folder: 'bags', name: 'Bags', description: 'Duffel bags and backpacks for gym and travel.' },
  { folder: 'bottles', name: 'Water Bottles', description: 'Insulated steel and sport water bottles.' },
  { folder: 'shakers_tumblers', name: 'Shakers & Tumblers', description: 'Shaker bottles and insulated travel tumblers.' },
  { folder: 'accessories', name: 'Training Accessories', description: 'Everything else you need for a serious session.' },
];

const products: ProductSeed[] = [
  {
    categoryFolder: 'tshirts',
    name: 'Mark 254 Performance Tee',
    description: 'A lightweight, moisture-wicking crew-neck tee built for training and daily wear.',
    price: 1800,
    sizes: APPAREL_SIZES,
    colors: ['Black', 'White'],
    featured: true,
    images: [
      'tshirts_01.png', 'tshirts_02.png', 'tshirts_03.png', 'tshirts_04.png',
      'tshirts_05.png', 'tshirts_06.png', 'tshirts_07.png', 'tshirts_08.png', 'tshirts_09.png',
    ],
  },
  {
    categoryFolder: 'tshirts_oversized',
    name: 'Mark 254 Oversized Tee',
    description: 'A relaxed, oversized-fit tee in heavyweight cotton for a streetwear look.',
    price: 2000,
    sizes: APPAREL_SIZES,
    colors: ['White'],
    isNew: true,
    images: ['tshirts_oversized_01.png', 'tshirts_oversized_02.png'],
  },
  {
    categoryFolder: 'tanks',
    name: 'Mark 254 Racerback Tank',
    description: 'A breathable racerback tank that moves with you through every set.',
    price: 1600,
    sizes: APPAREL_SIZES,
    colors: ['Black', 'White'],
    images: ['tanks_01.png', 'tanks_02.png', 'tanks_03.png', 'tanks_04.png', 'tanks_05.png'],
  },
  {
    categoryFolder: 'shorts',
    name: 'Mark 254 Training Shorts',
    description: 'Quick-dry training shorts with a drawstring waist and zip pockets.',
    price: 1700,
    sizes: APPAREL_SIZES,
    colors: ['Black', 'White'],
    images: ['shorts_01.png', 'shorts_02.png', 'shorts_03.png', 'shorts_04.png'],
  },
  {
    categoryFolder: 'shorts_2in1',
    name: 'Mark 254 2-in-1 Compression Shorts',
    description: 'Training shorts with a built-in compression liner for extra support.',
    price: 2200,
    sizes: APPAREL_SIZES,
    colors: ['Black', 'White'],
    images: ['shorts_2in1_01.png', 'shorts_2in1_02.png'],
  },
  {
    categoryFolder: 'joggers',
    name: 'Mark 254 Joggers',
    description: 'Tapered fleece joggers with a ribbed cuff, built for rest-day comfort.',
    price: 2500,
    sizes: APPAREL_SIZES,
    colors: ['Black', 'White'],
    images: ['joggers_01.png', 'joggers_02.png', 'joggers_03.png'],
  },
  {
    categoryFolder: 'hoodies_pullover',
    name: 'Mark 254 Pullover Hoodie',
    description: 'A heavyweight pullover hoodie with a kangaroo pocket and adjustable hood.',
    price: 3200,
    sizes: APPAREL_SIZES,
    colors: ['Black', 'White'],
    featured: true,
    images: ['hoodies_pullover_01.png', 'hoodies_pullover_02.png', 'hoodies_pullover_03.png', 'hoodies_pullover_04.png'],
  },
  {
    categoryFolder: 'hoodies_zip',
    name: 'Mark 254 Zip-Up Hoodie',
    description: 'A full-zip hoodie for easy layering on cooler training days.',
    price: 3500,
    sizes: APPAREL_SIZES,
    colors: ['Black', 'White'],
    images: ['hoodies_zip_01.png', 'hoodies_zip_02.png'],
  },
  {
    categoryFolder: 'hoodies_lightweight',
    name: 'Mark 254 Lightweight Training Hoodie',
    description: 'A breathable, long-sleeve hooded tee for warm-weather training.',
    price: 2800,
    sizes: APPAREL_SIZES,
    colors: ['Black'],
    images: ['hoodies_lightweight_01.png'],
  },
  {
    categoryFolder: 'hoodies_sleeveless',
    name: 'Mark 254 Sleeveless Hoodie',
    description: 'A sleeveless hoodie for full range of motion in the gym.',
    price: 2600,
    sizes: APPAREL_SIZES,
    colors: ['Black'],
    images: ['hoodies_sleeveless_01.png', 'hoodies_sleeveless_02.png', 'hoodies_sleeveless_03.png'],
  },
  {
    categoryFolder: 'jackets',
    name: 'Mark 254 Windbreaker',
    description: 'A packable windbreaker with a reflective trim for outdoor runs.',
    price: 3800,
    sizes: APPAREL_SIZES,
    colors: ['Black'],
    images: ['jackets_01.png'],
  },
  {
    categoryFolder: 'jackets',
    name: 'Mark 254 Bomber Jacket',
    description: 'A classic bomber jacket with a zip sleeve pocket.',
    price: 4500,
    sizes: APPAREL_SIZES,
    colors: ['Black'],
    isNew: true,
    images: ['jackets_02.png'],
  },
  {
    categoryFolder: 'jackets',
    name: 'Mark 254 Running Jacket',
    description: 'A hooded running jacket with reflective detailing for low-light sessions.',
    price: 4200,
    sizes: APPAREL_SIZES,
    colors: ['Black'],
    images: ['jackets_03.png'],
  },
  {
    categoryFolder: 'sports_bra',
    name: 'Mark 254 Sports Bra',
    description: 'A supportive racerback sports bra for high-intensity training.',
    price: 1900,
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    colors: ['Black', 'White'],
    images: ['sports_bra_01.png', 'sports_bra_02.png'],
  },
  {
    categoryFolder: 'caps',
    name: 'Mark 254 Snapback Cap',
    description: 'An embroidered six-panel snapback cap.',
    price: 1200,
    colors: ['Black', 'White'],
    images: ['caps_01.png', 'caps_02.png', 'caps_03.png'],
  },
  {
    categoryFolder: 'bags',
    name: 'Mark 254 Duffel Bag',
    description: 'A durable gym duffel with a side shoe compartment and adjustable strap.',
    price: 3500,
    colors: ['Black'],
    images: ['bags_01.png', 'bags_02.png'],
  },
  {
    categoryFolder: 'bags',
    name: 'Mark 254 Backpack',
    description: 'A laptop-ready backpack with a padded strap and mesh side pocket.',
    price: 4200,
    colors: ['Black'],
    images: ['bags_03.png'],
  },
  {
    categoryFolder: 'bottles',
    name: 'Mark 254 Steel Water Bottle',
    description: 'An insulated stainless-steel water bottle that keeps drinks cold for hours.',
    price: 1500,
    colors: ['Black', 'White'],
    featured: true,
    images: ['bottles_01.png', 'bottles_02.png', 'bottles_03.png', 'bottles_04.png', 'bottles_05.png', 'bottles_06.png'],
  },
  {
    categoryFolder: 'shakers_tumblers',
    name: 'Mark 254 Shaker Bottle',
    description: 'A 700ml leak-proof shaker with a stainless-steel mixing ball.',
    price: 900,
    colors: ['Black'],
    images: ['shakers_tumblers_01.png'],
  },
  {
    categoryFolder: 'shakers_tumblers',
    name: 'Mark 254 Travel Tumbler',
    description: 'An insulated travel tumbler with a secure flip lid.',
    price: 1800,
    colors: ['Black'],
    images: ['shakers_tumblers_02.png', 'shakers_tumblers_03.png'],
  },
  {
    categoryFolder: 'accessories',
    name: 'Mark 254 Yoga Mat',
    description: 'A non-slip yoga mat for comfortable stretching and floor work.',
    price: 2500,
    colors: ['Black'],
    images: ['accessories_01.png'],
  },
  {
    categoryFolder: 'accessories',
    name: 'Mark 254 Training Gloves',
    description: 'Padded fingerless gym gloves with wrist wrap support.',
    price: 1500,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Black'],
    images: ['accessories_02.png'],
  },
  {
    categoryFolder: 'accessories',
    name: 'Mark 254 Resistance Bands Set',
    description: 'A set of 5 resistance bands (X-Light to X-Heavy) with a carry pouch.',
    price: 1800,
    colors: ['Multi'],
    featured: true,
    images: ['accessories_03.png'],
  },
  {
    categoryFolder: 'accessories',
    name: 'Mark 254 Knee Sleeves',
    description: 'A pair of compression knee sleeves for joint support under load.',
    price: 1600,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Black'],
    images: ['accessories_04.png'],
  },
  {
    categoryFolder: 'accessories',
    name: 'Mark 254 Lifting Straps',
    description: 'A pair of cotton lifting straps for a secure grip on heavy pulls.',
    price: 1200,
    colors: ['Black'],
    images: ['accessories_05.png'],
  },
  {
    categoryFolder: 'accessories',
    name: 'Mark 254 Gym Towel',
    description: 'A quick-dry microfiber gym towel.',
    price: 900,
    colors: ['White'],
    images: ['accessories_06.png'],
  },
];

async function main() {
  console.log(`Seeding from images at: ${IMAGES_DIR}`);

  const categoryIdByFolder = new Map<string, number>();
  for (const cat of categories) {
    const record = await prisma.category.upsert({
      where: { slug: slugify(cat.name) },
      update: { description: cat.description },
      create: { name: cat.name, slug: slugify(cat.name), description: cat.description },
    });
    categoryIdByFolder.set(cat.folder, record.id);
  }
  console.log(`Upserted ${categories.length} categories.`);

  let created = 0;
  for (const p of products) {
    const categoryId = categoryIdByFolder.get(p.categoryFolder);
    if (!categoryId) throw new Error(`Unknown category folder: ${p.categoryFolder}`);

    const slug = slugify(p.name);
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (existing) {
      console.log(`Skipping existing product: ${p.name}`);
      continue;
    }

    await prisma.product.create({
      data: {
        name: p.name,
        slug,
        description: p.description,
        price: p.price,
        categoryId,
        inStock: true,
        featured: p.featured ?? false,
        isNew: p.isNew ?? false,
        sizes: p.sizes ? JSON.stringify(p.sizes) : null,
        colors: p.colors ? JSON.stringify(p.colors) : null,
        images: {
          create: p.images.map((filename, position) => ({
            url: `${PUBLIC_PREFIX}/${p.categoryFolder}/${filename}`,
            position,
          })),
        },
      },
    });
    created += 1;
  }

  console.log(`Created ${created} products (${products.length - created} already existed).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
