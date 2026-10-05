// app/utils/prepEngine.ts

export type CustomerPrepRecord = {
  id: string;
  full_name: string;
  meal_type: string; // 'Veg' | 'Non-veg'
  portion_size: string; // 'RG' | 'LG' | 'Half RG' | 'Half LG'
  delivery_schedule?: string | null;
  subscription_status?: string | null;
  is_pickup?: boolean | null;
  disliked_dishes?: string[] | null; // e.g. ['Aloo Baingan', 'Brown Dal']
  curry_config?: string | null;
};

export type IngredientItem = {
  name: string;
  base_oz: number; // weight in base batch
};

export type RecipeDefinition = {
  id: string;
  name: string; // e.g. "Aloo Baingan", "Black Channa"
  yield_oz: number; // e.g. 100 oz base recipe
  ingredients: IngredientItem[];
};

export type CustomerManifestRow = {
  customerId: string;
  customerName: string;
  portion: string;
  dalContainers: number;
  sabjiContainers: number;
  chickenContainers: number;
  containerSizeOz: number; // 8 or 12
  dalOz: number;
  sabjiOz: number;
  packingNote?: string;
};

export type PrepCalculationResult = {
  // Container tallies for display badges
  dal: {
    rgCount: number;
    lgCount: number;
    totalContainers: number;
    targetPotOz: number;
    scaledIngredients: { name: string; oz: number }[];
  };
  sabji: {
    rgCount: number;
    lgCount: number;
    totalContainers: number;
    targetPotOz: number;
    scaledIngredients: { name: string; oz: number }[];
  };
  manifest: CustomerManifestRow[];
};

/**
 * Calculates exact container tallies, pot target volumes, and scaled ingredients
 * taking into account customer dish dislikes and dynamic substitutions.
 */
export function calculateDailyPrep({
  customers,
  todayDal,
  todaySabji,
  isVegOnlyDay,
}: {
  customers: CustomerPrepRecord[];
  todayDal: RecipeDefinition | null;
  todaySabji: RecipeDefinition | null;
  isVegOnlyDay: boolean;
}): PrepCalculationResult {
  // 1. Initialize accumulator state
  let dalRg = 0;
  let dalLg = 0;
  let sabjiRg = 0;
  let sabjiLg = 0;

  const manifest: CustomerManifestRow[] = [];

  // 2. Loop through every customer active for the target day
  for (const customer of customers) {
    const isLg = customer.portion_size?.toUpperCase().includes('LG') ?? false;
    const isHalf = customer.portion_size?.toUpperCase().includes('HALF') ?? false;
    const containerOz = isLg ? 12 : 8; // LG containers are 12 oz, RG are 8 oz

    const dislikesDal = Boolean(
      todayDal && customer.disliked_dishes?.some(
        d => d.toLowerCase() === todayDal.name.toLowerCase()
      )
    );

    const dislikesSabji = Boolean(
      todaySabji && customer.disliked_dishes?.some(
        d => d.toLowerCase() === todaySabji.name.toLowerCase()
      )
    );

    // Standard baseline allotment: Full plan gets 1 Dal + 1 Sabji; Half gets 1 container
    let customerDal = isHalf ? 1 : 1;
    let customerSabji = isHalf ? 0 : 1;
    let note = '';

    // 3. Resolve exclusions & substitutions
    if (dislikesSabji && !dislikesDal) {
      // Customer dislikes today's sabji -> Double Dal
      customerDal += customerSabji;
      customerSabji = 0;
      note = `⚡ Dislikes ${todaySabji?.name} → 2x Dal`;
    } else if (dislikesDal && !dislikesSabji) {
      // Customer dislikes today's dal -> Double Sabji
      customerSabji += customerDal;
      customerDal = 0;
      note = `⚡ Dislikes ${todayDal?.name} → 2x Sabji`;
    } else if (dislikesDal && dislikesSabji) {
      // Edge case: customer dislikes both recipes of the day
      note = `⚠️ Dislikes both ${todayDal?.name} & ${todaySabji?.name} — Kitchen override required`;
    }

    // 4. Update container size tallies
    if (isLg) {
      dalLg += customerDal;
      sabjiLg += customerSabji;
    } else {
      dalRg += customerDal;
      sabjiRg += customerSabji;
    }

    manifest.push({
      customerId: customer.id,
      customerName: customer.full_name,
      portion: customer.portion_size,
      dalContainers: customerDal,
      sabjiContainers: customerSabji,
      chickenContainers: 0,
      containerSizeOz: containerOz,
      dalOz: customerDal * containerOz,
      sabjiOz: customerSabji * containerOz,
      packingNote: note || undefined,
    });
  }

  // 5. Calculate total pot ounce targets
  const targetDalOz = (dalRg * 8) + (dalLg * 12);
  const targetSabjiOz = (sabjiRg * 8) + (sabjiLg * 12);

  // 6. Proportional ingredient scaling based on pot volume
  const scaleIngredients = (recipe: RecipeDefinition | null, targetOz: number) => {
    if (!recipe || recipe.yield_oz <= 0 || targetOz <= 0) return [];
    const ratio = targetOz / recipe.yield_oz;
    return recipe.ingredients.map(item => ({
      name: item.name,
      oz: Math.round(item.base_oz * ratio * 10) / 10, // rounded to 1 decimal place
    }));
  };

  return {
    dal: {
      rgCount: dalRg,
      lgCount: dalLg,
      totalContainers: dalRg + dalLg,
      targetPotOz: targetDalOz,
      scaledIngredients: scaleIngredients(todayDal, targetDalOz),
    },
    sabji: {
      rgCount: sabjiRg,
      lgCount: sabjiLg,
      totalContainers: sabjiRg + sabjiLg,
      targetPotOz: targetSabjiOz,
      scaledIngredients: scaleIngredients(todaySabji, targetSabjiOz),
    },
    manifest,
  };
}