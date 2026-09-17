'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { X, MapPin, Package, Check, Pencil } from 'lucide-react';
import {
  splitPickupsAndDeliveries,
  sortDeliveriesChained,
  getUniqueAddressGroups,
  getCustomerDeliveryAddress,
  sanitizeAddressForUrl,
  DeliveryCustomer,
  DeliveryRun,
  AddressGroup,
  DEFAULT_KITCHEN_ORIGIN,
} from '../utils/deliveryRouting';

interface DriverDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  manifestCustomers: DeliveryCustomer[];
  activeDay?: string;
  kitchenAddress?: string;
}

// Helper: Generates batched Google Maps URLs from any explicitly ordered list of stops
function buildRunsFromStops(
  orderedStops: AddressGroup[],
  kitchenOrigin: string,
  maxStopsPerRun: number = 9
): DeliveryRun[] {
  if (orderedStops.length === 0) return [];

  const activeOrigin =
    !kitchenOrigin || kitchenOrigin.trim() === 'London, ON'
      ? DEFAULT_KITCHEN_ORIGIN
      : kitchenOrigin;

  const runs: DeliveryRun[] = [];
  const totalRuns = Math.ceil(orderedStops.length / maxStopsPerRun);

  for (let i = 0; i < totalRuns; i++) {
    const startIdx = i * maxStopsPerRun;
    const stopBatch = orderedStops.slice(startIdx, startIdx + maxStopsPerRun);
    if (stopBatch.length === 0) continue;

    const rawStart =
      i === 0 ? activeOrigin : orderedStops[startIdx - 1]?.address || activeOrigin;

    const origin = encodeURIComponent(sanitizeAddressForUrl(rawStart));
    const lastStop = stopBatch[stopBatch.length - 1];
    const destination = encodeURIComponent(sanitizeAddressForUrl(lastStop.address));

    const intermediateStops = stopBatch.slice(0, -1);
    const waypointsParam =
      intermediateStops.length > 0
        ? `&waypoints=${intermediateStops
            .map((s) => encodeURIComponent(sanitizeAddressForUrl(s.address)))
            .join('|')}`
        : '';

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointsParam}&travelmode=driving`;
    const allCustomersInRun = stopBatch.flatMap((s) => s.customers);

    runs.push({
      runIndex: i + 1,
      label:
        totalRuns === 1
          ? 'Full Delivery Route'
          : `Run ${i + 1} (${stopBatch.length} Stops · ${allCustomersInRun.length} Meals)`,
      stops: allCustomersInRun,
      mapsUrl,
    });
  }

  return runs;
}

export default function DriverDispatchModal({
  isOpen,
  onClose,
  manifestCustomers,
  activeDay,
  kitchenAddress = DEFAULT_KITCHEN_ORIGIN,
}: DriverDispatchModalProps) {
  const [selectedFirstStop, setSelectedFirstStop] = useState<string>('');
  const [isManualMode, setIsManualMode] = useState<boolean>(false);
  const [orderedStops, setOrderedStops] = useState<AddressGroup[]>([]);

  const { pickups, deliveries } = useMemo(() => {
    return splitPickupsAndDeliveries(manifestCustomers, activeDay);
  }, [manifestCustomers, activeDay]);

  const uniqueAvailableStops = useMemo(() => {
    return getUniqueAddressGroups(deliveries);
  }, [deliveries]);

  // Sync auto-optimized route whenever deliveries or starting stop changes
  useEffect(() => {
    const autoSorted = sortDeliveriesChained(deliveries, selectedFirstStop);
    setOrderedStops(autoSorted);
  }, [deliveries, selectedFirstStop]);

  // Generate Google Maps runs dynamically based on the active stop order
  const deliveryRuns = useMemo(() => {
    return buildRunsFromStops(orderedStops, kitchenAddress, 9);
  }, [orderedStops, kitchenAddress]);

  // Manual Reordering: Move a stop Up
  const moveStopUp = (index: number) => {
    if (index === 0) return;
    setOrderedStops((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  // Manual Reordering: Move a stop Down
  const moveStopDown = (index: number) => {
    if (index === orderedStops.length - 1) return;
    setOrderedStops((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  // Reset order to auto-calculated shortest distance
  const resetToAuto = () => {
    const autoSorted = sortDeliveriesChained(deliveries, selectedFirstStop);
    setOrderedStops(autoSorted);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm print:hidden">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 pb-4">
          <div>
            <h2 className="text-xl font-bold text-stone-900">Driver Dispatch &amp; Route Links</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Origin: <span className="font-semibold text-stone-700">{kitchenAddress}</span> • {deliveries.length} Deliveries • {pickups.length} Pickups
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* First Stop Selector & Manual Mode Toggle */}
        {deliveries.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3">
              <label className="text-xs font-bold text-stone-700 whitespace-nowrap flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> First Stop:
              </label>
              <select
                value={selectedFirstStop}
                onChange={(e) => setSelectedFirstStop(e.target.value)}
                className="w-full text-xs font-medium bg-white border border-stone-300 rounded-lg py-1.5 px-2 text-stone-800 outline-none focus:border-[#D97746]"
              >
                <option value="">Auto (Closest to Kitchen Base)</option>
                {uniqueAvailableStops.map((g) => (
                  <option key={g.address} value={g.address}>
                    {g.address} ({g.customers.length} {g.customers.length === 1 ? 'meal' : 'meals'})
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setIsManualMode(!isManualMode)}
                className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                  isManualMode
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-100'
                }`}
              >
                {isManualMode ? <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Done Reordering</span> : <span className="flex items-center gap-1"><Pencil className="w-3.5 h-3.5" /> Manual Order</span>}
              </button>
            </div>

            {/* Manual Stop Ordering Panel */}
            {isManualMode && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-amber-200/60">
                  <span className="text-xs font-bold text-amber-950">
                    Arrange Custom Stop Sequence:
                  </span>
                  <button
                    type="button"
                    onClick={resetToAuto}
                    className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 underline"
                  >
                    Reset to Shortest Path
                  </button>
                </div>

                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {orderedStops.map((group, idx) => (
                    <div
                      key={group.address}
                      className="flex items-center justify-between bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 shadow-sm text-xs"
                    >
                      <div className="flex items-center gap-2 truncate mr-2">
                        <span className="font-bold text-stone-400 w-5 text-center shrink-0">
                          {idx + 1}.
                        </span>
                        <span className="truncate font-medium text-stone-800">
                          {group.address}
                        </span>
                        <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded shrink-0">
                          {group.customers.length} {group.customers.length === 1 ? 'meal' : 'meals'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveStopUp(idx)}
                          className="w-6 h-6 flex items-center justify-center rounded border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-25"
                          title="Move earlier"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          disabled={idx === orderedStops.length - 1}
                          onClick={() => moveStopDown(idx)}
                          className="w-6 h-6 flex items-center justify-center rounded border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-25"
                          title="Move later"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Route Cards */}
        <div className="my-5 space-y-3 max-h-[50vh] overflow-y-auto pr-1">
          {deliveryRuns.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-500">No active delivery orders for this date.</p>
          ) : (
            deliveryRuns.map((run: DeliveryRun) => (
              <div
                key={run.runIndex}
                className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 p-4 transition-all hover:border-[#D97746]/40"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-stone-900">{run.label}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      {run.stops.length} Meals
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">
                    First stop: <span className="font-medium text-stone-700">{getCustomerDeliveryAddress(run.stops[0])}</span>
                  </p>
                </div>

                <a
                  href={run.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg bg-[#D97746] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#c46535] active:scale-95 transition-all"
                >
                  <MapPin className="w-4 h-4" /> Open in Google Maps
                </a>
              </div>
            ))
          )}

          {/* Pickups */}
          {pickups.length > 0 && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-blue-800">
                <Package className="w-4 h-4" /> Counter Pickups ({pickups.length}) - Excluded from Route
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {pickups.map((p: DeliveryCustomer) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-blue-900 shadow-sm border border-blue-100"
                  >
                    {p.full_name || p.name} ({p.portion_size || 'RG'})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-stone-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-stone-100 px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}