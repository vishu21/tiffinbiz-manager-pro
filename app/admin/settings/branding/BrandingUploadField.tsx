'use client';

import { useRef, useState } from 'react';
import { Link2, Loader2, Upload, X } from 'lucide-react';
import { useToast } from '@/app/components/ToastProvider';
import {
  isBrandingAssetTooLarge,
  uploadBrandingAsset,
  type BrandingAssetPrefix,
} from '@/app/utils/brandingUpload';

/**
 * BrandingUploadField — one asset row of the Branding & Appearance form.
 *
 * Layout: `[ text input ] [ Upload button ] [ preview square ]` — paste a URL
 * or pick a file from the device; a picked file is pushed to the Supabase
 * Storage `branding` bucket (app/utils/brandingUpload.ts) and the resolved
 * public URL is written straight back into the *same* form field, so the
 * existing dirty-state tracking (`JSON.stringify(editableBranding(form))` in
 * BrandingSettingsClient) lights up "Save Changes" the instant an upload lands.
 *
 * Zero layout shift is the reason this is one component instead of three
 * inline blocks:
 *   • the preview square is a fixed 2.5rem, so swapping break/clear never
 *     reflows the row — the ✕ badge is absolutely positioned outside it;
 *   • the Upload button keeps a `min-w-[7.5rem]` and swaps only its label
 *     ("Upload" ⇄ "Uploading…"), so the spinner can never widen the row;
 *   • the file input is `hidden` (display:none), never an in-flow control.
 *
 * Fallback previewing: pass `fallbackValue` (the logo, for the favicon field)
 * to render the *effective* icon dimmed while the field itself is empty. The ✕
 * only ever appears for the field's own asset, so clearing never clears a
 * fallback the operator cannot see.
 */

export type BrandingUploadFieldProps = {
  /** Ties the <label> to the text input. */
  id: string;
  label: string;
  /** Leading label/input icon (lucide component, same contract as the sidebar tone cards). */
  Icon: typeof Link2;
  /** Current field value (URL or ''). */
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** `accept` list for the hidden file picker. */
  accept: string;
  /** Storage path prefix — `logo` or `favicon`. */
  prefix: BrandingAssetPrefix;
  /** Human name used in toasts, e.g. "Logo". */
  assetName: string;
  /** Rendered dimmed in the preview square while the field is empty (e.g. logo → favicon fallback). */
  fallbackValue?: string;
  /** Helper / status paragraphs rendered under the row. */
  children?: React.ReactNode;
};

export default function BrandingUploadField({
  id,
  label,
  Icon,
  value,
  onChange,
  placeholder,
  accept,
  prefix,
  assetName,
  fallbackValue,
  children,
}: BrandingUploadFieldProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const asset = value.trim();
  const fallback = (fallbackValue ?? '').trim();
  /** What the square actually shows: this asset, else the inherited fallback. */
  const preview = asset || fallback;
  const isPreviewFallback = !asset && Boolean(fallback);

  const handleFile = async (file: File) => {
    // Guard the 2MB ceiling client-side so a doomed upload never hits the wire
    // (the bucket enforces the same limit server-side).
    if (isBrandingAssetTooLarge(file)) {
      showToast('Image must be under 2MB', 'error');
      return;
    }

    setIsUploading(true);
    try {
      const publicUrl = await uploadBrandingAsset(file, prefix);
      onChange(publicUrl);
      showToast(`${assetName} uploaded — save your changes to publish it.`);
    } catch (err) {
      showToast(
        err instanceof Error && err.message ? err.message : `${assetName} upload failed.`,
        'error'
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleClear = () => onChange('');

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-gray-400" />
        {label}
      </label>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Icon className="w-3.5 h-3.5 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id={id}
            type="text"
            value={value}
            spellCheck={false}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-8 pr-3 py-2.5 text-xs font-semibold text-gray-900 bg-white border border-gray-200 rounded-xl focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none transition-colors"
          />
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          aria-busy={isUploading}
          className="shrink-0 min-w-[7.5rem] inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isUploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          <span>{isUploading ? 'Uploading…' : 'Upload'}</span>
        </button>

        <div className="relative shrink-0">
          <span
            role="img"
            aria-label={preview ? `${assetName} preview` : `No ${assetName.toLowerCase()} set`}
            title={
              isPreviewFallback
                ? `Using the logo as the ${assetName.toLowerCase()}`
                : preview
                  ? `${assetName} preview`
                  : `No ${assetName.toLowerCase()} set`
            }
            className={`block w-10 h-10 rounded-xl border border-gray-200 bg-gray-50 bg-center bg-contain bg-no-repeat ${
              isPreviewFallback ? 'opacity-60' : ''
            }`}
            style={preview ? { backgroundImage: `url("${preview}")` } : undefined}
          />

          {asset ? (
            <button
              type="button"
              onClick={handleClear}
              aria-label={`Clear ${assetName.toLowerCase()}`}
              title={`Clear ${assetName.toLowerCase()}`}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-md hover:bg-rose-600 transition-colors cursor-pointer"
            >
              <X className="w-2.5 h-2.5 stroke-[3]" />
            </button>
          ) : null}
        </div>

        {/* Hidden picker — clicks are proxied by the Upload button above. The
            value is reset on every change so the same file can be re-picked
            after a clear (a stale selection fires no second `change`). */}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          disabled={isUploading}
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleFile(file);
          }}
        />
      </div>

      {children}
    </div>
  );
}

