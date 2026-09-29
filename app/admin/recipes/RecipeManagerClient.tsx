'use client';

import React, { useCallback, useMemo, useState, useTransition } from 'react';
import { AlertTriangle, Soup, X, Trash2, Pencil, Copy, MoreVertical, Power, PowerOff } from 'lucide-react';
import ActionButton from '@/app/components/ui/ActionButton';
import GlobalProgressBar from '@/app/components/ui/GlobalProgressBar';
import {
  getRecipesWithIngredients,
  upsertRecipe,
  deleteRecipe,
  duplicateRecipe,
  toggleRecipeActive,
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
  const [globalScaleOz, setGlobalScaleOz] = useState<number>(0); // 0 = Standard (8/12 oz base)
  const [showInactive, setShowInactive] = useState<boolean>(false);

  // Add / Edit drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<RecipeCategory>('dal');
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([makeDraft()]);
  const [batchPreviewOz, setBatchPreviewOz] = useState<string>('200');
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

    if (!showInactive) {
      filtered = filtered.filter(r => r.is_active !== false);
    }

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

        {/* Category tabs, Global Pot Scaler & Instant Search Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-6 bg-white p-3 rounded-2xl border border-gray-200/80 shadow-2xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            {TABS.map(tab => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3.5 py-1.5 text-xs font-bold rounded-xl border transition-all cursor-pointer ${active
                    ? 'text-[#5D5FEF] bg-[#F4F4FE] border-[#5D5FEF]/40 shadow-2xs'
                    : 'text-gray-600 bg-gray-50/50 border-gray-200/80 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                >
                  {tab.label} ({counts[tab.key]})
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Inactive Dishes Visibility Toggle */}
            <button
              type="button"
              onClick={() => setShowInactive(prev => !prev)}
              className={`px-2.5 py-1 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                showInactive
                  ? 'bg-amber-100 text-amber-900 border-amber-300 shadow-2xs font-black'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:text-gray-800 font-semibold'
              }`}
            >
              {showInactive ? 'Showing Inactive' : 'Show Inactive'}
            </button>

            {/* Global Pot Scaler Switcher */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200 text-xs font-bold">
              <span className="text-[10.5px] uppercase text-gray-400 px-2 tracking-wider">Pot Scale:</span>
              {[
                { label: 'Portions (8/12 oz)', oz: 0 },
                { label: '100 oz', oz: 100 },
                { label: '150 oz', oz: 150 },
                { label: '200 oz', oz: 200 },
              ].map(opt => (
                <button
                  key={opt.oz}
                  type="button"
                  onClick={() => setGlobalScaleOz(opt.oz)}
                  className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                    globalScaleOz === opt.oz
                      ? 'bg-white text-[#5D5FEF] shadow-xs font-black'
                      : 'text-gray-500 hover:text-gray-800 font-semibold'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                placeholder="Search dish or ingredient..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-gray-50/60 border border-gray-200 rounded-xl pl-8 pr-7 outline-none focus:bg-white focus:border-[#5D5FEF] shadow-2xs text-gray-800 placeholder-gray-400 font-medium"
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
        </div>

        {/* Recipe Catalog Display with Category Dividers */}
        {visibleRecipes.length === 0 ? (
          <div className="bg-white border border-dashed border-[#E0E0E0] rounded-2xl py-16 text-center shadow-2xs">
            <Soup className="w-8 h-8 mx-auto text-gray-400 mb-3" />
            <p className="text-[13px] font-bold text-gray-600">
              No dishes found{searchQuery ? ` matching "${searchQuery}"` : activeTab !== 'all' ? ` in ${CATEGORY_LABEL[activeTab]}` : ''}.
            </p>
            <p className="text-[12px] text-gray-400 mt-1 font-medium">
              Use &ldquo;+ Add New Dish&rdquo; to create a recipe or adjust your search filter.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {(activeTab === 'all' ? (['dal', 'sabji', 'chicken'] as RecipeCategory[]) : [activeTab]).map(categoryKey => {
              const groupRecipes = visibleRecipes.filter(r => r.category === categoryKey);
              if (groupRecipes.length === 0) return null;

              const categoryTheme = 
                categoryKey === 'dal' ? { title: 'Dal Specials', bar: 'bg-amber-500', countBg: 'bg-amber-100 text-amber-800' } :
                categoryKey === 'sabji' ? { title: 'Sabji Preparations', bar: 'bg-emerald-500', countBg: 'bg-emerald-100 text-emerald-800' } :
                { title: 'Non-Veg / Chicken', bar: 'bg-rose-500', countBg: 'bg-rose-100 text-rose-800' };

              return (
                <section key={categoryKey} className="space-y-3.5">
                  {/* Category Visual Tier Header */}
                  <div className="flex items-center gap-2.5 pb-1">
                    <span className={`w-2 h-5 rounded-full ${categoryTheme.bar}`} />
                    <h2 className="text-base font-black text-[#11142D] tracking-tight">{categoryTheme.title}</h2>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${categoryTheme.countBg}`}>
                      {groupRecipes.length}
                    </span>
                    {globalScaleOz > 0 && (
                      <span className="text-[11px] font-bold text-[#5D5FEF] bg-[#F4F4FE] border border-[#5D5FEF]/20 px-2.5 py-0.5 rounded-lg ml-auto">
                        Scaled for {globalScaleOz} oz Pot Target
                      </span>
                    )}
                  </div>

                  {/* Normalized 4-Column Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch">
                    {groupRecipes.map(recipe => {
                      const totalRgOz = recipe.ingredients.reduce((sum, ing) => sum + (ing.raw_oz_per_8oz || 0), 0);
                      const totalLgOz = recipe.ingredients.reduce((sum, ing) => sum + (ing.raw_oz_per_12oz || 0), 0);
                      const isJustCreated = recentlyDuplicatedId === recipe.id;
                      const isInactive = recipe.is_active === false;

                      // Identify star/core ingredient (skip base aromatics & liquids)
                      const nonBaseIngredients = recipe.ingredients.filter(i => {
                        const n = i.name.toLowerCase();
                        return (
                          !n.includes('water') &&
                          !n.includes('onion') &&
                          !n.includes('tomato') &&
                          !n.includes('oil') &&
                          !n.includes('salt')
                        );
                      });

                      const starCandidatePool = nonBaseIngredients.length > 0 ? nonBaseIngredients : recipe.ingredients;
                      const starIngredient = starCandidatePool.reduce((prev, curr) => 
                        ((curr.raw_oz_per_8oz || 0) > (prev?.raw_oz_per_8oz || 0) ? curr : prev), 
                        starCandidatePool[0]
                      );

                      return (
                        <div
                          id={`recipe-card-${recipe.id}`}
                          key={recipe.id}
                          className={`relative flex flex-col justify-between min-h-[260px] p-4 rounded-2xl transition-all duration-300 ${
                            isJustCreated
                              ? 'bg-indigo-50/50 border-2 border-indigo-500 shadow-md ring-4 ring-indigo-200 scale-[1.01]'
                              : isInactive
                              ? 'bg-gray-50/80 border border-dashed border-gray-300 opacity-60'
                              : 'bg-white border border-gray-200/90 hover:border-gray-300 hover:shadow-md shadow-2xs'
                          }`}
                        >
                          <div>
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <div className="min-w-0 flex-1">
                                <h3 className="text-[15px] font-black text-[#11142D] truncate" title={recipe.name}>
                                  {recipe.name}
                                </h3>

                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  <span className={`px-2 py-0.5 rounded-md border text-[9.5px] font-black uppercase tracking-wider ${CATEGORY_BADGE[recipe.category]}`}>
                                    {CATEGORY_LABEL[recipe.category]}
                                  </span>

                                  {isInactive && (
                                    <span className="px-1.5 py-0.5 bg-gray-200 text-gray-700 text-[9px] font-black uppercase rounded tracking-wider">
                                      Inactive
                                    </span>
                                  )}

                                  {starIngredient && (
                                    <span className="text-[10px] font-bold text-gray-600 bg-gray-50 border border-gray-200/80 px-1.5 py-0.5 rounded-md truncate max-w-[150px]">
                                      ★ {starIngredient.name}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Card Action Controls */}
                              <div className="flex items-center gap-1 shrink-0 relative">
                                <button
                                  type="button"
                                  onClick={() => openEdit(recipe)}
                                  title="Edit dish recipe"
                                  className="w-7 h-7 flex items-center justify-center text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setActiveMenuId(activeMenuId === recipe.id ? null : recipe.id);
                                  }}
                                  title="More actions"
                                  className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>

                                {activeMenuId === recipe.id && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-20 cursor-default"
                                      onClick={() => setActiveMenuId(null)}
                                    />
                                    <div className="absolute right-0 top-8 z-30 w-36 bg-white border border-gray-200 rounded-xl shadow-xl py-1.5 text-xs font-semibold animate-in fade-in zoom-in-95 duration-100">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveMenuId(null);
                                          handleDuplicate(recipe);
                                        }}
                                        disabled={duplicatingId === recipe.id || isSubmitting}
                                        className="w-full px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-50 text-left cursor-pointer"
                                      >
                                        <Copy className="w-3.5 h-3.5 text-indigo-500" />
                                        Duplicate
                                      </button>

                                      {/* Deactivate / Reactivate Toggle */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveMenuId(null);
                                          startSubmit(async () => {
                                            await toggleRecipeActive(recipe.id, recipe.is_active !== false);
                                            await refresh();
                                          });
                                        }}
                                        disabled={isSubmitting}
                                        className="w-full px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-amber-50 hover:text-amber-800 transition-colors disabled:opacity-50 text-left cursor-pointer"
                                      >
                                        {recipe.is_active !== false ? (
                                          <>
                                            <PowerOff className="w-3.5 h-3.5 text-amber-500" />
                                            <span>Deactivate</span>
                                          </>
                                        ) : (
                                          <>
                                            <Power className="w-3.5 h-3.5 text-emerald-600" />
                                            <span>Reactivate</span>
                                          </>
                                        )}
                                      </button>

                                      <div className="border-t border-gray-100 my-1" />

                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveMenuId(null);
                                          handleDelete(recipe);
                                        }}
                                        disabled={deletingId === recipe.id || isSubmitting}
                                        className="w-full px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 text-left cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                        Delete
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Ingredient Table with Adaptive Scaled View */}
                            {recipe.ingredients.length === 0 ? (
                              <p className="text-[11.5px] text-gray-400 italic py-4 text-center">No ingredients configured.</p>
                            ) : (
                              <table className="w-full text-[11.5px]">
                                <thead>
                                  <tr className="text-gray-400 uppercase text-[9px] tracking-wider border-b border-gray-100 font-bold">
                                    <th className="text-left pb-1.5">Ingredient</th>
                                    {globalScaleOz > 0 ? (
                                      <>
                                        <th className="text-right pb-1.5 text-indigo-600 font-black">Scaled Batch</th>
                                        <th className="text-right pb-1.5 text-gray-400 font-medium">Lbs / G</th>
                                      </>
                                    ) : (
                                      <>
                                        <th className="text-right pb-1.5 text-amber-700 font-extrabold">8 oz (RG)</th>
                                        <th className="text-right pb-1.5 text-purple-700 font-extrabold">12 oz (LG)</th>
                                      </>
                                    )}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50/80">
                                  {recipe.ingredients.map(ing => {
                                    const isStar = starIngredient?.id === ing.id;
                                    const baseVal = ing.raw_oz_per_8oz || 0;
                                    const scaledVal = globalScaleOz > 0 ? (baseVal / 8.0) * globalScaleOz : 0;

                                    return (
                                      <tr key={ing.id} className={isStar ? 'bg-amber-50/40 font-bold' : ''}>
                                        <td className="py-1.5 text-xs text-gray-800 truncate max-w-[130px]" title={ing.name}>
                                          {isStar && <span className="text-amber-500 mr-1 text-[10px]">●</span>}
                                          {ing.name}
                                        </td>

                                        {globalScaleOz > 0 ? (
                                          <>
                                            <td className="py-1.5 text-xs text-right font-mono font-black text-indigo-950">
                                              {scaledVal.toFixed(1)} oz
                                            </td>
                                            <td className="py-1.5 text-[10.5px] text-right font-mono text-gray-500">
                                              {scaledVal >= 16 ? `${(scaledVal / 16).toFixed(2)} lbs` : `${Math.round(scaledVal * 28.35)} g`}
                                            </td>
                                          </>
                                        ) : (
                                          <>
                                            <td className="py-1.5 text-xs text-right font-mono font-semibold text-gray-700">
                                              {ing.raw_oz_per_8oz} oz
                                            </td>
                                            <td className="py-1.5 text-xs text-right font-mono font-semibold text-gray-700">
                                              {ing.raw_oz_per_12oz} oz
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>

                          {/* Footer Total Base */}
                          {recipe.ingredients.length > 0 && (
                            <div className="pt-2 mt-2 border-t border-gray-100 flex items-center justify-between text-xs font-mono">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                {globalScaleOz > 0 ? 'Batch Total' : 'Total Base'}
                              </span>

                              {globalScaleOz > 0 ? (
                                <span className="font-mono font-black text-indigo-700 text-[13px]">
                                  {globalScaleOz.toFixed(1)} oz
                                </span>
                              ) : (
                                <div className="flex items-center gap-3">
                                  <span className={`font-mono font-bold ${totalRgOz.toFixed(1) === '8.0' ? 'text-gray-400' : 'text-gray-800'}`}>
                                    {totalRgOz.toFixed(1)} oz
                                  </span>
                                  <span className={`font-mono font-bold ${totalLgOz.toFixed(1) === '12.0' ? 'text-gray-400' : 'text-gray-800'}`}>
                                    {totalLgOz.toFixed(1)} oz
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
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
                rounded-t-2xl h-[92vh] sm:h-auto sm:max-h-[88vh] sm:rounded-xl sm:max-w-[840px]
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
                  {/* Single Table-Like Header with Live Batch Scaler */}
                  <div className="flex items-center gap-2 px-1.5 pb-2 border-b border-gray-100 text-[10.5px] font-bold uppercase tracking-wider text-gray-500">
                    {/* Spacer matching drag handle (px-1 + text-base = ~24px) */}
                    <span className="w-6 shrink-0" />

                    {/* Ingredient label takes all available space */}
                    <span className="flex-1 min-w-0">Ingredients (Drag ⠿ to rearrange)</span>

                    {/* Spacer matching delete button (w-8 = 32px) */}
                    <span className="w-8 shrink-0" />

                    {/* Aligned column headers */}
                    <span className="w-[78px] text-center text-gray-500 shrink-0">%</span>
                    <span className="w-[76px] text-center text-amber-700 font-extrabold shrink-0">8 oz (RG)</span>
                    <span className="w-[76px] text-center text-purple-700 font-extrabold shrink-0">12 oz (LG)</span>

                    {/* Interactive Batch Target Input */}
                    <div className="w-[96px] h-8 shrink-0 flex items-center justify-center gap-1 bg-indigo-50 border border-indigo-200 rounded-lg px-2" title="Type target batch size in ounces to preview scaling">
                      <input
                        type="number"
                        min="0"
                        value={batchPreviewOz}
                        onChange={e => setBatchPreviewOz(e.target.value)}
                        placeholder="200"
                        className="w-12 text-center font-black text-xs text-indigo-700 bg-transparent outline-none"
                      />
                      <span className="text-[10px] font-black text-indigo-500">OZ</span>
                    </div>
                  </div>

                  <div className="space-y-2 mt-2.5">
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
                          className="flex-1 min-w-0 text-xs font-medium px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                        />

                        {/* Delete Row Button */}
                        <button
                          type="button"
                          onClick={() => removeIngredient(row.key)}
                          title="Remove ingredient"
                          className="shrink-0 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        {/* Editable Percentage Input */}
                        <div className="relative w-[78px] shrink-0">
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
                            className="w-full text-right font-mono font-bold text-xs py-2 pl-2 pr-5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
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
                          className="w-[76px] shrink-0 text-center font-mono font-bold text-xs px-2 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
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
                          className="w-[76px] shrink-0 text-center font-mono font-bold text-xs px-2 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-[#5D5FEF]"
                        />

                        {/* Live Scaled Target Requirement */}
                        {(() => {
                          const targetBatch = parseFloat(batchPreviewOz) || 0;
                          const raw8Val = parseFloat(row.raw8) || 0;
                          const scaledOz = targetBatch > 0 ? (raw8Val / 8.0) * targetBatch : 0;

                          return (
                            <div
                              className="w-[96px] h-9 shrink-0 px-2 flex flex-col justify-center items-end bg-indigo-50/70 border border-indigo-100 rounded-lg text-right select-none"
                              title={`${scaledOz.toFixed(1)} oz needed for ${targetBatch} oz batch`}
                            >
                              <span className="text-[12px] font-mono font-black text-indigo-950 leading-tight">
                                {scaledOz > 0 ? `${scaledOz.toFixed(1)} oz` : '—'}
                              </span>
                              {scaledOz > 0 && (
                                <span className="text-[9.5px] font-mono font-semibold text-indigo-600/80 leading-none">
                                  {scaledOz >= 16 ? `${(scaledOz / 16).toFixed(2)} lbs` : `${Math.round(scaledOz * 28.35)} g`}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>

                  {/* Real-time batch total & 100% check */}
                  <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between text-xs font-mono">
                    <button
                      type="button"
                      onClick={addIngredientRow}
                      className="px-3.5 py-1.5 text-xs font-sans font-bold text-[#5D5FEF] bg-[#F4F4FE] hover:bg-[#EBEBFD] rounded-lg transition-colors cursor-pointer"
                    >
                      + Add Another Ingredient
                    </button>

                    <div className="flex items-center gap-2 font-bold">
                      <span className="text-gray-400 uppercase text-[10px] tracking-wider">Total:</span>
                      <span
                        className={`w-[78px] text-center font-mono shrink-0 ${Math.abs(drawerTotalPct - 100.0) < 0.5 ? 'text-emerald-600' : 'text-amber-600 font-extrabold'
                          }`}
                        title="Target: 100%"
                      >
                        {drawerTotalPct.toFixed(1)}%
                      </span>
                      <span
                        className={`w-[76px] text-center font-mono shrink-0 ${Math.abs(drawerTotal8 - 8.0) < 0.05 ? 'text-emerald-600' : 'text-amber-600 font-extrabold'
                          }`}
                        title="Standard target is 8.0 oz"
                      >
                        {drawerTotal8.toFixed(2)} oz
                      </span>
                      <span className="w-[76px] text-center font-mono text-gray-500 shrink-0">
                        {(drawerTotal8 * 1.5).toFixed(2)} oz
                      </span>
                      <span className="w-[96px] text-right pr-2 text-xs font-mono font-black text-indigo-700 shrink-0">
                        {parseFloat(batchPreviewOz) > 0 ? `${parseFloat(batchPreviewOz).toFixed(1)} oz` : '—'}
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