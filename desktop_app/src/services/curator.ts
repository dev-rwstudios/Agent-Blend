import assetCatalog from '../assets/asset_catalog.json';
import { StagingItem, StagingManifest } from '../types';

interface CatalogAsset {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  room_types?: string[];
  style_tags?: string[];
  dimensions_m?: {
    width: number;
    depth: number;
    height: number;
  };
  surface?: string;
  model_path?: string;
  forward_axis?: string;
}

const typedCatalog = assetCatalog as unknown as CatalogAsset[];

/**
 * Common furniture/decor keywords and their catalog mappings
 */
const ASSET_KEYWORD_MAP: Record<string, { category: string; subcategory?: string; preferredId?: string }> = {
  sofa: { category: 'seating', subcategory: 'sofa', preferredId: 'seating/sofa' },
  couch: { category: 'seating', subcategory: 'sofa', preferredId: 'seating/sofa' },
  seat: { category: 'seating', subcategory: 'stool', preferredId: 'seating/seat' },
  stool: { category: 'seating', subcategory: 'stool', preferredId: 'seating/stool' },
  chair: { category: 'seating', preferredId: 'seating/seat' },

  'coffee table': { category: 'table', subcategory: 'coffee_table', preferredId: 'table/coffee_table' },
  'bedside table': { category: 'table', subcategory: 'bedside_table', preferredId: 'table/modern_bedside_table' },
  nightstand: { category: 'table', subcategory: 'bedside_table', preferredId: 'table/modern_bedside_table' },
  'side table': { category: 'table', preferredId: 'table/table_taytum' },
  table: { category: 'table', preferredId: 'table/coffee_table' },

  bed: { category: 'bed', subcategory: 'bed_frame', preferredId: 'bed/bed_frame_01' },
  headboard: { category: 'bed', subcategory: 'headboard', preferredId: 'bed/headboard' },

  rug: { category: 'rug', preferredId: 'rug/carpet_square' },
  carpet: { category: 'rug', preferredId: 'rug/carpet_square' },

  tv: { category: 'electronics', subcategory: 'television', preferredId: 'electronics/simple_wall_tv' },
  television: { category: 'electronics', subcategory: 'television', preferredId: 'electronics/simple_wall_tv' },
  speaker: { category: 'electronics', subcategory: 'speaker', preferredId: 'electronics/bluetooth_soundbar_sony' },
  soundbar: { category: 'electronics', subcategory: 'speaker', preferredId: 'electronics/bluetooth_soundbar_sony' },

  'floor lamp': { category: 'lighting', subcategory: 'floor_lamp', preferredId: 'lighting/floor_lamp' },
  lamp: { category: 'lighting', preferredId: 'lighting/floor_lamp' },
  chandelier: { category: 'lighting', subcategory: 'chandelier', preferredId: 'lighting/astral_agnes_12_lights_chandelier' },
  'ceiling lamp': { category: 'lighting', subcategory: 'ceiling_lamp', preferredId: 'lighting/square_ceiling_lamp' },
  'ceiling light': { category: 'lighting', subcategory: 'ceiling_lamp', preferredId: 'lighting/square_ceiling_lamp' },
  'spot light': { category: 'lighting', subcategory: 'spot_light', preferredId: 'lighting/stella_spot_light' },
  'wall lamp': { category: 'lighting', subcategory: 'wall_lamp', preferredId: 'lighting/wall_lamp' },

  wardrobe: { category: 'storage', subcategory: 'wardrobe', preferredId: 'storage/wardrobe' },
  closet: { category: 'storage', subcategory: 'wardrobe', preferredId: 'storage/wardrobe' },
  shelf: { category: 'storage', subcategory: 'shelf', preferredId: 'storage/modern_wood_shelf' },
  bookshelf: { category: 'storage', subcategory: 'shelf', preferredId: 'storage/modern_wood_shelf' },
  'tv stand': { category: 'storage', subcategory: 'tv_stand', preferredId: 'storage/tv_stand' },
  'tv cabinet': { category: 'storage', subcategory: 'tv_cabinet', preferredId: 'storage/tv_cabinet' },
  'dressing table': { category: 'storage', subcategory: 'dressing_table', preferredId: 'storage/dressing_table' },

  plant: { category: 'decor', subcategory: 'plant', preferredId: 'decor/banana_plant' },
  vase: { category: 'decor', subcategory: 'vase', preferredId: 'decor/bird_of_paradise_vase' },
  mirror: { category: 'decor', subcategory: 'mirror', preferredId: 'decor/bathroom_mirror' },
  books: { category: 'decor', subcategory: 'books', preferredId: 'decor/books_stack' },
  sculpture: { category: 'decor', subcategory: 'sculpture', preferredId: 'decor/decor_standing_man_sculpture' },
  pillow: { category: 'soft_furnishing', preferredId: 'soft_furnishing/pillow_01' },
};

