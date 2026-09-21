import { getRecipesWithIngredients } from './actions';
import RecipeManagerClient from './RecipeManagerClient';

export const dynamic = 'force-dynamic'; // Always read the live recipe catalog

export default async function RecipesPage() {
  const recipes = await getRecipesWithIngredients();

  return <RecipeManagerClient initialRecipes={recipes} />;
}