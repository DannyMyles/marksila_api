/**
 * Moves the Fitness catalogue onto the MarkSila photos and tags each photo
 * with its garment colour, so the shop's colour picker swaps images.
 *
 *   npm run rebrand-images             # apply
 *   npm run rebrand-images -- --dry    # show what would change
 *
 * Only rows still pointing at the legacy /images/mark254/*.png photos are
 * touched; admin uploads and colour tags set by an admin are left alone.
 * Safe to run more than once.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { IMAGE_COLORS, catalogImageUrl, legacyImageKey } from '../prisma/catalogImages';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry');

async function main() {
  const images = await prisma.productImage.findMany({
    where: { url: { startsWith: '/images/mark254/' } },
    include: { product: { select: { colors: true } } },
  });

  let changed = 0;
  for (const image of images) {
    const key = legacyImageKey(image.url);
    if (!key) continue;

    const productColors: string[] = image.product.colors ? JSON.parse(image.product.colors) : [];
    const tag = IMAGE_COLORS[key];
    const color = image.color ?? (tag && productColors.includes(tag) ? tag : null);
    const url = catalogImageUrl(key);

    console.log(`${dryRun ? '[dry] ' : ''}${image.url} → ${url}${color ? ` (${color})` : ''}`);
    if (!dryRun) {
      await prisma.productImage.update({ where: { id: image.id }, data: { url, color } });
    }
    changed += 1;
  }
  console.log(`${dryRun ? 'Would update' : 'Updated'} ${changed} product image(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