/**
 * Common items requested by users that DO NOT exist in the 88-item local asset library.
 * These will be detected and flagged with "can't find relevant assets in library" + upload prompts!
 */
const COMMONLY_MISSING_KEYWORDS = [
  'fireplace',
  'chimney',
  'piano',
  'refrigerator',
  'fridge',
  'microwave',
  'stove',
  'oven',
  'bathtub',
  'shower',
  'toilet',
  'pool table',
  'billiards',
  'desk',
  'aquarium',
  'dining table',
  'dining chair',
  'bar counter',
  'gaming pc',
  'computer',
  'curtain',
  'blinds',
  'garage',
  'car',
  'swimming pool',
  'ceiling fan',
];

/**
 * Find alternatives for an asset from the catalog
 */
export function getAlternativesForCategory(
  category: string,
  excludeId?: string,
  limit = 3,
  pool: CatalogAsset[] = typedCatalog
): Array<{
  id: string;
  name: string;
  assetId: string;
  category: string;
  subcategory?: string;
  dimensions?: { width: number; depth: number; height: number };
  modelPath?: string;
}> {
  return pool
    .filter((a) => a.category === category && a.id !== excludeId)
    .slice(0, limit)
    .map((a) => ({
      id: a.id,
      name: a.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      assetId: a.id,
      category: a.category,
      subcategory: a.subcategory,
      dimensions: a.dimensions_m,
      modelPath: a.model_path,
    }));
}

/**
 * Search catalog by free-text
 */
export function searchCatalog(
  query: string,
  limit = 15,
  pool: CatalogAsset[] = typedCatalog
): CatalogAsset[] {
  const q = query.toLowerCase().trim();
  if (!q) return pool.slice(0, limit);
  return pool
    .filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        (a.subcategory && a.subcategory.toLowerCase().includes(q)) ||
        (a.style_tags && a.style_tags.some((s) => s.toLowerCase().includes(q)))
    )
    .slice(0, limit);
}

/**
 * Determine if a prompt is an architectural/interior scene generation request
 * that should trigger the Asset Curator
 */
export function isSceneGenerationPrompt(prompt: string): boolean {
  const text = prompt.toLowerCase();
  const sceneTriggers = [
    'build a house',
    'build house',
    'furnish',
    'living room',
    'bedroom',
    'room',
    'interior',
    'stage assets',
    'curate assets',
    'apartment',
    'cabin',
    'villa',
    'house',
    'cozy',
    'modern house',
    'sofa and',
    'bed and',
    'furniture',
  ];
  return sceneTriggers.some((t) => text.includes(t));
}

/**
 * Intelligent Asset Curator: analyzes the user prompt, queries the local catalog,
 * identifies missing assets, and produces a Staging Manifest for interactive user review.
 */
