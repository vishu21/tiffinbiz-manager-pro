'use client';

import React, { useState } from 'react';
import { CreditCard, Minus, Plus } from 'lucide-react';

export default function CustomerPlanBillingDemo() {
  const [planTier, setPlanTier] = useState<'trial' | 'weekly' | 'monthly'>('monthly');
  const [credits, setCredits] = useState<number>(20);
  const [startDate, setStartDate] = useState<string>('2026-09-30');
  const [portionSize, setPortionSize] = useState<'RG' | 'LG' | 'HALF RG' | 'HALF LG'>('LG');
  const [discountType, setDiscountType] = useState<'none' | 'flat' | 'percent'>('flat');
  const [discountValue, setDiscountValue] = useState<number>(15);

  // Dynamic price calculation
  const getBaseRate = () => {
    let rate = planTier === 'trial' ? 14 : planTier === 'weekly' ? 65 : 240;
    if (portionSize === 'LG') rate += planTier === 'monthly' ? 10 : 3;
    if (portionSize === 'HALF LG' || portionSize === 'HALF RG') rate -= planTier === 'monthly' ? 20 : 5;
    return rate;
  };

  const calculateFinalPrice = () => {
    const base = getBaseRate();
    if (discountType === 'flat') return Math.max(0, base - discountValue);
    if (discountType === 'percent') return Math.max(0, Math.round(base * (1 - discountValue / 100)));
    return base;
  };

  const finalPrice = calculateFinalPrice();
  const baseRate = getBaseRate();

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-10 flex items-center justify-center">
      <div className="w-full max-w-3xl p-6 bg-white border border-gray-200 rounded-2xl shadow-sm font-sans space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-600" />
            <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
              Plan &amp; Pricing Configuration
            </h3>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
            Charged: ${finalPrice.toFixed(2)} CAD
          </span>
        </div>

        {/* 1. Plan Selector */}
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            Subscription Plan
          </label>
          <div className="grid grid-cols-3 gap-2.5">
            {(
              [
                { key: 'trial', label: 'Trial', credits: 1 },
                { key: 'weekly', label: 'Weekly', credits: 5 },
                { key: 'monthly', label: 'Monthly', credits: 20 },
              ] as const
            ).map((plan) => (
              <button
                key={plan.key}
                type="button"
                onClick={() => {
                  setPlanTier(plan.key);
                  setCredits(plan.credits);
                }}
                className={`h-11 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                  planTier === plan.key
                    ? 'bg-[#5D5FEF] border-[#5D5FEF] text-white shadow-2xs'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 shadow-2xs'
                }`}
              >
                <span>{plan.label}</span>
                <span className={planTier === plan.key ? 'text-white/80' : 'text-gray-400'}>
                  ({plan.credits})
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 2. Four-Column Row: Start Date | Credits | Cycle Charge | End Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Start Date */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-12 px-3 text-xs font-bold border border-gray-300 rounded-xl text-gray-800 focus:outline-none focus:border-blue-500 bg-white"
            />
          </div>

          {/* Credits Counter */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Credits (Meals)
            </label>
            <div className="flex items-center border border-gray-300 rounded-xl overflow-hidden h-12 bg-white">
              <button
                type="button"
                onClick={() => setCredits((c) => Math.max(1, c - 1))}
                className="w-10 h-full bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold border-r border-gray-200 transition-all duration-150 cursor-pointer flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="flex-1 text-center text-sm font-black text-gray-900">{credits}</span>
              <button
                type="button"
                onClick={() => setCredits((c) => c + 1)}
                className="w-10 h-full bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold border-l border-gray-200 transition-all duration-150 cursor-pointer flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Cycle Price / Charge Box */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                Cycle Price
              </label>
              <span className="text-[10px] font-black text-emerald-800 bg-emerald-100/70 px-1.5 py-0.5 rounded border border-emerald-300 uppercase">
                CAD / Cycle
              </span>
            </div>
            <div className="w-full h-12 px-3.5 border border-emerald-300 bg-emerald-50/60 rounded-xl flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-base font-black text-emerald-950">${finalPrice}</span>
                <span className="text-[10px] text-emerald-800 font-bold ml-1">CAD</span>
              </div>
              <div className="text-right">
                {discountType !== 'none' && discountValue > 0 ? (
                  <span className="text-[10.5px] font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">
                    {discountType === 'flat' ? `-$${discountValue}` : `-${discountValue}%`}
                  </span>
                ) : (
                  <span className="text-[10.5px] font-semibold text-emerald-700">Base: ${baseRate}</span>
                )}
              </div>
            </div>
          </div>

          {/* End Date */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                End Date
              </label>
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 uppercase">
                Auto (Mon–Fri)
              </span>
            </div>
            <div className="w-full h-12 px-3 border border-gray-200 rounded-xl bg-gray-50/80 flex items-center justify-between text-xs font-bold text-gray-800">
              <span>Wed, Oct 28</span>
              <span className="text-[10.5px] text-gray-400 font-normal">(2026-10-28)</span>
            </div>
          </div>
        </div>

        {/* 3. Interactive Pricing Adjusters */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
          <span className="text-[11px] font-black uppercase text-slate-700 tracking-wider block">
            Live Rate Modifiers (Meal Config &amp; Discounts)
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Portion Size */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Portion Size</label>
              <div className="grid grid-cols-4 gap-1">
                {(['RG', 'LG', 'HALF RG', 'HALF LG'] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setPortionSize(size)}
                    className={`h-8 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer duration-150 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                      portionSize === size
                        ? 'bg-[#5D5FEF] text-white border-[#5D5FEF] shadow-2xs'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 shadow-2xs'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Discount Override */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                Discount Adjustment
              </label>
              <div className="flex items-center gap-1.5">
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as 'none' | 'flat' | 'percent')}
                  className="h-8 px-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 outline-none cursor-pointer"
                >
                  <option value="none">None</option>
                  <option value="flat">-$ Flat</option>
                  <option value="percent">-% Percent</option>
                </select>
                {discountType !== 'none' && (
                  <input
                    type="number"
                    min="0"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
                    className="h-8 w-20 px-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-800 outline-none"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}