'use client';

import React, { useState, useTransition, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, CalendarOff, Flag, AlertTriangle, Check, X, Info, XCircle, Loader2 } from 'lucide-react';
import ActionButton from '@/app/components/ui/ActionButton';
import {
    simulateKitchenClosure,
    scheduleKitchenClosureRange,
    cancelKitchenClosure,
    cancelKitchenClosureBatch,
    type ClosureImpactSimulation,
} from './actions';

const toDateStr = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const formatDisplayDate = (dStr: string | null) => {
    if (!dStr) return null;
    const d = new Date(`${dStr}T12:00:00`);
    return {
        dayNum: d.getDate(),
        monthYear: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
    };
};

const formatShortDate = (dStr: string) => {
    const d = new Date(`${dStr}T12:00:00`);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

type Toast = {
    type: 'success' | 'error' | 'info';
    title: string;
    message: string;
};

type ClosureGroup = {
    key: string;
    reason: string;
    startDate: string;
    endDate: string;
    count: number;
    ids: string[];
    items: Array<{ id: string; date: string }>;
    createdAt: string;
};

type MonthSection = {
    monthKey: string;
    monthLabel: string;
    totalDays: number;
    groups: ClosureGroup[];
};

export default function ClosuresClient({
    initialClosures,
    initialLedger,
}: {
    initialClosures: any[];
    initialLedger: any[];
}) {
    const router = useRouter();
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [hoverDate, setHoverDate] = useState<string | null>(null);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [viewDate, setViewDate] = useState<Date>(() => new Date());

    const [reason, setReason] = useState('Public Holiday');
    const [isSimulating, startSimTransition] = useTransition();
    const [isSubmitting, startSubmitTransition] = useTransition();
    const [simulation, setSimulation] = useState<ClosureImpactSimulation | null>(null);
    const [activeTab, setActiveTab] = useState<'closures' | 'ledger'>('closures');

    // Controls the preview / confirmation dialog modal
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

    const [expandedGroupKeys, setExpandedGroupKeys] = useState<Record<string, boolean>>({});
    const [toast, setToast] = useState<Toast | null>(null);
    const [reopenTarget, setReopenTarget] = useState<{
        ids: string[];
        label: string;
        isBatch: boolean;
        count: number;
    } | null>(null);

    const pickerRef = useRef<HTMLDivElement>(null);
    const todayStr = toDateStr(new Date());

    // Fast lookup map for already scheduled closures
    const closedDaysMap = useMemo(() => {
        const map = new Map<string, string>();
        (initialClosures || []).forEach((c) => {
            map.set(c.closure_date, c.reason);
        });
        return map;
    }, [initialClosures]);

    // Group consecutive dates with the same reason into single multi-day blocks
    const groupedClosures = useMemo(() => {
        const sorted = [...initialClosures].sort((a, b) => a.closure_date.localeCompare(b.closure_date));
        const groups: ClosureGroup[] = [];

        sorted.forEach(item => {
            const last = groups[groups.length - 1];
            const prevDate = last ? new Date(`${last.endDate}T12:00:00`) : null;
            const currDate = new Date(`${item.closure_date}T12:00:00`);

            const diffDays = prevDate ? Math.round((currDate.getTime() - prevDate.getTime()) / 86400000) : 999;
            const isContiguous = diffDays >= 1 && diffDays <= 3;

            if (last && last.reason.toLowerCase() === item.reason.toLowerCase() && isContiguous) {
                last.endDate = item.closure_date;
                last.count += 1;
                last.ids.push(item.id);
                last.items.push({ id: item.id, date: item.closure_date });
            } else {
                groups.push({
                    key: item.id,
                    reason: item.reason,
                    startDate: item.closure_date,
                    endDate: item.closure_date,
                    count: 1,
                    ids: [item.id],
                    items: [{ id: item.id, date: item.closure_date }],
                    createdAt: item.created_at,
                });
            }
        });

        return groups.reverse();
    }, [initialClosures]);

    // Group closure blocks by Month & Year
    const monthlySections = useMemo(() => {
        const sectionsMap = new Map<string, MonthSection>();

        groupedClosures.forEach(group => {
            const dateObj = new Date(`${group.startDate}T12:00:00`);
            const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
            const monthLabel = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            if (!sectionsMap.has(monthKey)) {
                sectionsMap.set(monthKey, {
                    monthKey,
                    monthLabel,
                    totalDays: 0,
                    groups: [],
                });
            }

            const section = sectionsMap.get(monthKey)!;
            section.groups.push(group);
            section.totalDays += group.count;
        });

        return Array.from(sectionsMap.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    }, [groupedClosures]);

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(null), 5000);
        return () => clearTimeout(timer);
    }, [toast]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                setIsCalendarOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const prevMonth = () => {
        setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
    };
    const nextMonth = () => {
        setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
    };

    const handleDateClick = (dateStr: string) => {
        if (!startDate || (startDate && endDate)) {
            setStartDate(dateStr);
            setEndDate('');
            setSimulation(null);
        } else if (startDate && !endDate) {
            if (dateStr < startDate) {
                setStartDate(dateStr);
                setEndDate(startDate);
            } else {
                setEndDate(dateStr);
            }
            setSimulation(null);
        }
    };

    // Calculate simulation and show confirmation/preview modal
    const handleOpenScheduleModal = () => {
        if (!startDate) {
            setToast({
                type: 'error',
                title: 'Missing Date Selection',
                message: 'Please pick a date range before scheduling or previewing.',
            });
            return;
        }
        const finalEnd = endDate || startDate;
        startSimTransition(async () => {
            try {
                const res = await simulateKitchenClosure(startDate, finalEnd);
                setSimulation(res);
                setIsConfirmModalOpen(true);
            } catch (err: any) {
                setToast({
                    type: 'error',
                    title: 'Simulation Error',
                    message: err.message || 'Could not calculate closure impact.',
                });
            }
        });
    };

    const handleResetForm = () => {
        setStartDate('');
        setEndDate('');
        setReason('Public Holiday');
        setSimulation(null);
        setIsConfirmModalOpen(false);
    };

    const handleConfirmSchedule = () => {
        if (!startDate || isSubmitting) return;
        const finalEnd = endDate || startDate;
        startSubmitTransition(async () => {
            try {
                const res = await scheduleKitchenClosureRange(startDate, finalEnd, reason);
                if (!res || (res as any).success === false) {
                    throw new Error((res as any)?.message || 'Failed to create closures.');
                }
                setToast({
                    type: 'success',
                    title: 'Closure Scheduled Successfully',
                    message: `${res.createdDaysCount} closure day(s) active. ${res.creditedCustomersCount} customer(s) compensated.`,
                });
                setIsConfirmModalOpen(false);
                handleResetForm();
                router.refresh();
            } catch (err: any) {
                console.error('[Closures] Schedule failed:', err);
                setIsConfirmModalOpen(false); // Force close modal so UI doesn't hang
                setToast({
                    type: 'error',
                    title: 'Failed to Schedule Closure',
                    message: err?.message || 'An error occurred during closure creation. Check terminal logs.',
                });
            }
        });
    };

    const executeReopen = () => {
        if (!reopenTarget) return;
        const { ids, label, isBatch } = reopenTarget;
        startSubmitTransition(async () => {
            try {
                if (isBatch && ids.length > 1) {
                    await cancelKitchenClosureBatch(ids);
                } else {
                    await cancelKitchenClosure(ids[0]);
                }
                setToast({
                    type: 'info',
                    title: 'Kitchen Reopened',
                    message: `Reopened for ${label}. Deducted credited meal balances.`,
                });
                setReopenTarget(null);
                router.refresh();
            } catch (err: any) {
                setToast({
                    type: 'error',
                    title: 'Reopening Failed',
                    message: err.message || 'Could not revert closure.',
                });
            }
        });
    };

    const toggleGroupExpand = (key: string) => {
        setExpandedGroupKeys(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const renderMonthGrid = (year: number, month: number) => {
        const firstDay = new Date(year, month, 1, 12, 0, 0);
        // Standard Sunday-first starting index: 0 = Sun, 1 = Mon, ..., 6 = Sat
        const startingDay = firstDay.getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const days: (number | null)[] = [];
        for (let i = 0; i < startingDay; i++) {
            days.push(null);
        }
        for (let d = 1; d <= daysInMonth; d++) {
            days.push(d);
        }

        return (
            <div className="w-64 select-none">
                <div className="text-center font-bold text-gray-800 text-sm mb-3">
                    {MONTH_NAMES[month]} {year}
                </div>
                {/* SUNDAY FIRST COLUMN HEADERS */}
                <div className="grid grid-cols-7 text-center text-xs font-semibold text-gray-400 mb-2">
                    <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
                </div>
                <div className="grid grid-cols-7 gap-y-1 text-xs">
                    {days.map((day, idx) => {
                        if (day === null) {
                            return <div key={`empty-${idx}`} className="h-9 w-9" />;
                        }

                        const currentStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const isToday = currentStr === todayStr;
                        const isAlreadyClosed = closedDaysMap.has(currentStr);
                        const closureReason = closedDaysMap.get(currentStr);

                        const isStart = currentStr === startDate;
                        const isEnd = currentStr === (endDate || (hoverDate && !endDate ? hoverDate : ''));
                        const isInRange =
                            startDate &&
                            (endDate || hoverDate) &&
                            currentStr > startDate &&
                            currentStr < (endDate || (hoverDate && hoverDate > startDate ? hoverDate : ''));

                        return (
                            <button
                                key={currentStr}
                                type="button"
                                disabled={isAlreadyClosed}
                                title={isAlreadyClosed ? `Already closed: ${closureReason}` : undefined}
                                onClick={() => !isAlreadyClosed && handleDateClick(currentStr)}
                                onMouseEnter={() => !endDate && !isAlreadyClosed && setHoverDate(currentStr)}
                                className={`h-9 w-9 flex flex-col items-center justify-center font-medium transition-all relative
                  ${isAlreadyClosed ? 'bg-amber-100/70 text-amber-900 border border-amber-300/80 rounded-md cursor-not-allowed opacity-80' : 'cursor-pointer'}
                  ${isInRange && !isAlreadyClosed ? 'bg-indigo-50 text-indigo-900 rounded-none' : ''}
                  ${isStart ? '!bg-blue-600 !text-white font-bold rounded-l-full shadow-xs z-10' : ''}
                  ${isEnd && (endDate || hoverDate) ? '!bg-blue-600 !text-white font-bold rounded-r-full shadow-xs z-10' : ''}
                  ${isStart && isEnd ? '!rounded-full' : ''}
                  ${!isStart && !isEnd && !isInRange && !isAlreadyClosed ? 'hover:bg-gray-100 rounded-full text-gray-700' : ''}
                  ${isToday && !isStart && !isEnd && !isAlreadyClosed ? 'border border-blue-500 font-extrabold text-blue-600' : ''}
                `}
                            >
                                <span>{day}</span>
                                {isToday && !isStart && !isEnd && !isAlreadyClosed && (
                                    <span className="w-1 h-1 rounded-full bg-blue-600 mt-0.5" />
                                )}
                                {isAlreadyClosed && (
                                    <span className="w-1 h-1 rounded-full bg-amber-600 mt-0.5" />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    const startDisplay = formatDisplayDate(startDate);
    const endDisplay = formatDisplayDate(endDate || startDate);

    return (
        <div className="flex flex-col h-screen bg-[#FDFDFD] overflow-hidden font-sans antialiased text-[#292D32]">
            {/* IN-APP TOAST */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200">
                    <div
                        className={`flex items-start gap-3 p-4 rounded-2xl shadow-xl border text-sm max-w-md ${toast.type === 'success'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                            : toast.type === 'error'
                                ? 'bg-rose-50 border-rose-200 text-rose-950'
                                : 'bg-indigo-50 border-indigo-200 text-indigo-950'
                            }`}
                    >
                        <span className="text-xl">
                            {toast.type === 'success' ? <Check className="w-5 h-5 text-emerald-500" /> : toast.type === 'error' ? <X className="w-5 h-5 text-rose-500" /> : <Info className="w-5 h-5 text-indigo-500" />}
                        </span>
                        <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-[13px]">{toast.title}</h4>
                            <p className="text-[12px] opacity-90 mt-0.5 leading-snug">{toast.message}</p>
                        </div>
                        <button
                            onClick={() => setToast(null)}
                            className="text-gray-400 hover:text-gray-600 font-bold ml-1 text-xs cursor-pointer"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* HEADER */}
            <div className="px-8 py-4 border-b border-[#EEEEEE] flex items-center justify-between bg-white shrink-0">
                <div>
                    <h1 className="text-[22px] font-black text-[#11142D] tracking-tight flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                            <CalendarOff className="w-4.5 h-4.5 text-amber-600" strokeWidth={2.2} />
                        </div>
                        <span>Kitchen Holidays &amp; Closures</span>
                    </h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                        Schedule operational shutdowns, protect customers from double-compensation, and manage credits.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setActiveTab('closures')}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === 'closures'
                            ? 'bg-[#5D5FEF] text-white shadow-xs'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        Scheduled Closures ({initialClosures.length} days / {groupedClosures.length} events)
                    </button>
                    <button
                        onClick={() => setActiveTab('ledger')}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === 'ledger'
                            ? 'bg-[#5D5FEF] text-white shadow-xs'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        Credit Audit Ledger
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full space-y-6">
                {/* SCHEDULE CLOSURE CARD */}
                <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                    <h2 className="text-xs font-black uppercase text-gray-400 tracking-wider mb-4">
                        Schedule New Closure
                    </h2>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                        <div className="lg:col-span-2 relative" ref={pickerRef}>
                            <label className="block text-xs font-bold text-gray-600 mb-1.5">
                                Closure Dates <span className="font-normal text-gray-400">(Click once for 1 day, twice for range)</span>
                            </label>

                            <div
                                onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                                className="grid grid-cols-2 divide-x divide-gray-200 border border-gray-300 rounded-2xl bg-white hover:border-gray-400 cursor-pointer transition-all shadow-xs overflow-hidden"
                            >
                                <div className="p-3.5 flex items-center gap-3">
                                    <Calendar className="w-7 h-7 opacity-75 text-gray-500" />
                                    <div className="min-w-0">
                                        <span className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide">
                                            Start Date
                                        </span>
                                        {startDisplay ? (
                                            <div className="leading-tight">
                                                <span className="font-extrabold text-sm text-gray-900">
                                                    {startDisplay.dayNum} {startDisplay.monthYear}
                                                </span>
                                                <span className="block text-[11px] font-medium text-gray-500">
                                                    {startDisplay.weekday}
                                                </span>
                                            </div>
                                        ) : (
                                            <span className="text-sm font-semibold text-gray-400">Select start</span>
                                        )}
                                    </div>
                                </div>

                                <div className="p-3.5 flex items-center gap-3 pl-4">
                                    <Flag className="w-7 h-7 opacity-75 text-gray-500" />
                                    <div className="min-w-0">
                                        <span className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide">
                                            End Date
                                        </span>
                                        {endDisplay && (endDate || startDate) ? (
                                            <div className="leading-tight">
                                                <span className="font-extrabold text-sm text-gray-900">
                                                    {endDisplay.dayNum} {endDisplay.monthYear}
                                                </span>
                                                <span className="block text-[11px] font-medium text-gray-500">
                                                    {endDisplay.weekday}
                                                </span>
                                            </div>
                                        ) : (
                                            <span className="text-sm font-semibold text-gray-400">Same as start</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* DUAL MONTH CALENDAR POPOVER */}
                            {isCalendarOpen && (
                                <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-2xl shadow-2xl p-6 z-50 animate-in fade-in slide-in-from-top-2">
                                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                                        <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
                                            Select Closure Range
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={prevMonth}
                                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 font-bold cursor-pointer"
                                            >
                                                ‹
                                            </button>
                                            <button
                                                type="button"
                                                onClick={nextMonth}
                                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 font-bold cursor-pointer"
                                            >
                                                ›
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row gap-8">
                                        {renderMonthGrid(viewDate.getFullYear(), viewDate.getMonth())}
                                        {renderMonthGrid(
                                            viewDate.getMonth() === 11 ? viewDate.getFullYear() + 1 : viewDate.getFullYear(),
                                            (viewDate.getMonth() + 1) % 12
                                        )}
                                    </div>

                                    <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
                                        <div className="flex items-center gap-3">
                                            <span className="flex items-center gap-1">
                                                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" /> Selected
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <span className="w-2.5 h-2.5 rounded-md bg-amber-100 border border-amber-400 inline-block" /> Closed / Holiday
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <span className="w-2.5 h-2.5 rounded-full border border-blue-500 inline-block" /> Today
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <span>
                                                {startDate && !endDate && 'Select end date (or leave for 1 day)'}
                                                {startDate && endDate && `Range: ${startDate} → ${endDate}`}
                                                {!startDate && 'Click date to start'}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setStartDate('');
                                                    setEndDate('');
                                                    setSimulation(null);
                                                }}
                                                className="text-rose-600 font-bold hover:underline cursor-pointer"
                                            >
                                                Clear Dates
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1.5">Reason / Holiday Name</label>
                            <input
                                type="text"
                                value={reason}
                                onChange={e => setReason(e.target.value)}
                                placeholder="e.g. Thanksgiving, Out of Country"
                                className="w-full h-15.5 px-4 border border-gray-300 rounded-2xl text-sm font-semibold focus:border-[#5D5FEF] outline-none bg-white shadow-xs"
                            />
                        </div>
                    </div>

                    {/* UNIFIED ACTION BUTTON CLUSTER */}
                    <div className="mt-5 flex items-center justify-end gap-2.5 pt-3 border-t border-gray-100">
                        {/* Clear / Reset Button - Visible secondary outline style */}
                        <button
                            type="button"
                            onClick={handleResetForm}
                            disabled={!startDate && reason === 'Public Holiday'}
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 text-gray-700 font-bold text-xs shadow-xs transition-all disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-gray-400 disabled:hover:border-gray-200 cursor-pointer"
                        >
                            <span>↺</span> Reset
                        </button>

                        {/* Schedule Action Button */}
                        <button
                            type="button"
                            onClick={handleOpenScheduleModal}
                            disabled={isSimulating || !startDate}
                            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#5D5FEF] hover:bg-[#4D4FD7] text-white font-bold text-xs shadow-sm transition-all disabled:opacity-40 cursor-pointer"
                        >
                            {isSimulating ? 'Calculating…' : 'Schedule Closure →'}
                        </button>
                    </div>
                </div>

                {/* TAB 1: MONTH-GROUPED SCHEDULED CLOSURES */}
                {activeTab === 'closures' && (
                    <div className="space-y-6">
                        {monthlySections.length === 0 ? (
                            <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-400 text-xs font-medium shadow-sm">
                                No kitchen holidays or closures currently scheduled.
                            </div>
                        ) : (
                            monthlySections.map(section => (
                                <div
                                    key={section.monthKey}
                                    className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm"
                                >
                                    <div className="px-5 py-3 bg-[#F8F9FB] border-b border-gray-200 flex items-center justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <span className="text-sm font-black text-gray-800 tracking-tight">
                                                {section.monthLabel}
                                            </span>
                                            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                                {section.groups.length} event{section.groups.length === 1 ? '' : 's'} • {section.totalDays} closed day{section.totalDays === 1 ? '' : 's'}
                                            </span>
                                        </div>
                                    </div>

                                    <table className="w-full text-left text-[13px] border-collapse">
                                        <thead>
                                            <tr className="border-b border-gray-100 text-[10.5px] font-bold text-gray-400 uppercase tracking-wider bg-white">
                                                <th className="py-2.5 px-5">Closure Span</th>
                                                <th className="py-2.5 px-5">Reason</th>
                                                <th className="py-2.5 px-5">Created On</th>
                                                <th className="py-2.5 px-5 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {section.groups.map(group => {
                                                const isExpanded = expandedGroupKeys[group.key];
                                                const isMultiDay = group.count > 1;

                                                return (
                                                    <React.Fragment key={group.key}>
                                                        <tr className="hover:bg-gray-50/80 transition-colors">
                                                            <td className="py-3.5 px-5 font-bold text-gray-900">
                                                                <div className="flex items-center gap-2">
                                                                    {isMultiDay && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => toggleGroupExpand(group.key)}
                                                                            className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500 font-mono text-xs cursor-pointer"
                                                                            title="Expand individual days"
                                                                        >
                                                                            {isExpanded ? '▼' : '▶'}
                                                                        </button>
                                                                    )}
                                                                    <span>
                                                                        {group.startDate === group.endDate ? (
                                                                            formatShortDate(group.startDate)
                                                                        ) : (
                                                                            <>
                                                                                <span>{formatShortDate(group.startDate)}</span>
                                                                                <span className="text-gray-400 mx-1.5">→</span>
                                                                                <span>{formatShortDate(group.endDate)}</span>
                                                                                <span className="ml-2 px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                                                                    {group.count} days
                                                                                </span>
                                                                            </>
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            </td>

                                                            <td className="py-3.5 px-5 font-semibold text-gray-700">
                                                                <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-md text-xs font-bold">
                                                                    {group.reason}
                                                                </span>
                                                            </td>

                                                            <td className="py-3.5 px-5 text-xs text-gray-400 font-medium">
                                                                {new Date(group.createdAt).toLocaleDateString('en-US', {
                                                                    month: 'short',
                                                                    day: 'numeric',
                                                                    year: 'numeric',
                                                                })}
                                                            </td>

                                                            <td className="py-3.5 px-5 text-right">
                                                                <button
                                                                    onClick={() =>
                                                                        setReopenTarget({
                                                                            ids: group.ids,
                                                                            label: isMultiDay
                                                                                ? `${group.startDate} to ${group.endDate}`
                                                                                : group.startDate,
                                                                            isBatch: isMultiDay,
                                                                            count: group.count,
                                                                        })
                                                                    }
                                                                    disabled={isSubmitting}
                                                                    className="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
                                                                >
                                                                    {isMultiDay ? `Reopen Full Block (${group.count} days)` : 'Reopen Kitchen'}
                                                                </button>
                                                            </td>
                                                        </tr>

                                                        {/* SUB-DAYS DRILLDOWN */}
                                                        {isExpanded &&
                                                            group.items.map(subItem => (
                                                                <tr key={subItem.id} className="bg-gray-50/60 border-l-4 border-l-indigo-400 text-xs">
                                                                    <td className="py-2.5 pl-12 pr-5 font-semibold text-gray-700">
                                                                        ↳ {formatShortDate(subItem.date)}
                                                                    </td>
                                                                    <td className="py-2.5 px-5 text-gray-500 italic">Day {subItem.date} of {group.reason}</td>
                                                                    <td className="py-2.5 px-5 text-gray-400">—</td>
                                                                    <td className="py-2.5 px-5 text-right">
                                                                        <button
                                                                            onClick={() =>
                                                                                setReopenTarget({
                                                                                    ids: [subItem.id],
                                                                                    label: subItem.date,
                                                                                    isBatch: false,
                                                                                    count: 1,
                                                                                })
                                                                            }
                                                                            disabled={isSubmitting}
                                                                            className="px-2.5 py-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-md text-[11px] font-bold cursor-pointer"
                                                                        >
                                                                            Reopen Just This Day
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* TAB 2: CREDIT AUDIT LEDGER */}
                {activeTab === 'ledger' && (
                    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                        <table className="w-full text-left text-[13px] border-collapse">
                            <thead>
                                <tr className="bg-[#FCFCFD] border-b border-gray-200 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                                    <th className="py-3 px-5">Customer</th>
                                    <th className="py-3 px-5">Adjustment</th>
                                    <th className="py-3 px-5">Reason</th>
                                    <th className="py-3 px-5">Timestamp</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {initialLedger.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="py-12 text-center text-gray-400 text-xs font-medium">
                                            No credit adjustments recorded in ledger yet.
                                        </td>
                                    </tr>
                                ) : (
                                    initialLedger.map(entry => (
                                        <tr key={entry.id} className="hover:bg-gray-50/80 transition-colors">
                                            <td className="py-3.5 px-5 font-bold text-gray-900">
                                                {entry.customers?.full_name || entry.customer_id}
                                            </td>
                                            <td className="py-3.5 px-5">
                                                <span
                                                    className={`px-2 py-0.5 rounded font-black text-xs ${entry.amount > 0
                                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                                                        }`}
                                                >
                                                    {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-5 text-xs text-gray-600 font-medium">
                                                {entry.reason}
                                            </td>
                                            <td className="py-3.5 px-5 text-xs text-gray-400">
                                                {new Date(entry.created_at).toLocaleString('en-US', {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* PREVIEW & CONFIRMATION MODAL */}
            {isConfirmModalOpen && simulation && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border space-y-4 animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                            <h3 className="font-extrabold text-base text-gray-900 flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-amber-500" /> Confirm Kitchen Closure
                            </h3>
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                {reason}
                            </span>
                        </div>

                        <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 leading-relaxed">
                            Found <strong>{simulation.closureDates.length}</strong> operational delivery day(s) ({simulation.closureDates.join(', ')}).
                            A total of <strong>{simulation.totalCreditsDisbursed}</strong> replacement credits will be granted across{' '}
                            <strong>{simulation.totalCustomersCredited}</strong> active customers.
                        </div>

                        {simulation.customerBreakdown.length > 0 && (
                            <div>
                                <span className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                                    Affected Customers ({simulation.customerBreakdown.length})
                                </span>
                                <div className="max-h-52 overflow-y-auto bg-gray-50/70 border border-gray-200 rounded-xl divide-y divide-gray-200 text-xs">
                                    {simulation.customerBreakdown.map(item => (
                                        <div key={item.customerId} className="px-3.5 py-2 flex items-center justify-between">
                                            <span className="font-bold text-gray-800">{item.customerName}</span>
                                            <span className="text-amber-800 font-semibold font-mono">
                                                +{item.creditsToAdd} credit(s) ({item.currentCredits} → {item.newCredits})
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-gray-100">
                            <button
                                type="button"
                                onClick={() => setIsConfirmModalOpen(false)}
                                disabled={isSubmitting}
                                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Dismiss
                            </button>
                            <ActionButton
                                onClick={handleConfirmSchedule}
                                loading={isSubmitting}
                                loadingText="Disbursing Credits..."
                                className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs"
                            >
                                Confirm &amp; Disburse Credits
                            </ActionButton>
                        </div>
                    </div>
                </div>
            )}

            {/* REOPEN CONFIRMATION MODAL */}
            {reopenTarget && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border space-y-4 animate-in fade-in zoom-in-95">
                        <h3 className="font-extrabold text-base text-gray-900">
                            Reopen Kitchen for {reopenTarget.label}?
                        </h3>
                        <p className="text-xs text-gray-600 leading-relaxed">
                            This will remove the scheduled closure for <strong>{reopenTarget.label}</strong> ({reopenTarget.count} day{reopenTarget.count > 1 ? 's' : ''}) and automatically rollback all compensation credits awarded to active customers.
                        </p>
                        <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setReopenTarget(null)}
                                disabled={isSubmitting}
                                className="px-3.5 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Cancel
                            </button>
                            <ActionButton
                                onClick={executeReopen}
                                loading={isSubmitting}
                                loadingText="Reopening…"
                                className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-xs"
                            >
                                {`Yes, Reopen ${reopenTarget.count > 1 ? 'Entire Block' : 'Kitchen'}`}
                            </ActionButton>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}