export function curateSceneAssets(
  prompt: string,
  pool: CatalogAsset[] = typedCatalog
): StagingManifest {
  const text = prompt.toLowerCase();
  const items: StagingItem[] = [];
  const addedSlots = new Set<string>();

  // Determine room context
  let roomType = 'living_room';
  let title = 'Scene Asset Staging';

  if (text.includes('house') || text.includes('home') || text.includes('apartment') || text.includes('villa')) {
    roomType = 'house';
    title = 'Full House Asset Staging';
  } else if (text.includes('bedroom')) {
    roomType = 'bedroom';
    title = 'Bedroom Asset Staging';
  } else if (text.includes('living room') || text.includes('lounge')) {
    roomType = 'living_room';
    title = 'Living Room Asset Staging';
  } else if (text.includes('bathroom')) {
    roomType = 'bathroom';
    title = 'Bathroom Asset Staging';
  }

  // 1. Scan prompt for specifically requested keywords
  const requestedKnownKeywords: string[] = [];
  for (const kw of Object.keys(ASSET_KEYWORD_MAP)) {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    if (regex.test(text)) {
      requestedKnownKeywords.push(kw);
    }
  }

  // 2. Scan prompt for specifically requested MISSING items
  const requestedMissingKeywords: string[] = [];
  for (const kw of COMMONLY_MISSING_KEYWORDS) {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    if (regex.test(text)) {
      requestedMissingKeywords.push(kw);
    }
  }

  // Helper to add an available asset from catalog
  const addAvailableItem = (
    slot: string,
    assetId: string,
    suggestedLocation: [number, number, number]
  ) => {
    if (addedSlots.has(slot)) return;
    const asset = pool.find((a) => a.id === assetId || a.name.toLowerCase() === assetId.toLowerCase());
    if (!asset) return;

    addedSlots.add(slot);
    const alternatives = getAlternativesForCategory(asset.category, asset.id, 3, pool);

    items.push({
      id: Math.random().toString(36).substring(7),
      slot,
      name: asset.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      assetId: asset.id,
      category: asset.category,
      subcategory: asset.subcategory,
      dimensions: asset.dimensions_m,
      modelPath: asset.model_path,
      status: 'available',
      selected: true,
      alternatives,
      suggestedLocation,
    });
  };

  // Helper to add a missing item
  const addMissingItem = (name: string, suggestedLocation: [number, number, number]) => {
    if (addedSlots.has(name)) return;
    addedSlots.add(name);
    items.push({
      id: Math.random().toString(36).substring(7),
      slot: name,
      name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
      status: 'missing',
      selected: false, // unselected by default until user uploads or confirms
      note: `Can't find relevant assets in the local library for "${name}".`,
      suggestedLocation,
    });
  };

  // 3. Assemble scene layout according to room context & requested keywords
  if (roomType === 'living_room') {
    addAvailableItem('sofa', 'seating/sofa', [0, 1.2, 0]);
    addAvailableItem('coffee_table', 'table/coffee_table', [0, -0.2, 0]);
    addAvailableItem('carpet', 'rug/carpet_square', [0, 0.4, 0]);
    addAvailableItem('television', 'electronics/simple_wall_tv', [0, -2.5, 1.2]);
    addAvailableItem('floor_lamp', 'lighting/floor_lamp', [-1.4, 1.2, 0]);
    addAvailableItem('plant', 'decor/banana_plant', [1.4, 1.2, 0]);
  } else if (roomType === 'bedroom') {
    addAvailableItem('bed', 'bed/bed_frame_01', [0, 1.0, 0]);
    addAvailableItem('nightstand', 'table/modern_bedside_table', [-1.2, 1.0, 0]);
    addAvailableItem('wardrobe', 'storage/wardrobe', [2.0, -0.5, 0]);
    addAvailableItem('carpet', 'rug/carpet_square', [0, 0.5, 0]);
    addAvailableItem('ceiling_lamp', 'lighting/square_ceiling_lamp', [0, 0, 2.6]);
  } else if (roomType === 'house') {
    // Multi-zone house layout
    addAvailableItem('sofa', 'seating/sofa', [-2.0, 1.2, 0]);
    addAvailableItem('coffee_table', 'table/coffee_table', [-2.0, -0.2, 0]);
    addAvailableItem('carpet', 'rug/carpet_square', [-2.0, 0.4, 0]);
    addAvailableItem('television', 'electronics/simple_wall_tv', [-2.0, -2.4, 1.2]);
    addAvailableItem('floor_lamp', 'lighting/floor_lamp', [-3.2, 1.2, 0]);
    addAvailableItem('bed', 'bed/bed_frame_01', [2.5, 1.0, 0]);
    addAvailableItem('nightstand', 'table/modern_bedside_table', [1.2, 1.0, 0]);
    addAvailableItem('wardrobe', 'storage/wardrobe', [3.8, -0.5, 0]);
    addAvailableItem('plant', 'decor/banana_plant', [1.4, -1.5, 0]);
  }

  // 4. Add any extra specific known items the user explicitly asked for
  requestedKnownKeywords.forEach((kw) => {
    const mapping = ASSET_KEYWORD_MAP[kw];
    if (mapping) {
      const preferred = mapping.preferredId || typedCatalog.find((a) => a.category === mapping.category)?.id;
      if (preferred) {
        addAvailableItem(kw, preferred, [
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          0,
        ]);
      }
    }
  });

  // 5. Add all MISSING requested items
  requestedMissingKeywords.forEach((kw, idx) => {
    addMissingItem(kw, [0, -1.0 - idx * 0.8, 0]);
  });

  return {
    id: Math.random().toString(36).substring(7),
    title,
    roomType,
    items,
    isExecuted: false,
  };
}
