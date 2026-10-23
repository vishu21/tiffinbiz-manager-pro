import { getRecipesWithIngredients, getRecipeCategories } from './actions';
import RecipeManagerClient from './RecipeManagerClient';

export const dynamic = 'force-dynamic'; // Always read the live recipe catalog

export default async function RecipesPage() {
  const [recipes, categories] = await Promise.all([
    getRecipesWithIngredients(),
    getRecipeCategories(),
  ]);

  return (
    <RecipeManagerClient
      initialRecipes={recipes}
      initialCategories={categories}
    />
  );
}