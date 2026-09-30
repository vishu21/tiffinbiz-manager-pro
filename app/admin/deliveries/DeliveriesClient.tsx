'use client';

import { useMemo, useState, useEffect, useSyncExternalStore, useRef } from 'react';
import { useRouter } from 'next/navigation';
import PrepDatePicker from '@/app/components/PrepDatePicker';
import { getDeliveryDateData, saveRouteAndPropagateFuture } from './actions';
import { formatDeliveryMessage } from '@/app/utils/messageTemplate';
import {
  Package,
  BookOpen,
  Check,
  Navigation,
  Phone,
  Search,
  X,
  CheckCircle2,
  AlertCircle,
  Truck,
  ListOrdered,
  GripVertical,
  ExternalLink,
  MapPin,
  Camera,
  MessageSquare,
  Loader2,
  FileText
} from 'lucide-react';
import { markDelivered, logSkip, renewPlan, undoTodayDispatchAction, saveDeliveryRouteOrder } from './actions';
import { isPickupOnDay } from '@/app/utils/customerPickup';
import { computeCycleEndDate, resolveDeliveryDayNumbers } from '@/app/utils/subscriptionCycle';
import {
  DEFAULT_KITCHEN_ORIGIN,
  sanitizeAddressForUrl,
  DeliveryCustomer
} from '@/app/prep/utils/deliveryRouting';

type CustomerRow = {
  id: string;
  full_name: string;
  phone_number?: string | null;
  plan_tier: string | null;
  total_tiffin_credits: number | null;
  used_credits: number | null;
  skipped_days_count: number | null;
  subscription_status: string | null;
  status: string | null;
  delivery_schedule: string | null;
  delivery_address?: string | null;
  delivery_instructions?: string | null;
  dietary_notes?: string | null;
  meal_type?: string | null;
  portion_size?: string | null;
  roti_count?: number | null;
  is_pickup?: boolean | null;
  pickup_days?: string[] | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  start_date?: string | null;
  cycle_end_date?: string | null;
  scheduled_cancel_date?: string | null;
  pause_start_date?: string | null;
  pause_end_date?: string | null;
  created_at?: string | null;
};

const noopSubscribe = () => () => { };

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function isCustomerScheduledToday(
  customer: CustomerRow,
  activeDay: string,
  todayKey: string,
  hasDeliveryLog: boolean = false,
  closureDates?: Set<string>
): boolean {
  const subStatus = (customer.subscription_status || 'active').toLowerCase();
  if (subStatus === 'cancelled') return false;

  const startDate = customer.start_date ? customer.start_date.slice(0, 10) : null;
  if (!hasDeliveryLog && startDate && todayKey < startDate) {
    const createdDate = customer.created_at ? customer.created_at.slice(0, 10) : null;
    if (!createdDate || createdDate > todayKey) {
      return false;
    }
  }

  if (subStatus === 'paused') {
    const pauseEnd = customer.pause_end_date ? customer.pause_end_date.slice(0, 10) : null;
    if (!pauseEnd) return false;
    if (todayKey < pauseEnd) return false;
  }

  if (customer.scheduled_cancel_date && todayKey > customer.scheduled_cancel_date.slice(0, 10)) {
    return false;
  }

  const schedule = customer.delivery_schedule || '';
  if (!schedule || schedule === '—') return false;

  const shortDay = activeDay.substring(0, 3);
  const exceptionMatch = schedule.match(/\[EXCEPT:\s*(.*?)\]/i);
  if (exceptionMatch && exceptionMatch[1].toLowerCase().includes(shortDay.toLowerCase())) return false;

  const isWeekday = WEEKDAYS.includes(activeDay);
  const dayMatches =
    (schedule.includes('Monday to Friday') && isWeekday) ||
    schedule.includes(activeDay) ||
    schedule.toLowerCase().includes(shortDay.toLowerCase());

  if (!dayMatches) return false;

  const totalMeals =
    customer.total_tiffin_credits ||
    (customer.plan_tier === 'trial' ? 1 : customer.plan_tier === 'monthly' ? 20 : 5);

  const computedEnd = computeCycleEndDate({
    startDate: customer.start_date,
    totalMeals,
    deliveryDays: resolveDeliveryDayNumbers(customer.delivery_schedule),
    closureDates,
  });

  const explicitEnd = customer.cycle_end_date ? customer.cycle_end_date.slice(0, 10) : null;
  const effectiveEnd = explicitEnd || computedEnd;

  if (effectiveEnd && todayKey > effectiveEnd) {
    if (!hasDeliveryLog) return false;
  }

  return true;
}

const tierBadge: Record<string, string> = {
  trial: 'bg-sky-50 text-sky-700 border-sky-200',
  weekly: 'bg-blue-50 text-blue-700 border-blue-200',
  monthly: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

type DailyLog = { customerId: string; event: 'delivered' | 'skipped' };

const isWeekdayDelivery = (date: Date): boolean => {
  const day = date.getDay();
  return day !== 0 && day !== 6;
};

const toLocalDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const calculateElapsedDeliveryDays = (
  startDateStr: string | null | undefined,
  closureDates?: Set<string>,
  maxCredits?: number,
  customerSkips?: Set<string>,
): number => {
  if (!startDateStr) return 0;

  let normalized = startDateStr.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalized)) {
    const [m, d, y] = normalized.split('/');
    normalized = `${y}-${m}-${d}`;
  }

  const startDate = new Date(`${normalized}T00:00:00`);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (isNaN(startDate.getTime()) || startDate > today) return 0;

  const isClosed = (d: Date): boolean => {
    if (!closureDates) return false;
    return closureDates.has(toLocalDateKey(d));
  };

  const isCustomerSkip = (d: Date): boolean => {
    if (!customerSkips) return false;
    return customerSkips.has(toLocalDateKey(d));
  };

  let count = 0;
  const cursor = new Date(startDate);

  while (cursor <= today) {
    if (isWeekdayDelivery(cursor) && !isClosed(cursor) && !isCustomerSkip(cursor)) {
      count++;
      if (maxCredits && count >= maxCredits) break;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return count;
};

const formatStreetOnlyAddress = (address: string | null | undefined): string => {
  if (!address) return '';
  const parts = address.split(',').map(p => p.trim()).filter(Boolean);
  
  const streetParts = parts.filter(part => {
    const p = part.toLowerCase();
    const isCity = p === 'london' || p === 'woodstock' || p === 'st. thomas' || p === 'st thomas';
    const isProvince = p === 'on' || p === 'ontario' || p === 'qc' || p === 'canada';
    const isPostal = /^[a-z]\d[a-z]\s?\d[a-z]\d$/i.test(part);
    return !isCity && !isProvince && !isPostal;
  });

  const baseStreet = streetParts.length > 0 ? streetParts.join(', ') : parts[0];
  // Strip trailing city string if entered without a comma
  return baseStreet.replace(/\s+(london|woodstock|st\.?\s*thomas)$/i, '').trim();
};

function cleanPhoneNumberForWhatsApp(phone: string | null | undefined): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    digits = `1${digits}`;
  }
  return digits;
}

