import { getBusinessBranding } from '../../actions';
import BrandingSettingsClient from './BrandingSettingsClient';

/**
 * Settings → Branding & Appearance.
 *
 * Server component: reads the single `public.business_settings` row (the same
 * source of truth app/layout.tsx stamps onto `<html>`) and hands it to the
 * client editor. `getBusinessBranding` never throws — a missing table resolves
 * to the stock TiffinOS branding, so the page is safe to open before
 * supabase/migrations/00025_add_business_settings.sql is applied.
 */
export default async function BrandingSettingsPage() {
  const branding = await getBusinessBranding();
  return <BrandingSettingsClient initialBranding={branding} />;
}
