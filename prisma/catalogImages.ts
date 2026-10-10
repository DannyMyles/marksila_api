// Fitness (MarkSila) catalogue photos. Every photo carries a pocket-size
// MarkSila logo and is served by the Fitness site from
// public/images/marksila/<folder>/<name>.webp. The colour tag is the garment
// colour in that photo — the shop swaps to those photos when a customer picks
// that colour, so it must match one of the product's `colors`.

export const CATALOG_IMAGE_PREFIX = '/images/marksila';

/** Legacy location of the same photos (old "Mark 254" artwork, PNG). */
export const LEGACY_IMAGE_PREFIX = '/images/mark254';

export const IMAGE_COLORS: Record<string, string> = {
  'tshirts/tshirts_01': 'Black',
  'tshirts/tshirts_02': 'White',
  'tshirts/tshirts_03': 'White',
  'tshirts/tshirts_04': 'Black',
  'tshirts/tshirts_05': 'White',
  'tshirts/tshirts_06': 'Black',
  'tshirts/tshirts_07': 'White',
  'tshirts/tshirts_08': 'Black',
  'tshirts/tshirts_09': 'White',
  'tshirts_oversized/tshirts_oversized_01': 'White',
  'tshirts_oversized/tshirts_oversized_02': 'White',
  'tanks/tanks_01': 'Black',
  'tanks/tanks_02': 'White',
  'tanks/tanks_03': 'Black',
  'tanks/tanks_04': 'White',
  'tanks/tanks_05': 'Black',
  'shorts/shorts_01': 'Black',
  'shorts/shorts_02': 'Black',
  'shorts/shorts_03': 'White',
  'shorts/shorts_04': 'White',
  'shorts_2in1/shorts_2in1_01': 'Black',
  'shorts_2in1/shorts_2in1_02': 'White',
  'joggers/joggers_01': 'Black',
  'joggers/joggers_02': 'Black',
  'joggers/joggers_03': 'White',
  'hoodies_pullover/hoodies_pullover_01': 'Black',
  'hoodies_pullover/hoodies_pullover_02': 'Black',
  'hoodies_pullover/hoodies_pullover_03': 'Black',
  'hoodies_pullover/hoodies_pullover_04': 'White',
  'hoodies_zip/hoodies_zip_01': 'Black',
  'hoodies_zip/hoodies_zip_02': 'White',
  'hoodies_lightweight/hoodies_lightweight_01': 'Black',
  'hoodies_sleeveless/hoodies_sleeveless_01': 'Black',
  'hoodies_sleeveless/hoodies_sleeveless_02': 'Black',
  'hoodies_sleeveless/hoodies_sleeveless_03': 'Black',
  'jackets/jackets_01': 'Black',
  'jackets/jackets_02': 'Black',
  'jackets/jackets_03': 'Black',
  'sports_bra/sports_bra_01': 'Black',
  'sports_bra/sports_bra_02': 'White',
  'caps/caps_01': 'Black',
  'caps/caps_02': 'Black',
  'caps/caps_03': 'White',
  'bags/bags_01': 'Black',
  'bags/bags_02': 'Black',
  'bags/bags_03': 'Black',
  'bottles/bottles_01': 'Black',
  'bottles/bottles_02': 'Black',
  'bottles/bottles_03': 'White',
  'bottles/bottles_04': 'Black',
  'bottles/bottles_05': 'Black',
  'bottles/bottles_06': 'White',
  'shakers_tumblers/shakers_tumblers_01': 'Black',
  'shakers_tumblers/shakers_tumblers_02': 'Black',
  'shakers_tumblers/shakers_tumblers_03': 'Black',
  'accessories/accessories_01': 'Black',
  'accessories/accessories_02': 'Black',
  'accessories/accessories_04': 'Black',
  'accessories/accessories_05': 'Black',
  'accessories/accessories_06': 'White',
};

/** `tshirts/tshirts_01` → `/images/marksila/tshirts/tshirts_01.webp` */
export function catalogImageUrl(key: string): string {
  return `${CATALOG_IMAGE_PREFIX}/${key}.webp`;
}

/**
 * Maps a legacy `/images/mark254/<folder>/<name>.png` URL to its catalogue
 * key, or null for anything else (admin uploads, external URLs).
 */
export function legacyImageKey(url: string): string | null {
  const match = url.match(/^\/images\/mark254\/([a-z0-9_]+\/[a-z0-9_]+)\.png$/i);
  return match ? match[1] : null;
}
