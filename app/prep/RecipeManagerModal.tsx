'use client';

import React, { useState, useEffect } from 'react';
import { Pencil, X } from 'lucide-react';
import { addRecipe, updateRecipe, deleteRecipe, getAvailableRecipes } from './actions';
import type { Recipe } from './actions';

type Props = {
  open: boolean;
  onClose: () => void;
  onRecipesChanged: () => void;
};

export default function RecipeManagerModal({ open, onClose, onRecipesChanged }: Props) {
  const [recipes, setRecipes] = useState<{ dal: Recipe[]; sabji: Recipe[] }>({ dal: [], sabji: [] });
  const [activeTab, setActiveTab] = useState<'dal' | 'sabji'>('dal');
  const [search, setSearch] = useState('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<'dal' | 'sabji'>('dal');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadRecipes = async () => {
    const data = await getAvailableRecipes();
    setRecipes(data);
  };

  useEffect(() => {
    if (open) loadRecipes();
  }, [open]);

  const handleSubmit = async () => {
    setFormError('');
    if (!formName.trim()) {
      setFormError('Name cannot be empty.');
      return;
    }
    setIsSubmitting(true);
    try {
      if (editingId) {
        await updateRecipe(editingId, formName, formCategory);
      } else {
        await addRecipe(formName, formCategory);
      }
      setFormName('');
      setEditingId(null);
      await loadRecipes();
      onRecipesChanged();
    } catch (err: any) {
      setFormError(err.message || 'Operation failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (r: Recipe) => {
    setFormName(r.name);
    setFormCategory(r.category);
    setEditingId(r.id);
    setFormError('');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this recipe?')) return;
    try {
      await deleteRecipe(id);
      await loadRecipes();
      onRecipesChanged();
      if (editingId === id) {
        setFormName('');
        setEditingId(null);
      }
    } catch (err: any) {
      alert(err.message || 'Delete failed.');
    }
  };

  const handleCancelEdit = () => {
    setFormName('');
    setEditingId(null);
    setFormError('');
  };

  const currentList = activeTab === 'dal' ? recipes.dal : recipes.sabji;
  const filteredList = currentList.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className="bg-white rounded-xl shadow-2xl border border-[#EEEEEE] w-[520px] max-h-[80vh] flex flex-col pointer-events-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
            <h2 className="text-[14px] font-bold text-[#11142D] uppercase tracking-wide">Recipe Manager</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close recipe manager"
              className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1 text-lg leading-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              &times;
            </button>
          </div>

          {/* Search + Tabs */}
          <div className="px-5 pt-3 pb-2 space-y-2 shrink-0">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search recipes..."
              className="w-full text-[12px] px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-blue-400"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('dal')}
                className={`flex-1 h-8 text-xs font-bold rounded-xl uppercase tracking-normal border shadow-2xs transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                  activeTab === 'dal'
                    ? 'bg-amber-50 text-amber-700 border-amber-300'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                Dals ({recipes.dal.length})
              </button>
              <button
                onClick={() => setActiveTab('sabji')}
                className={`flex-1 h-8 text-xs font-bold rounded-xl uppercase tracking-normal border shadow-2xs transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                  activeTab === 'sabji'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                Sabjis ({recipes.sabji.length})
              </button>
            </div>
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto px-5 py-2 space-y-1 min-h-[200px]">
            {filteredList.length === 0 ? (
              <p className="text-center text-gray-400 text-[12px] py-8 font-medium">
                {search ? 'No recipes match your search.' : 'No recipes yet.'}
              </p>
            ) : (
              filteredList.map(r => (
                <div
                  key={r.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-all group"
                >
                  <span className="text-[13px] font-semibold text-gray-700">{r.name}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(r)}
                      className="w-7 h-7 flex items-center justify-center text-[#5D5FEF] hover:bg-[#5D5FEF]/10 rounded-xl transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="w-7 h-7 flex items-center justify-center text-rose-600 hover:bg-rose-50 rounded-xl transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Delete"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add / Edit Form */}
          <div className="px-5 py-3 border-t border-gray-100 shrink-0 space-y-2">
            {formError && (
              <p className="text-[11px] font-semibold text-red-600 bg-red-50 px-2 py-1 rounded">{formError}</p>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder={editingId ? 'Edit recipe name...' : 'New recipe name...'}
                className="flex-1 text-[12px] px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:bg-white focus:border-blue-400"
              />
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => setFormCategory('dal')}
                  className={`h-8 px-3 text-xs font-bold rounded-xl uppercase tracking-normal border shadow-2xs transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                    formCategory === 'dal'
                      ? 'bg-amber-50 text-amber-700 border-amber-300'
                      : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Dal
                </button>
                <button
                  onClick={() => setFormCategory('sabji')}
                  className={`h-8 px-3 text-xs font-bold rounded-xl uppercase tracking-normal border shadow-2xs transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                    formCategory === 'sabji'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Sabji
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-1 h-10 py-2 bg-[#5D5FEF] text-white text-xs font-bold rounded-xl shadow-2xs border border-transparent hover:bg-[#4D4FD9] disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
              >
                {isSubmitting ? 'Saving...' : editingId ? <span className="flex items-center gap-1"><Pencil className="w-3.5 h-3.5" /> Update Item</span> : '+ Add Item'}
              </button>
              {editingId && (
                <button
                  onClick={handleCancelEdit}
                  className="h-10 px-3 border border-gray-200 bg-white text-gray-700 text-xs font-bold rounded-xl shadow-2xs hover:bg-gray-50 transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