export default function DeliveriesClient({
  initialCustomers,
  todayLogs,
  initialRouteOrder = [],
}: {
  initialCustomers: CustomerRow[];
  todayLogs: DailyLog[];
  initialRouteOrder?: string[];
}) {
  const router = useRouter();
  const isMounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [tab, setTab] = useState<'dispatch' | 'ledger'>('dispatch');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showOrderSheet, setShowOrderSheet] = useState(false);
  const [customOrderIds, setCustomOrderIds] = useState<string[]>(initialRouteOrder);
  const [renewedAt, setRenewedAt] = useState<{ id: string; at: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Delivery Confirmation Flow State
  const [proofCustomer, setProofCustomer] = useState<CustomerRow | null>(null);

  // Automated Driver Notification Templates State
  const [msgTemplates, setMsgTemplates] = useState<{
    delivery_message_template: string;
    last_day_message_template: string;
  }>({
    delivery_message_template: 'Hi {customer_name}, your tiffin has been delivered! Enjoy your meal!',
    last_day_message_template: 'Hi {customer_name}, your tiffin has been delivered! Today is your final delivery for this cycle. Please leave your empty tiffin bag out for collection.',
  });

  // Kitchen Base Origin State
  const [kitchenBase, setKitchenBase] = useState<{
    address: string;
    lat: number;
    lng: number;
  }>({
    address: 'Unit 42, 3270 Singleton Ave, London, ON N6L 0E5',
    lat: 42.9238,
    lng: -81.2782,
  });

  // Drag and Drop State
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const touchStartY = useRef<number>(0);
  const touchStartIndex = useRef<number | null>(null);

  const [closuresSet, setClosuresSet] = useState<Set<string>>(new Set());
  const [skipsMap, setSkipsMap] = useState<Map<string, Set<string>>>(new Map());

  useEffect(() => {
    let isMountedFlag = true;
    (async () => {
      try {
        const { createClient } = await import('@/utils/supabase/client');
        const supabase = createClient();

        const [closuresRes, skipsRes, settingsRes] = await Promise.all([
          supabase.from('kitchen_closures').select('closure_date'),
          supabase
            .from('customer_daily_overrides')
            .select('customer_id, override_date')
            .eq('is_skipped', true),
          supabase
            .from('app_settings')
            .select('delivery_message_template, last_day_message_template, kitchen_address, kitchen_lat, kitchen_lng')
            .eq('id', 'default')
            .maybeSingle(),
        ]);

        if (isMountedFlag) {
          if (closuresRes.data) {
            setClosuresSet(new Set(closuresRes.data.map((c: any) => c.closure_date)));
          }
          if (skipsRes.data) {
            const map = new Map<string, Set<string>>();
            skipsRes.data.forEach((row: any) => {
              const cId = String(row.customer_id);
              const sDate = String(row.override_date || '').slice(0, 10);
              if (cId && sDate) {
                if (!map.has(cId)) map.set(cId, new Set());
                map.get(cId)!.add(sDate);
              }
            });
            setSkipsMap(map);
          }
          if (settingsRes?.data) {
            setMsgTemplates({
              delivery_message_template:
                settingsRes.data.delivery_message_template ||
                'Hi {customer_name}, your tiffin has been delivered! Enjoy your meal!',
              last_day_message_template:
                settingsRes.data.last_day_message_template ||
                'Hi {customer_name}, your tiffin has been delivered! Today is your final delivery for this cycle. Please leave your empty tiffin bag out for collection.',
            });
            if (settingsRes.data.kitchen_address) {
              setKitchenBase({
                address: settingsRes.data.kitchen_address,
                lat: typeof settingsRes.data.kitchen_lat === 'number' ? settingsRes.data.kitchen_lat : 42.9238,
                lng: typeof settingsRes.data.kitchen_lng === 'number' ? settingsRes.data.kitchen_lng : -81.2782,
              });
            }
          }
        }
      } catch (err) {
        console.error('[Deliveries] Failed to fetch closures or skips:', err);
      }
    })();

    return () => {
      isMountedFlag = false;
    };
  }, []);

  const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today;
  });
  const [activeLogs, setActiveLogs] = useState<DailyLog[]>(todayLogs);
  const [isDateSwitching, setIsDateSwitching] = useState(false);

  const selectedDateKey = useMemo(() => toLocalDateKey(selectedDate), [selectedDate]);
  const activeDay = useMemo(() => DAYS_OF_WEEK[(selectedDate.getDay() + 6) % 7], [selectedDate]);

  const currentWeekMonday = useMemo(() => {
    const d = new Date(selectedDate);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(12, 0, 0, 0);
    return d;
  }, [selectedDate]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(currentWeekMonday);
      date.setDate(currentWeekMonday.getDate() + i);
      const dayName = DAYS_OF_WEEK[i];
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const dStr = String(date.getDate()).padStart(2, '0');
      return {
        name: dayName,
        short: dayName.substring(0, 3),
        dayNum: date.getDate(),
        dateKey: `${y}-${m}-${dStr}`,
        dateObj: date,
      };
    });
  }, [currentWeekMonday]);

  const changeWeek = (direction: 'prev' | 'next') => {
    const targetMonday = new Date(currentWeekMonday);
    targetMonday.setDate(currentWeekMonday.getDate() + (direction === 'next' ? 7 : -7));
    targetMonday.setHours(12, 0, 0, 0);
    setSelectedDate(targetMonday);
  };

  const isSelectedToday = useMemo(() => {
    return toLocalDateKey(new Date()) === selectedDateKey;
  }, [selectedDateKey]);

  const isSelectedTomorrow = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return toLocalDateKey(tomorrow) === selectedDateKey;
  }, [selectedDateKey]);

  const formattedTargetDate = useMemo(() => {
    return selectedDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    setIsDateSwitching(true);

    (async () => {
      try {
        const { createClient } = await import('@/utils/supabase/client');
        const supabase = createClient();

        const [data, skipsRes] = await Promise.all([
          getDeliveryDateData(selectedDateKey),
          supabase
            .from('customer_daily_overrides')
            .select('customer_id, override_date')
            .eq('is_skipped', true),
        ]);

        if (!cancelled) {
          setActiveLogs(data.todayLogs);
          setCustomOrderIds(data.routeOrder);

          if (skipsRes.data) {
            const map = new Map<string, Set<string>>();
            skipsRes.data.forEach((row: any) => {
              const cId = String(row.customer_id);
              const sDate = String(row.override_date || '').slice(0, 10);
              if (cId && sDate) {
                if (!map.has(cId)) map.set(cId, new Set());
                map.get(cId)!.add(sDate);
              }
            });
            setSkipsMap(map);
          }
        }
      } catch (err) {
        console.error('[Deliveries] Date fetch failed:', err);
      } finally {
        if (!cancelled) setIsDateSwitching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDateKey]);

  const saveOrder = async (order: string[]) => {
    setCustomOrderIds(order);
    setSaveStatus('saving');

    try {
      localStorage.setItem(`delivery_route_${selectedDateKey}`, JSON.stringify(order));
    } catch (e) {
      console.warn('Failed to save route order locally', e);
    }

    try {
      const res = await saveRouteAndPropagateFuture(selectedDateKey, order);
      if (!res?.success) {
        setErrorMsg(res?.message || 'Could not save route');
        setSaveStatus('idle');
      } else {
        setErrorMsg('');
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unknown error');
      setSaveStatus('idle');
    }
  };

  const customers = useMemo(
    () =>
      initialCustomers.map(c => {
        const tierKey = (c.plan_tier || 'monthly').toLowerCase();
        const standardAllowance = tierKey === 'weekly' ? 5 : tierKey === 'trial' ? 1 : 20;
        const total =
          c.total_tiffin_credits && c.total_tiffin_credits > 0
            ? tierKey === 'monthly' && c.total_tiffin_credits === 25
              ? 20
              : c.total_tiffin_credits
            : standardAllowance;

        const custSkips = skipsMap.get(c.id);
        const autoDays = calculateElapsedDeliveryDays(c.start_date, closuresSet, total, custSkips);

        return {
          ...c,
          plan_tier: c.plan_tier || 'monthly',
          total_tiffin_credits: total,
          used_credits: autoDays,
          skipped_days_count: c.skipped_days_count ?? 0,
        };
      }),
    [initialCustomers, closuresSet, skipsMap]
  );

  const todayLoggedIds = useMemo(() => activeLogs.map(l => l.customerId), [activeLogs]);

  const completedList = useMemo(
    () =>
      activeLogs
        .flatMap(log => {
          const customer = customers.find(c => c.id === log.customerId);
          return customer ? [{ ...log, customer }] : [];
        })
        .sort((a, b) => a.customer.full_name.localeCompare(b.customer.full_name)),
    [customers, activeLogs]
  );

  const allScheduledToday = useMemo(() => {
    if (closuresSet.has(selectedDateKey)) return [];

    return customers.filter(c => {
      const hasLog = todayLoggedIds.includes(c.id);
      if (!isCustomerScheduledToday(c, activeDay, selectedDateKey, hasLog, closuresSet)) return false;
      if (isPickupOnDay(c, activeDay)) return false;

      const custSkips = skipsMap.get(c.id);
      if (custSkips && custSkips.has(selectedDateKey)) return false;

      return true;
    });
  }, [customers, activeDay, selectedDateKey, skipsMap, closuresSet, todayLoggedIds]);

  const pendingDispatchList = useMemo(() => {
    const uncompleted = allScheduledToday.filter(c => !todayLoggedIds.includes(c.id));
    if (customOrderIds.length === 0) {
      return uncompleted;
    }

    const map = new Map(uncompleted.map(c => [c.id, c]));
    const sequenced: CustomerRow[] = [];

    for (const id of customOrderIds) {
      const match = map.get(id);
      if (match) {
        sequenced.push(match);
        map.delete(id);
      }
    }

    const unsequenced = Array.from(map.values());
    return [...sequenced, ...unsequenced];
  }, [allScheduledToday, todayLoggedIds, customOrderIds]);

  const routeRuns = useMemo(() => {
    const validStops = pendingDispatchList.filter(c => c.delivery_address && c.delivery_address.length > 3);
    if (validStops.length === 0) return [];

    const kitchenOriginEncoded = encodeURIComponent(sanitizeAddressForUrl(kitchenBase.address));
    const runs: { label: string; url: string; stopsCount: number; isReturn: boolean }[] = [];
    const maxStopsPerRun = 9;
    const totalRuns = Math.ceil(validStops.length / maxStopsPerRun);

    for (let i = 0; i < totalRuns; i++) {
      const startIdx = i * maxStopsPerRun;
      const batch = validStops.slice(startIdx, startIdx + maxStopsPerRun);
      if (batch.length === 0) continue;

      const isFirstRun = i === 0;
      const isLastRun = i === totalRuns - 1;

      const origin = isFirstRun
        ? kitchenOriginEncoded
        : encodeURIComponent(sanitizeAddressForUrl(validStops[startIdx - 1].delivery_address!));

      if (isLastRun) {
        const destination = kitchenOriginEncoded;
        const intermediateWaypoints = batch
          .map(s => encodeURIComponent(sanitizeAddressForUrl(s.delivery_address!)))
          .join('|');

        const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${intermediateWaypoints}&travelmode=driving`;

        runs.push({
          label: totalRuns === 1 ? 'Round Trip' : `Run ${i + 1}: Return`,
          url,
          stopsCount: batch.length,
          isReturn: true,
        });
      } else {
        const destination = encodeURIComponent(sanitizeAddressForUrl(batch[batch.length - 1].delivery_address!));
        const intermediateStops = batch.slice(0, -1);
        const waypointsParam = intermediateStops.length > 0
          ? `&waypoints=${intermediateStops.map(s => encodeURIComponent(sanitizeAddressForUrl(s.delivery_address!))).join('|')}`
          : '';

        const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointsParam}&travelmode=driving`;

        runs.push({
          label: `Run ${i + 1} (${startIdx + 1}–${startIdx + batch.length})`,
          url,
          stopsCount: batch.length,
          isReturn: false,
        });
      }
    }

    return runs;
  }, [pendingDispatchList, kitchenBase.address]);

  const filteredDispatchList = useMemo(() => {
    if (!searchQuery.trim()) return pendingDispatchList;
    const q = searchQuery.toLowerCase();
    return pendingDispatchList.filter(
      c =>
        c.full_name.toLowerCase().includes(q) ||
        (c.delivery_address || '').toLowerCase().includes(q)
    );
  }, [pendingDispatchList, searchQuery]);

  const ledgerList = useMemo(
    () =>
      customers.filter(c =>
        ['active', 'expired', 'paused'].includes((c.subscription_status || 'active').toLowerCase())
      ),
    [customers]
  );

  const completedCount = completedList.filter(l => l.event === 'delivered').length;
  const totalStopsCount = allScheduledToday.length;
  const progressPercent = totalStopsCount > 0 ? Math.round((completedCount / totalStopsCount) * 100) : 0;

  const reorderList = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const list = [...pendingDispatchList];
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    saveOrder(list.map(c => c.id));
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (index: number) => {
    if (draggedIndex !== null && draggedIndex !== index) {
      reorderList(draggedIndex, index);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleTouchStart = (index: number, e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartIndex.current = index;
    setDraggedIndex(index);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentY = e.touches[0].clientY;
    const elements = document.elementsFromPoint(e.touches[0].clientX, currentY);
    const dropTarget = elements.find(el => el.hasAttribute('data-drag-index'));
    if (dropTarget) {
      const targetIdx = Number(dropTarget.getAttribute('data-drag-index'));
      if (!isNaN(targetIdx) && targetIdx !== dragOverIndex) {
        setDragOverIndex(targetIdx);
      }
    }
  };

  const handleTouchEnd = () => {
    if (touchStartIndex.current !== null && dragOverIndex !== null && touchStartIndex.current !== dragOverIndex) {
      reorderList(touchStartIndex.current, dragOverIndex);
    }
    touchStartIndex.current = null;
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  if (!isMounted) {
    return (
      <div className="h-full flex-1 flex items-center justify-center bg-[#FDFDFD]">
        <div className="text-gray-400 text-sm font-medium">Loading deliveries…</div>
      </div>
    );
  }

  const handleMarkDelivered = async (customerId: string) => {
    setBusyId(customerId);
    setErrorMsg('');

    setActiveLogs(prev => [...prev.filter(l => l.customerId !== customerId), { customerId, event: 'delivered' }]);

    try {
      await markDelivered(customerId, selectedDateKey);
      router.refresh();
    } catch (err) {
      setActiveLogs(prev => prev.filter(l => l.customerId !== customerId));
      setErrorMsg(err instanceof Error ? err.message : 'Failed to mark delivered');
    } finally {
      setBusyId(null);
    }
  };

  const handleLogSkip = async (customerId: string) => {
    setBusyId(customerId);
    setErrorMsg('');

    setActiveLogs(prev => [...prev.filter(l => l.customerId !== customerId), { customerId, event: 'skipped' }]);

    try {
      await logSkip(customerId, selectedDateKey);
      router.refresh();
    } catch (err) {
      setActiveLogs(prev => prev.filter(l => l.customerId !== customerId));
      setErrorMsg(err instanceof Error ? err.message : 'Failed to skip');
    } finally {
      setBusyId(null);
    }
  };

  const handleUndo = async (customerId: string) => {
    setBusyId(customerId);
    setErrorMsg('');

    setActiveLogs(prev => prev.filter(l => l.customerId !== customerId));

    try {
      await undoTodayDispatchAction(customerId, selectedDateKey);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to undo action');
      const data = await getDeliveryDateData(selectedDateKey);
      setActiveLogs(data.todayLogs);
    } finally {
      setBusyId(null);
    }
  };

  const handleRenewPlan = async (customerId: string) => {
    setBusyId(customerId);
    setErrorMsg('');
    setRenewedAt({ id: customerId, at: new Date().toISOString() });
    try {
      await renewPlan(customerId);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to renew plan');
      setRenewedAt(null);
    } finally {
      setBusyId(null);
    }
  };

  const planTier = (tier: string | null) => (tier === 'trial' ? 'Trial' : tier === 'monthly' ? 'Monthly' : 'Weekly');

  return (
    <div className="flex-1 min-h-0 w-full max-w-full overflow-x-hidden overflow-y-auto bg-[#F8FAFC] pb-16 font-sans select-none">

      {/* TOP HEADER */}
      <div className="w-full max-w-full bg-white border-b border-gray-200 px-3 sm:px-6 py-2 sticky top-0 z-30 shadow-2xs print:hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-1.5 md:gap-3 w-full max-w-full min-w-0">

          <div className="flex items-center justify-between gap-2 w-full md:w-auto min-w-0 shrink-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[#5D5FEF] text-white flex items-center justify-center shrink-0">
                <Truck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <div className="min-w-0 truncate">
                <h1 className="text-[13.5px] sm:text-[17px] font-black text-[#11142D] tracking-tight leading-tight truncate">
                  Deliveries · {activeDay}
                </h1>
                <p className="text-[10px] sm:text-[11px] text-gray-400 font-semibold truncate">
                  {totalStopsCount - activeLogs.length} left of {totalStopsCount} stops
                </p>
              </div>
            </div>

            <div className="flex md:hidden bg-gray-100 p-0.5 rounded-lg border border-gray-200 shrink-0">
              <button
                type="button"
                onClick={() => setTab('dispatch')}
                className={`px-2 py-0.5 text-[10.5px] font-bold rounded-md transition-all ${
                  tab === 'dispatch' ? 'bg-white text-[#5D5FEF] shadow-xs' : 'text-gray-500'
                }`}
              >
                Dispatch ({pendingDispatchList.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('ledger')}
                className={`px-2 py-0.5 text-[10.5px] font-bold rounded-md transition-all ${
                  tab === 'ledger' ? 'bg-white text-[#5D5FEF] shadow-xs' : 'text-gray-500'
                }`}
              >
                Ledger
              </button>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-gray-50/70 border border-gray-200/80 rounded-lg text-xs font-semibold text-gray-500 shrink-0">
            <span>Route target:</span>
            <strong className="text-gray-900">{formattedTargetDate}</strong>
            {isSelectedToday ? (
              <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded-full border border-emerald-200">
                Today
              </span>
            ) : isSelectedTomorrow ? (
              <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full border border-indigo-100">
                Tomorrow
              </span>
            ) : null}
          </div>

          <div className="flex items-center justify-between md:justify-end gap-1.5 w-full md:w-auto min-w-0">
            <div className="inline-flex items-center justify-between sm:justify-start bg-gray-50 border border-gray-200 rounded-xl p-0.5 sm:p-1 shadow-2xs w-full md:w-auto min-w-0">
              <button
                type="button"
                onClick={() => changeWeek('prev')}
                title="Previous Week"
                className="w-6 sm:w-7 h-6 sm:h-7 flex items-center justify-center rounded-lg hover:bg-gray-200/70 text-gray-600 font-bold text-xs sm:text-sm cursor-pointer transition-colors shrink-0"
              >
                ‹
              </button>

              <div className="flex items-center justify-around sm:justify-start gap-0.5 px-0.5 flex-1 min-w-0">
                {weekDays.map((item) => {
                  const isSelected = selectedDateKey === item.dateKey;
                  const isClosed = closuresSet.has(item.dateKey);
                  const isWeekend = item.short === 'Sat' || item.short === 'Sun';

                  return (
                    <button
                      key={item.dateKey}
                      type="button"
                      onClick={() => setSelectedDate(item.dateObj)}
                      title={isClosed ? 'Kitchen Closed' : undefined}
                      className={`px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10.5px] sm:text-xs font-bold rounded-lg transition-all cursor-pointer relative items-center gap-0.5 shrink-0
                        ${isWeekend && !isSelected ? 'hidden sm:inline-flex' : 'inline-flex'}
                        ${isSelected && !isClosed ? 'bg-[#5D5FEF] text-white shadow-xs' : ''}
                        ${isSelected && isClosed ? 'bg-amber-500 text-white font-black shadow-xs' : ''}
                        ${!isSelected && isClosed ? 'bg-amber-100 text-amber-900 border border-amber-300' : ''}
                        ${!isSelected && !isClosed && isWeekend ? 'text-gray-400 opacity-40 hover:opacity-80 hover:bg-white' : ''}
                        ${!isSelected && !isClosed && !isWeekend ? 'text-gray-600 hover:bg-white hover:text-gray-900' : ''}
                      `}
                    >
                      <span className={isClosed && !isSelected ? 'line-through decoration-amber-600' : ''}>
                        {item.short}
                      </span>
                      <span className="opacity-80 font-normal text-[9.5px] sm:text-[10.5px]">{item.dayNum}</span>
                      {isClosed && (
                        <span className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-amber-600'}`} />
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => changeWeek('next')}
                title="Next Week"
                className="w-6 sm:w-7 h-6 sm:h-7 flex items-center justify-center rounded-lg hover:bg-gray-200/70 text-gray-600 font-bold text-xs sm:text-sm cursor-pointer transition-colors shrink-0"
              >
                ›
              </button>

              <div className="h-3.5 w-px bg-gray-200 mx-0.5 shrink-0" />

              <div className="shrink-0 scale-90 sm:scale-100">
                <PrepDatePicker
                  selectedDate={selectedDateKey}
                  onChange={(newDateStr) => {
                    const picked = new Date(`${newDateStr}T12:00:00`);
                    if (!isNaN(picked.getTime())) setSelectedDate(picked);
                  }}
                  closures={Array.from(closuresSet)}
                />
              </div>
            </div>

            <div className="hidden md:flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 shrink-0">
              <button
                type="button"
                onClick={() => setTab('dispatch')}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                  tab === 'dispatch' ? 'bg-white text-[#5D5FEF] shadow-xs' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Dispatch ({pendingDispatchList.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('ledger')}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                  tab === 'ledger' ? 'bg-white text-[#5D5FEF] shadow-xs' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Ledger
              </button>
            </div>
          </div>
        </div>

        {tab === 'dispatch' && totalStopsCount > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-gray-100 w-full">
            <div className="flex items-center justify-between text-[10.5px] font-bold text-gray-500 mb-0.5">
              <span>Route Progress</span>
              <span className="text-emerald-600">{completedCount} of {totalStopsCount} Delivered ({progressPercent}%)</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* CENTERED CONTENT COLUMN */}
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-3">
        {/* Genuine Errors Only */}
        {errorMsg && (
          <div className="mb-2.5 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between gap-2 animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
            <button type="button" onClick={() => setErrorMsg('')} className="text-rose-500 hover:text-rose-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Floating Sync Toast */}
        {saveStatus !== 'idle' && (
          <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#11142D] text-white text-xs font-semibold shadow-xl border border-white/10 animate-in fade-in slide-in-from-bottom-2 duration-150">
            {saveStatus === 'saving' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 text-[#5D5FEF] animate-spin" />
                <span>Syncing route order...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                <span className="text-slate-200">Route synced</span>
              </>
            )}
          </div>
        )}

        {/* TAB 1: DAILY DISPATCH DRIVER QUEUE */}
        {tab === 'dispatch' && (
          <div className="space-y-2.5">

            {/* ACTION BAR: 2-Tier Stack on Mobile (Zero Clipping) */}
            <div className="bg-white p-2.5 rounded-xl border border-gray-200 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              {/* Primary Navigation Runs: Side-by-side 50/50 Grid on Mobile */}
              <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 w-full sm:w-auto order-1 sm:order-2">
                {routeRuns.map((run, idx) => (
                  <a
                    key={idx}
                    href={run.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`px-3 py-2 sm:py-1.5 text-xs font-black rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 text-center ${
                      run.isReturn
                        ? 'bg-slate-700 hover:bg-slate-800 text-white'
                        : 'bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white'
                    }`}
                  >
                    <Navigation className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{run.label}</span>
                  </a>
                ))}
              </div>

              {/* Secondary Reorder Stops Action: Full Width on Mobile */}
              <button
                type="button"
                onClick={() => setShowOrderSheet(true)}
                className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-xs font-bold rounded-lg border border-[#5D5FEF]/30 bg-[#F4F4FE] text-[#5D5FEF] hover:bg-[#5D5FEF] hover:text-white transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs order-2 sm:order-1 shrink-0"
              >
                <GripVertical className="w-3.5 h-3.5 shrink-0" />
                <span>Reorder Stops ({pendingDispatchList.length})</span>
              </button>
            </div>

            {/* Compact Search Bar */}
            {pendingDispatchList.length > 3 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter stop by name or street..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-medium text-gray-800 placeholder-gray-400 outline-none focus:border-[#5D5FEF] shadow-2xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* DELIVERY CARDS */}
            {filteredDispatchList.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center shadow-xs">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
                <h3 className="text-base font-black text-gray-900">
                  {searchQuery ? 'No matching deliveries' : 'All Deliveries Completed!'}
                </h3>
                <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                  {searchQuery
                    ? `No scheduled customer matches "${searchQuery}".`
                    : 'All scheduled tiffins for today have been marked delivered or skipped.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredDispatchList.map((c, index) => {
                  const used = c.used_credits || 0;
                  const total = c.total_tiffin_credits || 0;
                  const remaining = Math.max(0, total - used);
                  const googleMapsUrl = c.delivery_address
                    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.delivery_address)}`
                    : null;

                  return (
                    <div
                      key={c.id}
                      className="bg-white rounded-2xl border border-gray-200/90 shadow-2xs p-3.5 transition-all"
                    >
                      {/* Top Header: Stop Number + Full Name + Call Button */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-700 text-[11px] font-black flex items-center justify-center shrink-0">
                            {index + 1}
                          </span>
                          <span className="text-[15px] font-black text-[#11142D] capitalize truncate">
                            {c.full_name}
                          </span>

                          {(c.used_credits || 0) === 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-black bg-blue-100 text-blue-800 border border-blue-300 tracking-wide uppercase whitespace-nowrap shrink-0">
                              NEW CUSTOMER
                            </span>
                          )}

                          {c.start_date && selectedDateKey < c.start_date.slice(0, 10) && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 tracking-wide uppercase whitespace-nowrap shrink-0">
                              RENEWED
                            </span>
                          )}
                        </div>

                        {c.phone_number && (
                          <a
                            href={`tel:${c.phone_number}`}
                            title="Call customer"
                            className="h-7 w-7 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100 flex items-center justify-center shadow-2xs transition-colors shrink-0"
                          >
                            <Phone className="w-3.5 h-3.5 text-gray-600" />
                          </a>
                        )}
                      </div>

                      {/* Middle Row: Street Address & Attached Navigation Button */}
                      {c.delivery_address ? (
                        <div className="mt-2 bg-gray-50 border border-gray-200/70 rounded-xl p-2.5 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <span
                                className="text-[13.5px] font-black text-gray-900 block leading-tight break-words"
                                title={c.delivery_address}
                              >
                                📍 {formatStreetOnlyAddress(c.delivery_address)}
                              </span>
                              <span className="text-[11px] font-bold text-gray-500 block mt-0.5">
                                {used}/{total} delivered · <strong className="text-emerald-700">{remaining} left</strong>
                              </span>
                            </div>

                            {googleMapsUrl && (
                              <a
                                href={googleMapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="h-8 px-2.5 rounded-lg bg-[#5D5FEF] hover:bg-[#4D4FD9] text-white font-bold text-xs flex items-center gap-1 shadow-2xs transition-colors shrink-0"
                              >
                                <Navigation className="w-3 h-3" />
                                <span>Map</span>
                              </a>
                            )}
                          </div>

                          {/* Delivery Instructions / Buzzer Code Callout Chip (Driver Logistics Only) */}
                          {c.delivery_instructions && !/(sabji|chicken|dal|paneer|roti|salad|dessert)/i.test(c.delivery_instructions) && (
                            <div className="pt-1.5 border-t border-gray-200/60 flex items-start gap-1.5 text-amber-900 bg-amber-50/80 px-2 py-1.5 rounded-lg border border-amber-200/80">
                              <FileText className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                              <span className="text-[11px] font-semibold leading-snug break-words">
                                <strong className="text-amber-800 font-bold uppercase text-[9.5px] tracking-wide mr-1">Drop-off:</strong>
                                {c.delivery_instructions}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs font-semibold text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200">
                          ⚠️ No address configured for this stop.
                        </p>
                      )}

                      {/* Bottom Action Row */}
                      <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyId === c.id}
                          onClick={() => setProofCustomer(c)}
                          className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-xs sm:text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                        >
                          <Check className="w-4 h-4 stroke-[3] shrink-0" />
                          <span>Mark Delivered</span>
                        </button>

                        <button
                          type="button"
                          disabled={busyId === c.id}
                          onClick={() => handleLogSkip(c.id)}
                          className="h-10 px-3 bg-gray-100 hover:bg-amber-100 text-gray-700 hover:text-amber-800 font-bold text-xs rounded-xl transition-colors border border-gray-200 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* COMPLETED ACCORDION */}
            {completedList.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-2xs mt-4">
                <div className="flex items-center justify-between pb-2 border-b border-gray-100 mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-black uppercase text-gray-700 tracking-wide">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Completed Today ({completedList.length})</span>
                  </div>
                  <span className="text-[11px] text-gray-400">Tap undo if logged in error</span>
                </div>

                <div className="divide-y divide-gray-100">
                  {completedList.map(({ customerId, event, customer: c }) => (
                    <div key={customerId} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-gray-900 block truncate capitalize">
                          {c.full_name}
                        </span>
                        <span className={`text-[10px] font-black uppercase ${
                          event === 'delivered' ? 'text-emerald-600' : 'text-amber-600'
                        }`}>
                          ✓ {event === 'delivered' ? 'Delivered' : 'Skipped'}
                        </span>
                      </div>

                      <button
                        type="button"
                        disabled={busyId === customerId}
                        onClick={() => handleUndo(customerId)}
                        className="px-2.5 py-1 text-xs font-bold text-gray-500 hover:text-rose-600 bg-gray-50 hover:bg-rose-50 border border-gray-200 rounded-lg transition-colors cursor-pointer"
                      >
                        {busyId === customerId ? 'Undoing…' : 'Undo'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* TAB 2: SUBSCRIPTION LEDGER */}
        {tab === 'ledger' && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-2xs overflow-hidden">
            <div className="px-4 sm:px-6 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xs font-black text-gray-700 uppercase tracking-wide">
                Subscription Ledger ({ledgerList.length})
              </h2>
              <span className="text-[11px] text-gray-400">Cycle renewals</span>
            </div>

            {renewedAt && (
              <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 text-emerald-700 text-xs font-bold">
                Plan renewed for {customers.find(c => c.id === renewedAt.id)?.full_name ?? 'customer'}.
              </div>
            )}

            <div className="divide-y divide-gray-100">
              {ledgerList.map(c => {
                const used = c.used_credits || 0;
                const total = c.total_tiffin_credits || 0;
                const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
                const status = (c.subscription_status || 'active').toLowerCase();

                return (
                  <div key={c.id} className="p-3.5 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900 capitalize truncate">{c.full_name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${tierBadge[c.plan_tier || 'weekly']}`}>
                          {planTier(c.plan_tier)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1.5 max-w-xs">
                        <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full bg-[#5D5FEF]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono font-bold text-gray-600 shrink-0">
                          {used}/{total} delivered
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                      {status === 'expired' ? (
                        <button
                          type="button"
                          disabled={busyId === c.id}
                          onClick={() => handleRenewPlan(c.id)}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-[#5D5FEF] hover:bg-[#4D4FD9] rounded-lg shadow-2xs cursor-pointer"
                        >
                          {busyId === c.id ? 'Renewing…' : 'Renew Plan'}
                        </button>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                          status === 'paused' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          {status}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* REORDER MODAL SHEET */}
      {showOrderSheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/40 backdrop-blur-2xs">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-black text-gray-900">Reorder Stops</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">Drag handle or use ▲▼ arrows to adjust stop order</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  title="Copy exact driving sequence from previous active delivery day"
                  onClick={async () => {
                    let lookback = new Date(selectedDate);
                    let prevData = null;
                    let foundKey = '';

                    for (let i = 1; i <= 5; i++) {
                      lookback.setDate(lookback.getDate() - 1);
                      const day = lookback.getDay();
                      if (day === 0 || day === 6) continue;

                      const key = toLocalDateKey(lookback);
                      if (closuresSet.has(key)) continue;

                      const data = await getDeliveryDateData(key);
                      if (data?.routeOrder && data.routeOrder.length > 0) {
                        prevData = data;
                        foundKey = key;
                        break;
                      }
                    }

                    if (prevData?.routeOrder && prevData.routeOrder.length > 0) {
                      const prevIds = prevData.routeOrder;
                      const todayCustomerIds = new Set(allScheduledToday.map(c => c.id));

                      const orderedToday = prevIds.filter(id => todayCustomerIds.has(id));
                      const unsequencedToday = allScheduledToday
                        .filter(c => !prevIds.includes(c.id))
                        .map(c => c.id);

                      const mergedOrder = [...orderedToday, ...unsequencedToday];
                      await saveOrder(mergedOrder);
                      setErrorMsg(`✓ Copied ${orderedToday.length} stops from ${foundKey}`);
                      setTimeout(() => setErrorMsg(''), 4000);
                    } else {
                      setErrorMsg('No previous route sequence found to copy.');
                      setTimeout(() => setErrorMsg(''), 4000);
                    }
                  }}
                  className="px-2.5 py-1 text-xs font-bold text-[#5D5FEF] bg-[#F4F4FE] hover:bg-[#5D5FEF] hover:text-white border border-[#5D5FEF]/30 rounded-lg transition-colors cursor-pointer"
                >
                  ↻ Copy Prev Route
                </button>
                <button
                  type="button"
                  onClick={() => setShowOrderSheet(false)}
                  className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 hover:text-gray-800 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div
              className="flex-1 overflow-y-auto p-3 space-y-1.5"
              onTouchMove={(e) => {
                if (touchStartIndex.current !== null) {
                  handleTouchMove(e);
                }
              }}
              onTouchEnd={handleTouchEnd}
            >
              {pendingDispatchList.map((c, i) => {
                const isDragging = draggedIndex === i;
                const isDragOver = dragOverIndex === i;

                return (
                  <div
                    key={c.id}
                    data-drag-index={i}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDrop={() => handleDrop(i)}
                    className={`px-3 py-2.5 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                      isDragging
                        ? 'opacity-40 bg-gray-50 border-dashed border-indigo-400 scale-[0.98]'
                        : isDragOver
                          ? 'border-indigo-600 bg-indigo-50/70 border-2'
                          : 'bg-white border-gray-200/80 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div
                        onTouchStart={(e) => handleTouchStart(i, e)}
                        className="p-1.5 -ml-1 text-gray-400 hover:text-gray-700 active:text-indigo-600 touch-none cursor-grab active:cursor-grabbing select-none"
                        title="Drag stop"
                      >
                        <GripVertical className="w-4 h-4 shrink-0" />
                      </div>

                      <span className="w-5 h-5 rounded-md bg-gray-100 text-gray-800 text-[11px] font-black flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-gray-900 truncate capitalize">
                            {c.full_name}
                          </span>
                          {(c.used_credits || 0) === 0 && (
                            <span className="px-1 py-0.2 rounded text-[9px] font-black bg-blue-100 text-blue-800 border border-blue-200 uppercase tracking-wide">
                              NEW
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-gray-400 block truncate">
                          {formatStreetOnlyAddress(c.delivery_address)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() => reorderList(i, i - 1)}
                        className="w-7 h-7 rounded-lg bg-gray-50 hover:bg-indigo-50 active:bg-indigo-100 text-gray-600 hover:text-indigo-700 border border-gray-200 disabled:opacity-20 disabled:pointer-events-none flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
                        title="Move Up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={i === pendingDispatchList.length - 1}
                        onClick={() => reorderList(i, i + 1)}
                        className="w-7 h-7 rounded-lg bg-gray-50 hover:bg-indigo-50 active:bg-indigo-100 text-gray-600 hover:text-indigo-700 border border-gray-200 disabled:opacity-20 disabled:pointer-events-none flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
                        title="Move Down"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-3 border-t border-gray-100 bg-gray-50 shrink-0 flex items-center justify-end">
              <button
                type="button"
                onClick={async () => {
                  setShowOrderSheet(false);
                  const orderedIds = pendingDispatchList.map(c => c.id);
                  setSaveStatus('saving');
                  const res = await saveRouteAndPropagateFuture(selectedDateKey, orderedIds);
                  if (res?.success) {
                    setSaveStatus('saved');
                    setTimeout(() => setSaveStatus('idle'), 2500);
                  } else {
                    setErrorMsg(res?.message || 'Failed to sync route');
                    setSaveStatus('idle');
                  }
                }}
                className="px-5 py-2 bg-[#5D5FEF] text-white text-xs font-bold rounded-xl shadow-xs hover:bg-[#4D4FD9] cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELIVERY COMPLETION MODAL */}
      {proofCustomer && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-2xs">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/70">
              <div className="min-w-0">
                <h3 className="text-sm font-black text-gray-900 truncate capitalize">
                  Deliver to {proofCustomer.full_name}
                </h3>
                <p className="text-[11px] text-gray-500 truncate mt-0.5">
                  📍 {formatStreetOnlyAddress(proofCustomer.delivery_address)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProofCustomer(null)}
                className="w-8 h-8 rounded-full bg-gray-200/70 text-gray-600 flex items-center justify-center hover:bg-gray-300 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const used = proofCustomer.used_credits || 0;
              const total = proofCustomer.total_tiffin_credits || 0;
              const remaining = Math.max(0, total - used);
              const isLastDay =
                remaining <= 1 ||
                (proofCustomer.cycle_end_date && proofCustomer.cycle_end_date.slice(0, 10) === selectedDateKey);

              const rawTemplate = isLastDay
                ? msgTemplates.last_day_message_template
                : msgTemplates.delivery_message_template;

              const formattedText = formatDeliveryMessage(rawTemplate, {
                customer_name: proofCustomer.full_name,
                address: formatStreetOnlyAddress(proofCustomer.delivery_address),
                remaining_meals: remaining,
              });

              return (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500 font-semibold">
                      Select an option to notify customer and mark delivery complete:
                    </p>
                    {isLastDay && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-300">
                        Final Delivery
                      </span>
                    )}
                  </div>

                  {proofCustomer.phone_number ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <a
                        href={`whatsapp://send?phone=${cleanPhoneNumberForWhatsApp(proofCustomer.phone_number)}&text=${encodeURIComponent(formattedText)}`}
                        onClick={() => {
                          const id = proofCustomer.id;
                          setProofCustomer(null);
                          handleMarkDelivered(id);
                        }}
                        className="h-12 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>WhatsApp &amp; Complete</span>
                      </a>

                      <a
                        href={`sms:${cleanPhoneNumberForWhatsApp(proofCustomer.phone_number)}?&body=${encodeURIComponent(formattedText)}`}
                        onClick={() => {
                          const id = proofCustomer.id;
                          setProofCustomer(null);
                          handleMarkDelivered(id);
                        }}
                        className="h-12 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Phone className="w-4 h-4" />
                        <span>SMS &amp; Complete</span>
                      </a>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200 font-medium">
                      ⚠ No phone number saved for this customer.
                    </p>
                  )}

                  <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-200/60 text-[11.5px] text-gray-600 leading-snug">
                    <span className="font-bold text-gray-400 not-italic uppercase text-[9.5px] block mb-0.5">Template Preview:</span>
                    <p className="italic">&quot;{formattedText}&quot;</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const id = proofCustomer.id;
                      setProofCustomer(null);
                      handleMarkDelivered(id);
                    }}
                    className="w-full h-11 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer mt-1"
                  >
                    <Check className="w-4 h-4 text-emerald-600 stroke-[3]" />
                    <span>Mark Delivered Without Notifying</span>
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

    </div>
  );
}