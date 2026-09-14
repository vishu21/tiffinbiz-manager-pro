'use client';

import React, { useCallback, useMemo, useState, useTransition } from 'react';
import {
  getRecipesWithIngredients,
  upsertRecipe,
  deleteRecipe,
  type RecipeCategory,
  type RecipeWithIngredients,
} from './actions';

// Local draft row for the Add/Edit drawer. Numeric fields are held as strings so
// the inputs stay controllable while the user types (e.g. "0.5", "1.30").
type IngredientDraft = {
  key: string;
  id?: string | null;
  name: string;
  raw8: string;
  raw12: string;
};

let draftSeq = 0;
const makeDraft = (ingredient?: {
  id?: string | null;
  name?: string;
  raw_oz_per_8oz?: number;
  raw_oz_per_12oz?: number;
}): IngredientDraft => ({
  key: `draft-${draftSeq++}`,
  id: ingredient?.id ?? null,
  name: ingredient?.name ?? '',
  raw8: ingredient?.raw_oz_per_8oz !== undefined ? String(ingredient.raw_oz_per_8oz) : '',
  raw12: ingredient?.raw_oz_per_12oz !== undefined ? String(ingredient.raw_oz_per_12oz) : '',
});

const TABS: { key: 'all' | RecipeCategory; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'dal', label: 'Dal' },
  { key: 'sabji', label: 'Sabji' },
  { key: 'chicken', label: 'Chicken' },
];

const CATEGORY_BADGE: Record<RecipeCategory, string> = {
  dal: 'bg-amber-50 text-amber-700 border-amber-200',
  sabji: 'bg-green-50 text-green-700 border-green-200',
  chicken: 'bg-red-50 text-red-700 border-red-200',
};

const CATEGORY_LABEL: Record<RecipeCategory, string> = {
  dal: 'Dal',
  sabji: 'Sabji',
  chicken: 'Chicken',
};

