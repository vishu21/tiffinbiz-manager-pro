'use client';

import React, { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { startGlobalProgress, stopGlobalProgress } from './GlobalProgressBar';

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingText?: string;
  icon?: React.ReactNode;
}

export default function ActionButton({
  loading = false,
  loadingText,
  icon,
  children,
  disabled,
  className = '',
  ...props
}: ActionButtonProps) {
  useEffect(() => {
    if (loading) {
      startGlobalProgress();
    } else {
      stopGlobalProgress();
    }

    // Cleanup: stop progress bar if button is removed/unmounted during transition
    return () => {
      if (loading) {
        stopGlobalProgress();
      }
    };
  }, [loading]);

  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-1.5 transition-all select-none ${
        loading ? 'cursor-wait opacity-80' : isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${className}`}
    >
      {loading ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={2.5} />
          <span>{loadingText || children}</span>
        </>
      ) : (
        <>
          {icon && <span className="shrink-0">{icon}</span>}
          <span>{children}</span>
        </>
      )}
    </button>
  );
}