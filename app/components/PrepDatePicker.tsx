'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Calendar } from 'lucide-react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

interface PrepDatePickerProps {
  selectedDate: string; // 'YYYY-MM-DD'
  onChange: (dateStr: string) => void;
  closures?: string[]; // optional array of closed 'YYYY-MM-DD' dates to highlight in amber
}

export default function PrepDatePicker({
  selectedDate,
  onChange,
  closures = [],
}: PrepDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Set initial month view based on the selected date
  const [viewDate, setViewDate] = useState<Date>(() => {
    return selectedDate ? new Date(`${selectedDate}T12:00:00`) : new Date();
  });

  // Keep calendar month view synchronized whenever selectedDate changes
  useEffect(() => {
    if (selectedDate) {
      const parsed = new Date(`${selectedDate}T12:00:00`);
      if (!isNaN(parsed.getTime())) {
        setViewDate(parsed);
      }
    }
  }, [selectedDate]);

  const containerRef = useRef<HTMLDivElement>(null);

  // Derive "today" string
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const closedSet = new Set(closures);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
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

  const jumpToToday = () => {
    onChange(todayStr);
    setViewDate(new Date());
    setIsOpen(false);
  };

  const handleSelectDate = (dateStr: string) => {
    onChange(dateStr);
    setIsOpen(false);
  };

  // Format header display (e.g., "Sep 17, 2026")
  const displayLabel = selectedDate
    ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Select Date';

  // Build Month Grid (Sunday-first)
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1, 12, 0, 0);
  const startingDay = firstDay.getDay(); // 0 = Sun, 1 = Mon ...
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < startingDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      {/* TRIGGER BUTTON */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        title="Open calendar picker"
        className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer text-sm ${
          isOpen ? 'bg-[#5D5FEF] text-white' : 'hover:bg-gray-200/80 text-gray-600'
        }`}
      >
        <Calendar className="w-4 h-4" />
      </button>

      {/* POPOVER CALENDAR */}
      {isOpen && (
        <div 
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-2xl shadow-2xl p-4 z-[9999] w-72 select-none animate-in fade-in slide-in-from-top-2"
        >
          {/* Header Navigation */}
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
            <span className="text-xs font-extrabold text-gray-800 tracking-tight">
              {MONTH_NAMES[month]} {year}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={prevMonth}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 font-bold cursor-pointer"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={nextMonth}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 font-bold cursor-pointer"
              >
                ›
              </button>
            </div>
          </div>

          {/* Sunday-first Column Headers */}
          <div className="grid grid-cols-7 text-center text-[11px] font-bold text-gray-400 mb-1.5">
            <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
          </div>

          {/* Month Days Matrix */}
          <div className="grid grid-cols-7 gap-y-1 text-xs">
            {days.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="h-8 w-8" />;
              }

              const currentStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isSelected = currentStr === selectedDate;
              const isToday = currentStr === todayStr;
              const isClosed = closedSet.has(currentStr);

              return (
                <button
                  key={currentStr}
                  type="button"
                  onClick={() => handleSelectDate(currentStr)}
                  className={`h-8 w-8 mx-auto flex flex-col items-center justify-center font-semibold rounded-full transition-all relative cursor-pointer
                    ${isSelected ? '!bg-[#5D5FEF] !text-white font-extrabold shadow-xs' : ''}
                    ${!isSelected && isClosed ? 'bg-amber-100 text-amber-900 font-bold hover:bg-amber-200' : ''}
                    ${!isSelected && !isClosed ? 'hover:bg-gray-100 text-gray-700' : ''}
                    ${isToday && !isSelected ? 'border border-[#5D5FEF] text-[#5D5FEF] font-black' : ''}
                  `}
                >
                  <span className="leading-none">{day}</span>
                  {/* Subtle dots */}
                  {isToday && !isSelected && (
                    <span className="w-1 h-1 rounded-full bg-[#5D5FEF] mt-0.5" />
                  )}
                  {isClosed && !isSelected && (
                    <span className="w-1 h-1 rounded-full bg-amber-600 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Quick Action Footer */}
          <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-gray-400 font-medium">
              <span className="w-2 h-2 rounded-full border border-[#5D5FEF] inline-block" /> Today
              {closures.length > 0 && (
                <span className="flex items-center gap-1.5 ml-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Closed
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={jumpToToday}
              className="text-[#5D5FEF] font-bold hover:underline cursor-pointer"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}