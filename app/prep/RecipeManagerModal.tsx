'use client';

import React, { useState, useEffect } from 'react';
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
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
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
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-md uppercase tracking-wider border transition-all ${
                  activeTab === 'dal'
                    ? 'bg-amber-50 text-amber-700 border-amber-300'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                Dals ({recipes.dal.length})
              </button>
              <button
                onClick={() => setActiveTab('sabji')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-md uppercase tracking-wider border transition-all ${
                  activeTab === 'sabji'
                    ? 'bg-green-50 text-green-700 border-green-300'
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
                      className="px-2 py-1 text-[10px] font-bold text-blue-600 hover:bg-blue-50 rounded"
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="px-2 py-1 text-[10px] font-bold text-red-500 hover:bg-red-50 rounded"
                      title="Delete"
                    >
                      ❌
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
                  className={`px-3 py-1.5 text-[10px] font-bold rounded-md uppercase tracking-wider border transition-all ${
                    formCategory === 'dal'
                      ? 'bg-amber-50 text-amber-700 border-amber-300'
                      : 'bg-white text-gray-400 border-gray-200'
                  }`}
                >
                  Dal
                </button>
                <button
                  onClick={() => setFormCategory('sabji')}
                  className={`px-3 py-1.5 text-[10px] font-bold rounded-md uppercase tracking-wider border transition-all ${
                    formCategory === 'sabji'
                      ? 'bg-green-50 text-green-700 border-green-300'
                      : 'bg-white text-gray-400 border-gray-200'
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
                className="flex-1 py-1.5 bg-[#5D5FEF] text-white text-[11px] font-bold rounded-lg hover:bg-[#4D4FDF] disabled:opacity-50 transition-all"
              >
                {isSubmitting ? 'Saving...' : editingId ? '✏️ Update Item' : '+ Add Item'}
              </button>
              {editingId && (
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 border border-gray-200 text-gray-500 text-[11px] font-bold rounded-lg hover:bg-gray-50"
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
