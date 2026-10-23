'use client';

import React, { useState, useTransition } from 'react';
import { DollarSign, Check, Loader2, Sparkles, Clock } from 'lucide-react';
import { saveAppSettings } from '../actions';
import { useToast } from '@/app/components/ToastProvider';
import type { PlanPricingMatrix, TierPrices } from '@/app/utils/subscriptionCycle';

const SANITIZE_MATRIX = (m?: Partial<PlanPricingMatrix>): PlanPricingMatrix => ({
  monthly: {
    veg_rg: m?.monthly?.veg_rg ?? 220,
    veg_lg: m?.monthly?.veg_lg ?? 250,
    nv_rg: m?.monthly?.nv_rg ?? 250,
    nv_lg: m?.monthly?.nv_lg ?? 280,
  },
  weekly: {
    veg_rg: m?.weekly?.veg_rg ?? 60,
    veg_lg: m?.weekly?.veg_lg ?? 70,
    nv_rg: m?.weekly?.nv_rg ?? 70,
    nv_lg: m?.weekly?.nv_lg ?? 80,
  },
  trial: {
    veg_rg: m?.trial?.veg_rg ?? 13,
    veg_lg: m?.trial?.veg_lg ?? 15,
    nv_rg: m?.trial?.nv_rg ?? 15,
    nv_lg: m?.trial?.nv_lg ?? 17,
  },
});

export default function RulesSettingsClient({
  initialMatrix,
}: {
  initialMatrix: PlanPricingMatrix;
}) {
  const cleanInitial = SANITIZE_MATRIX(initialMatrix);
  const [matrix, setMatrix] = useState<PlanPricingMatrix>(cleanInitial);
  const [savedBaseline, setSavedBaseline] = useState<PlanPricingMatrix>(cleanInitial);
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  const isDirty = JSON.stringify(matrix) !== JSON.stringify(savedBaseline);

  const updatePrice = (
    tier: keyof PlanPricingMatrix,
    field: keyof TierPrices,
    value: number
  ) => {
    setMatrix(prev => ({
      ...prev,
      [tier]: {
        ...prev[tier],
        [field]: Math.max(0, value),
      },
    }));
  };

  const handleSave = () => {
    startTransition(async () => {
      const res = await saveAppSettings({
        plan_pricing_matrix: matrix,
      } as any);

      if (res.success) {
        setSavedBaseline(matrix);
        showToast('Pricing rules saved and updated across all customer plans!');
      } else {
        showToast(res.message || 'Failed to save pricing', 'error');
      }
    });
  };

  const TIERS: { key: keyof PlanPricingMatrix; title: string; subtitle: string }[] = [
    { key: 'monthly', title: 'Monthly Plan', subtitle: '20 Tiffins (Mon–Fri)' },
    { key: 'weekly', title: 'Weekly Plan', subtitle: '5 Tiffins (Mon–Fri)' },
    { key: 'trial', title: 'Daily / Trial', subtitle: '1 Tiffin' },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-200/90 p-6 sm:p-8 space-y-6 shadow-2xs font-sans">
      <div className="border-b border-gray-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-gray-900 tracking-tight flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[#5D5FEF]" />
            <span>Subscription Pricing Grid</span>
          </h3>
          <p className="text-xs text-gray-500 font-medium mt-0.5">
            Deliveries: Mon–Fri before 9:00 AM • All meals include roti (rice substitute optional)
          </p>
        </div>

        {isDirty && (
          <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-xl self-start sm:self-auto">
            ● Unsaved pricing changes
          </span>
        )}
      </div>

      {/* 3 Direct Tier Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {TIERS.map(({ key, title, subtitle }) => {
          const prices = matrix[key];
          const isMonthly = key === 'monthly';

          return (
            <div
              key={key}
              className={`rounded-2xl border overflow-hidden transition-all ${
                isMonthly ? 'border-[#5D5FEF]/40 shadow-xs' : 'border-gray-200'
              }`}
            >
              <div
                className={`px-5 py-3.5 border-b flex items-center justify-between ${
                  isMonthly ? 'bg-[#5D5FEF]/5 border-[#5D5FEF]/20' : 'bg-gray-50/80 border-gray-100'
                }`}
              >
                <div>
                  <h4 className="text-xs font-black uppercase text-gray-900 tracking-wider">
                    {title}
                  </h4>
                  <span className="text-[11px] text-gray-500 font-semibold">{subtitle}</span>
                </div>
                <span className="text-[10.5px] font-bold text-gray-400 uppercase">CAD ($)</span>
              </div>

              <div className="p-5 space-y-4 bg-white">
                {/* Vegetarian Section */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase text-emerald-800 tracking-wider">
                      🥗 Vegetarian
                    </span>
                    <span className="text-[10px] text-gray-400 font-medium">1 Dal + 1 Sabji</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                        Regular (8oz)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">$</span>
                        <input
                          type="number"
                          min="0"
                          value={prices?.veg_rg ?? 0}
                          onChange={e => updatePrice(key, 'veg_rg', Number(e.target.value))}
                          className="w-full h-10 pl-7 pr-3 text-sm font-black border border-gray-200 rounded-xl outline-none focus:border-emerald-500 text-gray-900 bg-emerald-50/20"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                        Large (12oz)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">$</span>
                        <input
                          type="number"
                          min="0"
                          value={prices?.veg_lg ?? 0}
                          onChange={e => updatePrice(key, 'veg_lg', Number(e.target.value))}
                          className="w-full h-10 pl-7 pr-3 text-sm font-black border border-gray-200 rounded-xl outline-none focus:border-emerald-500 text-gray-900 bg-emerald-50/20"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-100" />

                {/* Non-Vegetarian Section */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase text-rose-800 tracking-wider">
                      🍗 Non-Vegetarian
                    </span>
                    <span className="text-[10px] text-gray-400 font-medium">Chicken M/W/F</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                        Regular (8oz)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">$</span>
                        <input
                          type="number"
                          min="0"
                          value={prices?.nv_rg ?? 0}
                          onChange={e => updatePrice(key, 'nv_rg', Number(e.target.value))}
                          className="w-full h-10 pl-7 pr-3 text-sm font-black border border-gray-200 rounded-xl outline-none focus:border-rose-500 text-gray-900 bg-rose-50/20"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                        Large (12oz)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">$</span>
                        <input
                          type="number"
                          min="0"
                         value={prices?.nv_lg ?? 0}
                          onChange={e => updatePrice(key, 'nv_lg', Number(e.target.value))}
                          className="w-full h-10 pl-7 pr-3 text-sm font-black border border-gray-200 rounded-xl outline-none focus:border-rose-500 text-gray-900 bg-rose-50/20"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save Button Strip */}
      <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium">
          <Sparkles className="w-3.5 h-3.5 text-[#5D5FEF]" />
          <span>Rates update automatically across customer billing drawers, WhatsApp messages, and renewals.</span>
        </div>

        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              type="button"
              onClick={() => setMatrix(savedBaseline)}
              className="h-10 px-4 py-2 text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl shadow-2xs transition-all duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            >
              Discard
            </button>
          )}

          <button
            type="button"
            disabled={!isDirty || isPending}
            onClick={handleSave}
            className="h-10 px-5 py-2 bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white font-bold text-xs rounded-xl shadow-2xs border border-transparent transition-all duration-150 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 stroke-[3]" />}
            <span>{isPending ? 'Saving…' : 'Save Pricing Grid'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}