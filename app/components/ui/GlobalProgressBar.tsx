'use client';

import React, { useEffect, useState } from 'react';

// Custom event-based trigger so any component can start/stop it
export const startGlobalProgress = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:progress:start'));
  }
};

export const stopGlobalProgress = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:progress:stop'));
  }
};

export default function GlobalProgressBar() {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    const handleStart = () => {
      setVisible(true);
      setProgress(15);

      // Smoothly advance the bar while work is pending
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return prev;
          const remaining = 90 - prev;
          return prev + Math.max(1, Math.floor(remaining * 0.15));
        });
      }, 250);
    };

    const handleStop = () => {
      clearInterval(interval);
      setProgress(100);
      const timer = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 350);
      return () => clearTimeout(timer);
    };

    window.addEventListener('app:progress:start', handleStart);
    window.addEventListener('app:progress:stop', handleStop);

    return () => {
      clearInterval(interval);
      window.removeEventListener('app:progress:start', handleStart);
      window.removeEventListener('app:progress:stop', handleStop);
    };
  }, []);

  if (!visible && progress === 0) return null;

  return (
    <div
      style={{ zIndex: 9999999 }}
      className="fixed top-0 left-0 right-0 h-1 bg-transparent pointer-events-none"
    >
      <div
        className="h-full bg-indigo-600 shadow-[0_0_12px_#4f46e5,0_0_4px_#4f46e5] transition-all duration-300 ease-out"
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  );
}