export default function RecipeManagerClient({
  initialRecipes,
}: {
  initialRecipes: RecipeWithIngredients[];
}) {
  const [recipes, setRecipes] = useState<RecipeWithIngredients[]>(initialRecipes);
  const [activeTab, setActiveTab] = useState<'all' | RecipeCategory>('all');

  // Add / Edit drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<RecipeCategory>('dal');
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([makeDraft()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await getRecipesWithIngredients();
    setRecipes(data);
  }, []);

  const counts = useMemo(
    () => ({
      all: recipes.length,
      dal: recipes.filter(r => r.category === 'dal').length,
      sabji: recipes.filter(r => r.category === 'sabji').length,
      chicken: recipes.filter(r => r.category === 'chicken').length,
    }),
    [recipes]
  );

  const visibleRecipes = useMemo(
    () => (activeTab === 'all' ? recipes : recipes.filter(r => r.category === activeTab)),
    [recipes, activeTab]
  );

  const openAdd = () => {
    setEditingId(null);
    setFormName('');
    setFormCategory(activeTab === 'all' ? 'dal' : activeTab);
    setIngredients([makeDraft()]);
    setFormError(null);
    setBanner(null);
    setIsDrawerOpen(true);
  };

  const openEdit = (recipe: RecipeWithIngredients) => {
    setEditingId(recipe.id);
    setFormName(recipe.name);
    setFormCategory(recipe.category);
    setIngredients(
      recipe.ingredients.length > 0
        ? recipe.ingredients.map(ing =>
            makeDraft({
              id: ing.id,
              name: ing.name,
              raw_oz_per_8oz: ing.raw_oz_per_8oz,
              raw_oz_per_12oz: ing.raw_oz_per_12oz,
            })
          )
        : [makeDraft()]
    );
    setFormError(null);
    setBanner(null);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (isSubmitting) return;
    setIsDrawerOpen(false);
  };

  const addIngredientRow = () => setIngredients(prev => [...prev, makeDraft()]);

  const updateIngredient = (key: string, patch: Partial<IngredientDraft>) =>
    setIngredients(prev => prev.map(row => (row.key === key ? { ...row, ...patch } : row)));

  // Never leave the form with zero rows — reset to a single blank row instead.
  const removeIngredient = (key: string) =>
    setIngredients(prev =>
      prev.length <= 1 ? [makeDraft()] : prev.filter(row => row.key !== key)
    );

  const handleSave = () => {
    setFormError(null);
    if (!formName.trim()) {
      setFormError('Dish name cannot be empty.');
      return;
    }

    startSubmit(async () => {
      try {
        const result = await upsertRecipe({
          id: editingId,
          name: formName,
          category: formCategory,
          ingredients: ingredients
            .filter(row => row.name.trim().length > 0)
            .map(row => ({
              id: row.id ?? null,
              name: row.name.trim(),
              raw_oz_per_8oz: Number(row.raw8) || 0,
              raw_oz_per_12oz: Number(row.raw12) || 0,
            })),
        });
        if (!result.success) {
          setFormError(result.message || 'Could not save the dish.');
          return;
        }
        await refresh();
        setIsDrawerOpen(false);
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Could not save the dish.');
      }
    });
  };

  const handleDelete = (recipe: RecipeWithIngredients) => {
    if (!window.confirm(`Delete "${recipe.name}"? Its ingredients will be removed too.`)) return;
    setBanner(null);
    setDeletingId(recipe.id);
    startSubmit(async () => {
      try {
        const result = await deleteRecipe(recipe.id);
        if (!result.success) {
          setBanner(result.message || 'Could not delete the dish.');
          return;
        }
        await refresh();
      } catch (err) {
        setBanner(err instanceof Error ? err.message : 'Could not delete the dish.');
      } finally {
        setDeletingId(null);
      }
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="text-[24px] font-bold text-[#11142D]">Recipe Management</h1>
            <p className="text-[13px] text-gray-500 mt-1">
              Manage dishes and their raw-ingredient scaling for the 8 oz (RG) and 12 oz (LG) containers.
            </p>
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="shrink-0 px-4 py-2 bg-[#5D5FEF] hover:bg-[#4D4FDF] text-white text-[12.5px] font-bold rounded-lg shadow-sm transition-colors"
          >
            + Add New Dish
          </button>
        </div>

        {banner && (
          <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[12.5px] font-semibold">
            ⚠️ {banner}
          </div>
        )}

        {/* Category tabs — All | Dal | Sabji | Chicken */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 rounded-lg text-[12px] font-bold border transition-all ${
                activeTab === tab.key
                  ? 'bg-[#5D5FEF] text-white border-[#5D5FEF] shadow-sm'
                  : 'bg-white text-[#7A7C87] border-[#E0E0E0] hover:border-[#5D5FEF] hover:text-[#5D5FEF]'
              }`}
            >
              {tab.label} ({counts[tab.key]})
            </button>
          ))}
        </div>

        {/* Recipe grid */}
        {visibleRecipes.length === 0 ? (
          <div className="bg-white border border-dashed border-[#E0E0E0] rounded-2xl py-16 text-center">
            <p className="text-4xl mb-3">🍲</p>
            <p className="text-[13px] font-semibold text-gray-500">
              No dishes yet{activeTab !== 'all' ? ` in ${CATEGORY_LABEL[activeTab]}` : ''}.
            </p>
            <p className="text-[12px] text-gray-400 mt-1">
              Use &ldquo;+ Add New Dish&rdquo; to create the first recipe.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleRecipes.map(recipe => (
              <div
                key={recipe.id}
                className="bg-white border border-[#EEEEEE] rounded-xl shadow-sm p-4 flex flex-col"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-bold text-[#11142D] truncate" title={recipe.name}>
                      {recipe.name}
                    </h3>
                    <span
                      className={`inline-block mt-1 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${CATEGORY_BADGE[recipe.category]}`}
                    >
                      {CATEGORY_LABEL[recipe.category]}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(recipe)}
                      className="px-2 py-1 text-[10.5px] font-bold text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(recipe)}
                      disabled={deletingId === recipe.id}
                      className="px-2 py-1 text-[10.5px] font-bold text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                    >
                      {deletingId === recipe.id ? '…' : '❌'}
                    </button>
                  </div>
                </div>

                {recipe.ingredients.length === 0 ? (
                  <p className="text-[11.5px] text-gray-400 italic">No ingredients yet.</p>
                ) : (
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="text-gray-400 uppercase text-[9.5px] tracking-wider">
                        <th className="text-left font-bold pb-1">Ingredient</th>
                        <th className="text-right font-bold pb-1">8 oz (RG)</th>
                        <th className="text-right font-bold pb-1">12 oz (LG)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipe.ingredients.map(ing => (
                        <tr key={ing.id} className="border-t border-gray-100">
                          <td className="py-1 font-semibold text-gray-700">{ing.name}</td>
                          <td className="py-1 text-right text-gray-600">{ing.raw_oz_per_8oz} oz</td>
                          <td className="py-1 text-right text-gray-600">{ing.raw_oz_per_12oz} oz</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Dish drawer */}
      {isDrawerOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30" onClick={closeDrawer} aria-hidden="true" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div
              className="bg-white rounded-xl shadow-2xl border border-[#EEEEEE] w-full max-w-[640px] max-h-[88vh] flex flex-col pointer-events-auto"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                <h2 className="text-[14px] font-bold text-[#11142D] uppercase tracking-wide">
                  {editingId ? '✏️ Edit Dish' : '+ Add New Dish'}
                </h2>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                >
                  &times;
                </button>
              </div>

              {/* Body */}
              <div className="px-5 py-4 overflow-y-auto space-y-4 flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px] gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10.5px] font-bold text-gray-500 uppercase tracking-wider">
                      Dish Name
                    </span>
                    <input
                      type="text"
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      placeholder="e.g. Rajma, Aloo Gobi"
                      className="text-[12.5px] px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10.5px] font-bold text-gray-500 uppercase tracking-wider">
                      Category
                    </span>
                    <select
                      value={formCategory}
                      onChange={e => setFormCategory(e.target.value as RecipeCategory)}
                      className="text-[12.5px] px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                    >
                      <option value="dal">Dal</option>
                      <option value="sabji">Sabji</option>
                      <option value="chicken">Chicken</option>
                    </select>
                  </label>
                </div>

                {/* Dynamic ingredient rows */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10.5px] font-bold text-gray-500 uppercase tracking-wider">
                      Ingredients
                    </span>
                    <span className="text-[10px] text-gray-400">
                      Raw oz → 8 oz (RG) &amp; 12 oz (LG)
                    </span>
                  </div>

                  <div className="space-y-2">
                    {ingredients.map((row, index) => (
                      <div key={row.key} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={row.name}
                          onChange={e => updateIngredient(row.key, { name: e.target.value })}
                          placeholder={`Ingredient ${index + 1} (e.g. Diced Onions)`}
                          className="flex-1 min-w-0 text-[12px] px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.raw8}
                          onChange={e => updateIngredient(row.key, { raw8: e.target.value })}
                          placeholder="8 oz"
                          title="Raw oz per 8 oz (RG) container"
                          className="w-[76px] shrink-0 text-[12px] px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.raw12}
                          onChange={e => updateIngredient(row.key, { raw12: e.target.value })}
                          placeholder="12 oz"
                          title="Raw oz per 12 oz (LG) container"
                          className="w-[76px] shrink-0 text-[12px] px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                        />
                        <button
                          type="button"
                          onClick={() => removeIngredient(row.key)}
                          title="Remove ingredient"
                          className="shrink-0 w-7 h-7 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={addIngredientRow}
                    className="mt-2 px-3 py-1.5 text-[11.5px] font-bold text-[#5D5FEF] bg-[#F4F4FE] hover:bg-[#EBEBFD] rounded-lg transition-colors"
                  >
                    + Add Another Ingredient
                  </button>
                </div>

                {formError && (
                  <p className="text-[11.5px] font-semibold text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                    {formError}
                  </p>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={closeDrawer}
                  disabled={isSubmitting}
                  className="px-4 py-2 border border-gray-200 text-gray-500 text-[12px] font-bold rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-[#5D5FEF] hover:bg-[#4D4FDF] text-white text-[12px] font-bold rounded-lg disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'Saving…' : editingId ? 'Update Dish' : 'Save Dish'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}



