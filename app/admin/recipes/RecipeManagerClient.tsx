'use client';

import React, { useCallback, useMemo, useState, useTransition } from 'react';
import { AlertTriangle, Soup, X, Trash2, Pencil, Copy, MoreVertical } from 'lucide-react';
import ActionButton from '@/app/components/ui/ActionButton';
import GlobalProgressBar from '@/app/components/ui/GlobalProgressBar';
import {
  getRecipesWithIngredients,
  upsertRecipe,
  deleteRecipe,
  duplicateRecipe,
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
  { key: 'sabji', label: 'Sabji' },
  { key: 'dal', label: 'Dal' },
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
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Add / Edit drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<RecipeCategory>('dal');
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([makeDraft()]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [recentlyDuplicatedId, setRecentlyDuplicatedId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const handleDuplicate = (recipe: RecipeWithIngredients) => {
    setBanner(null);
    setSuccessBanner(null);
    setDuplicatingId(recipe.id);
    startSubmit(async () => {
      try {
        const result = await duplicateRecipe(recipe.id);
        if (!result.success || !result.newRecipeId) {
          setBanner(result.message || 'Could not duplicate recipe.');
          return;
        }
        await refresh();

        // Target new recipe for visual feedback
        const createdId = result.newRecipeId;
        setRecentlyDuplicatedId(createdId);
        setSuccessBanner(`Created "${recipe.name} - Copy"`);

        // Smooth scroll to the newly duplicated recipe card
        setTimeout(() => {
          const el = document.getElementById(`recipe-card-${createdId}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 150);

        // Remove glow effect after 4.5 seconds
        setTimeout(() => {
          setRecentlyDuplicatedId(null);
        }, 4500);
      } catch (err) {
        setBanner(err instanceof Error ? err.message : 'Could not duplicate recipe.');
      } finally {
        setDuplicatingId(null);
      }
    });
  };

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

  const visibleRecipes = useMemo(() => {
    let filtered = activeTab === 'all' ? recipes : recipes.filter(r => r.category === activeTab);

    if (searchQuery.trim()) {
      const lowerCaseQuery = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(
        recipe =>
          recipe.name.toLowerCase().includes(lowerCaseQuery) ||
          recipe.category.toLowerCase().includes(lowerCaseQuery) ||
          (CATEGORY_LABEL[recipe.category] && CATEGORY_LABEL[recipe.category].toLowerCase().includes(lowerCaseQuery)) ||
          recipe.ingredients.some(ingredient =>
            ingredient.name.toLowerCase().includes(lowerCaseQuery)
          )
      );
    }

    // Category priority order: Dal -> Sabji -> Chicken
    const categoryRank: Record<string, number> = {
      dal: 1,
      sabji: 2,
      chicken: 3,
    };

    return [...filtered].sort((a, b) => {
      const rankA = categoryRank[a.category] ?? 99;
      const rankB = categoryRank[b.category] ?? 99;

      // Primary sort: Dal first, then Sabji, etc.
      if (rankA !== rankB) {
        return rankA - rankB;
      }

      // Secondary sort: Alphabetical A-Z within the same category
      return a.name.localeCompare(b.name);
    });
  }, [recipes, activeTab, searchQuery]);

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

  // Drag and drop reordering handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    setIngredients(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(draggedIndex, 1);
      updated.splice(index, 0, moved);
      return updated;
    });
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

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
            .map((row, index) => ({
              id: row.id ?? null,
              name: row.name.trim(),
              raw_oz_per_8oz: Number(row.raw8) || 0,
              raw_oz_per_12oz: Number(row.raw12) || 0,
              sort_order: index,
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

  // Compute live drawer sums
  const { drawerTotal8, drawerTotalPct } = useMemo(() => {
    const total8 = ingredients.reduce((sum, row) => sum + (parseFloat(row.raw8) || 0), 0);
    const totalPct = ingredients.reduce((sum, row) => {
      const val8 = parseFloat(row.raw8) || 0;
      return sum + (val8 / 8.0) * 100;
    }, 0);
    return { drawerTotal8: total8, drawerTotalPct: totalPct };
  }, [ingredients]);

  // Handler to update an ingredient by % without modifying any other rows
  const handlePercentChange = (key: string, newPctStr: string) => {
    const pct = parseFloat(newPctStr);
    if (isNaN(pct)) {
      updateIngredient(key, { raw8: '', raw12: '' });
      return;
    }
    // Calculate row ounces directly against standard container size (8.0 oz RG, 12.0 oz LG)
    const calculated8 = ((pct / 100) * 8.0);
    const calculated12 = (calculated8 * 1.5);

    // Round cleanly to 2 decimal places (strip trailing zeros if whole/clean)
    const r8 = Math.round(calculated8 * 100) / 100;
    const r12 = Math.round(calculated12 * 100) / 100;

    updateIngredient(key, {
      raw8: String(r8),
      raw12: String(r12),
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <GlobalProgressBar />
      <div className="max-w-[1400px] mx-auto">
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
            <AlertTriangle className="w-4 h-4 text-amber-500" /> {banner}
          </div>
        )}

        {successBanner && (
          <div className="mb-4 px-4 py-2.5 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-800 text-xs font-bold flex items-center justify-between shadow-xs">
            <span>✨ {successBanner} — highlighted below</span>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              className="text-emerald-700 hover:text-emerald-950 font-bold px-1 text-sm"
            >
              &times;
            </button>
          </div>
        )}

        {/* Category tabs & Instant Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {TABS.map(tab => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${active
                    ? 'text-[#5D5FEF] bg-[#F4F4FE] border-[#5D5FEF]/30 shadow-xs'
                    : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                >
                  {tab.label} ({counts[tab.key]})
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Search recipes, ingredients, or category..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg pl-8 pr-7 outline-none focus:border-[#5D5FEF] shadow-xs text-gray-700 placeholder-gray-400"
            />
            <svg
              className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Recipe grid */}
        {visibleRecipes.length === 0 ? (
          <div className="bg-white border border-dashed border-[#E0E0E0] rounded-2xl py-16 text-center">
            <Soup className="w-8 h-8 mx-auto text-gray-400 mb-3" />
            <p className="text-[13px] font-semibold text-gray-500">
              No dishes found{searchQuery ? ` matching "${searchQuery}"` : activeTab !== 'all' ? ` in ${CATEGORY_LABEL[activeTab]}` : ''}.
            </p>
            <p className="text-[12px] text-gray-400 mt-1">
              Use &ldquo;+ Add New Dish&rdquo; to create a recipe or clear your filters.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {visibleRecipes.map(recipe => {
              const totalRgOz = recipe.ingredients.reduce((sum, ing) => sum + (ing.raw_oz_per_8oz || 0), 0);
              const totalLgOz = recipe.ingredients.reduce((sum, ing) => sum + (ing.raw_oz_per_12oz || 0), 0);

              const isJustCreated = recentlyDuplicatedId === recipe.id;

              return (
                <div
                  id={`recipe-card-${recipe.id}`}
                  key={recipe.id}
                  className={`relative flex flex-col justify-between p-3.5 rounded-xl transition-all duration-500 ${isJustCreated
                    ? 'bg-indigo-50/50 border-2 border-indigo-500 shadow-md ring-4 ring-indigo-200 scale-[1.01]'
                    : 'bg-white border border-gray-200 shadow-xs'
                    }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-[14px] font-bold text-[#11142D] truncate" title={recipe.name}>
                            {recipe.name}
                          </h3>
                          {isJustCreated && (
                            <span className="px-1.5 py-0.2 bg-indigo-600 text-white text-[9px] font-black uppercase rounded tracking-wider animate-pulse shrink-0">
                              New Copy
                            </span>
                          )}
                        </div>
                        <span
                          className={`inline-block mt-1 px-1.5 py-0.5 rounded border text-[9.5px] font-bold uppercase tracking-wider ${CATEGORY_BADGE[recipe.category]}`}
                        >
                          {CATEGORY_LABEL[recipe.category]}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 relative">
                        {/* 1-Click Primary Edit Button */}
                        <button
                          type="button"
                          onClick={() => openEdit(recipe)}
                          title="Edit dish"
                          className="w-7 h-7 flex items-center justify-center text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        {/* 3-Dots Action Menu */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setActiveMenuId(activeMenuId === recipe.id ? null : recipe.id);
                            }}
                            title="More actions"
                            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>

                          {activeMenuId === recipe.id && (
                            <>
                              {/* Invisible backdrop to dismiss menu on click-away */}
                              <div
                                className="fixed inset-0 z-20 cursor-default"
                                onClick={() => setActiveMenuId(null)}
                              />

                              <div className="absolute right-0 top-8 z-30 w-36 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-xs font-semibold">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    handleDuplicate(recipe);
                                  }}
                                  disabled={duplicatingId === recipe.id || isSubmitting}
                                  className="w-full px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-50 text-left"
                                >
                                  <Copy className="w-3.5 h-3.5 text-indigo-500" />
                                  Duplicate
                                </button>

                                <div className="border-t border-gray-100 my-1" />

                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    handleDelete(recipe);
                                  }}
                                  disabled={deletingId === recipe.id || isSubmitting}
                                  className="w-full px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 text-left"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                  Delete
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {recipe.ingredients.length === 0 ? (
                      <p className="text-[11.5px] text-gray-400 italic py-2">No ingredients configured.</p>
                    ) : (
                      <table className="w-full text-[11.5px]">
                        <thead>
                          <tr className="text-gray-400 uppercase text-[9px] tracking-wider border-b border-gray-100">
                            <th className="text-left font-bold pb-1">Ingredient</th>
                            <th className="text-right font-bold pb-1">8 oz (RG)</th>
                            <th className="text-right font-bold pb-1">12 oz (LG)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {recipe.ingredients.map(ing => (
                            <tr key={ing.id}>
                              <td className="py-1 text-xs font-medium text-gray-700 truncate max-w-[120px]" title={ing.name}>
                                {ing.name}
                              </td>
                              <td className="py-1 text-xs text-right font-mono text-gray-600">
                                {ing.raw_oz_per_8oz} oz
                              </td>
                              <td className="py-1 text-xs text-right font-mono text-gray-600">
                                {ing.raw_oz_per_12oz} oz
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-gray-200">
                            <td className="pt-1.5 text-[10px] font-bold uppercase text-gray-500">
                              Total Base
                            </td>
                            <td
                              className={`pt-1.5 text-xs text-right font-mono font-bold ${totalRgOz.toFixed(1) === '8.0' ? 'text-gray-400' : 'text-gray-800'
                                }`}
                            >
                              {totalRgOz.toFixed(1)} oz
                            </td>
                            <td
                              className={`pt-1.5 text-xs text-right font-mono font-bold ${totalLgOz.toFixed(1) === '12.0' ? 'text-gray-400' : 'text-gray-800'
                                }`}
                            >
                              {totalLgOz.toFixed(1)} oz
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Dish drawer */}
      {isDrawerOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30" onClick={closeDrawer} aria-hidden="true" />
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pointer-events-none">
            <div
              className={`bg-white shadow-2xl border border-[#EEEEEE] w-full flex flex-col pointer-events-auto
                rounded-t-2xl h-[92vh] sm:h-auto sm:max-h-[88vh] sm:rounded-xl sm:max-w-[640px]
                transform transition-transform duration-300 ease-out
                ${isDrawerOpen ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-x-full'}`}
              onClick={e => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                <h2 className="text-[14px] font-bold text-[#11142D] uppercase tracking-wide">
                  {editingId ? <span className="flex items-center gap-1.5"><Pencil className="w-4 h-4" /> Edit Dish</span> : '+ Add New Dish'}
                </h2>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                >
                  &times;
                </button>
              </div>

              {/* Drawer Body */}
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

                {/* Dynamic Draggable Ingredient Rows */}
                <div>
                  {/* Single Table-Like Header */}
                  <div className="flex items-center justify-between px-2 pb-1.5 border-b border-gray-100 text-[10.5px] font-bold uppercase tracking-wider text-gray-500">
                    <span>Ingredients (Drag ⠿ to rearrange)</span>
                    <div className="flex items-center gap-2">
                      <span className="w-[58px] text-center text-gray-500">%</span>
                      <span className="w-[76px] text-center text-amber-700">8 oz (RG)</span>
                      <span className="w-[76px] text-center text-purple-700">12 oz (LG)</span>
                    </div>
                  </div>

                  <div className="space-y-1.5 mt-2">
                    {ingredients.map((row, index) => (
                      <div
                        key={row.key}
                        draggable
                        onDragStart={e => handleDragStart(e, index)}
                        onDragOver={e => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-2 p-1.5 rounded-lg border transition-all ${draggedIndex === index
                          ? 'opacity-40 bg-gray-100 border-dashed border-[#5D5FEF]'
                          : 'bg-white border-transparent hover:border-gray-200'
                          }`}
                      >
                        {/* Drag Handle */}
                        <span
                          title="Drag to rearrange"
                          className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-700 px-1 select-none text-base font-bold shrink-0"
                        >
                          ⠿
                        </span>

                        {/* Ingredient Name */}
                        <input
                          type="text"
                          value={row.name}
                          onChange={e => updateIngredient(row.key, { name: e.target.value })}
                          placeholder={`Ingredient ${index + 1} (e.g. Diced Onions)`}
                          className="flex-1 min-w-0 text-[12px] px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                        />

                        {/* Delete Row Button */}
                        <button
                          type="button"
                          onClick={() => removeIngredient(row.key)}
                          title="Remove ingredient"
                          className="shrink-0 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        >
                          <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-500" />
                        </button>

                        {/* Editable Percentage Input */}
                        <div className="relative w-[58px] shrink-0">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={
                              row.raw8 !== '' && !isNaN(parseFloat(row.raw8))
                                ? Math.round(((parseFloat(row.raw8) / 8.0) * 100) * 10) / 10
                                : ''
                            }
                            onChange={e => handlePercentChange(row.key, e.target.value)}
                            placeholder="0.0"
                            title="Percentage of standard 8 oz portion (adjusts oz for this row only)"
                            className="w-full text-center font-semibold text-[12px] py-2 pl-1 pr-3.5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                          />
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 font-bold pointer-events-none">
                            %
                          </span>
                        </div>

                        {/* 8 oz (RG) numeric input */}
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.raw8}
                          onChange={e => updateIngredient(row.key, { raw8: e.target.value })}
                          placeholder="0.00"
                          title="Raw oz per 8 oz (RG) container"
                          className="w-[76px] shrink-0 text-center font-semibold text-[12px] px-2 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                        />

                        {/* 12 oz (LG) numeric input */}
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.raw12}
                          onChange={e => updateIngredient(row.key, { raw12: e.target.value })}
                          placeholder="0.00"
                          title="Raw oz per 12 oz (LG) container"
                          className="w-[76px] shrink-0 text-center font-semibold text-[12px] px-2 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Real-time batch total & 100% check */}
                  <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] font-mono">
                    <button
                      type="button"
                      onClick={addIngredientRow}
                      className="px-3 py-1.5 text-[11.5px] font-sans font-bold text-[#5D5FEF] bg-[#F4F4FE] hover:bg-[#EBEBFD] rounded-lg transition-colors"
                    >
                      + Add Another Ingredient
                    </button>

                    <div className="flex items-center gap-2 font-bold">
                      <span className="text-gray-400 uppercase text-[9.5px]">Total:</span>
                      <span
                        className={`w-[58px] text-center ${Math.abs(drawerTotalPct - 100.0) < 0.5 ? 'text-emerald-600' : 'text-amber-600 font-extrabold'
                          }`}
                        title="Target: 100%"
                      >
                        {drawerTotalPct.toFixed(1)}%
                      </span>
                      <span
                        className={`w-[76px] text-center ${Math.abs(drawerTotal8 - 8.0) < 0.05 ? 'text-emerald-600' : 'text-amber-600'
                          }`}
                        title="Standard target is 8.0 oz"
                      >
                        {drawerTotal8.toFixed(2)} oz
                      </span>
                      <span className="w-[76px] text-center text-gray-500">
                        {(drawerTotal8 * 1.5).toFixed(2)} oz
                      </span>
                    </div>
                  </div>
                </div>

                {formError && (
                  <p className="text-[11.5px] font-semibold text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                    {formError}
                  </p>
                )}
              </div>

              {/* Drawer Footer */}
              <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={closeDrawer}
                  disabled={isSubmitting}
                  className="px-4 py-2 border border-gray-200 text-gray-500 text-[12px] font-bold rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <ActionButton
                  type="button"
                  onClick={handleSave}
                  loading={isSubmitting}
                  loadingText="Saving…"
                  className="px-4 py-2 bg-[#5D5FEF] hover:bg-[#4D4FDF] text-white text-[12px] font-bold rounded-lg shadow-sm"
                >
                  {editingId ? 'Update Dish' : 'Save Dish'}
                </ActionButton>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}