'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

export type CustomTemplate = {
  id: string;
  title: string;
  template: string;
  tag?: string;
  is_pinned?: boolean;
};

export type PlanTierPricing = {
  base_veg: number;
  non_veg_addon: number;
  large_addon: number;
  half_discount: number;
};

export type PlanPricingMatrix = {
  monthly: PlanTierPricing;
  weekly: PlanTierPricing;
  trial: PlanTierPricing;
};

export type AppSettingsPayload = {
  kitchen_name?: string;
  kitchen_address?: string;
  kitchen_lat?: number;
  kitchen_lng?: number;
  delivery_message_template: string;
  last_day_message_template: string;
  friday_message_template?: string;
  friday_double_pack_template?: string;
  custom_message_templates?: CustomTemplate[];
  customer_message_templates?: CustomTemplate[];
  payment_email?: string;
  plan_pricing_matrix?: PlanPricingMatrix;
};

// DO NOT EXPORT THIS - 'use server' files can only export async functions
const DEFAULT_CUSTOMER_PRESETS: CustomTemplate[] = [
  {
    id: 'meals_remaining',
    title: 'Meals Remaining',
    tag: 'INQUIRY',
    template: 'Hi {customer_name}, you currently have {remaining_meals} meals remaining in your cycle.',
  },
  {
    id: 'cycle_end',
    title: 'Cycle End Date',
    tag: 'SCHEDULE',
    template: 'Hi {customer_name}, your current delivery cycle runs until {cycle_end_date}.',
  },
  {
    id: 'balance_summary',
    title: 'Full Balance Summary (Billing Due)',
    tag: 'BILLING DUE',
    template: 'Hi {customer_name}, this is your balance summary: ${amount} CAD is due for {cycle_dates} ({remaining_meals} meals left). Please send Interac e-Transfer to {payment_email}. Thank you!',
  },
  {
    id: 'renewal',
    title: 'Cycle Renewal Notice',
    tag: 'RENEWAL',
    template: 'Hi {customer_name}, your {plan_tier} plan ends on {cycle_end_date}. Please let us know if you would like to renew or make adjustments for next cycle. Thank you!',
  },
  {
    id: 'term_progress',
    title: 'Term Tiffins Remaining',
    tag: 'TERM PROGRESS',
    template: 'Hi {customer_name}, you have {remaining_meals} out of {total_credits} tiffins remaining in your current {plan_tier} term ending on {cycle_end_date}.',
  },
];

const DEFAULT_SETTINGS: AppSettingsPayload = {
  delivery_message_template: 'Hi {customer_name}, your tiffin has been delivered! Enjoy your meal!',
  last_day_message_template:
    'Hello, your tiffin service will be renewed from tomorrow kindly let me know if you would like to make any changes.\n\nThank you',
  friday_message_template: 'Hello {customer_name}, your tiffin has been delivered! Have a wonderful weekend!',
  friday_double_pack_template:
    'Hello {customer_name}, your tiffins have been delivered! Today includes 2 tiffins for Friday and Saturday. Please refrigerate the Saturday meal. Have a great weekend!',
  custom_message_templates: [],
  customer_message_templates: DEFAULT_CUSTOMER_PRESETS,
  kitchen_name: 'Singleton Kitchen Hub',
  kitchen_address: 'Unit 42, 3270 Singleton Ave, London, ON N6L 0E5',
  kitchen_lat: 42.9238,
  kitchen_lng: -81.2782,
  payment_email: 'payments@tiffin.ca',
};

export async function getAppSettings(): Promise<AppSettingsPayload> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('app_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();

    if (error) throw error;
    if (!data) return DEFAULT_SETTINGS;

    return {
      delivery_message_template: data.delivery_message_template || DEFAULT_SETTINGS.delivery_message_template,
      last_day_message_template: data.last_day_message_template || DEFAULT_SETTINGS.last_day_message_template,
      friday_message_template: data.friday_message_template || DEFAULT_SETTINGS.friday_message_template,
      friday_double_pack_template: data.friday_double_pack_template || DEFAULT_SETTINGS.friday_double_pack_template,
      custom_message_templates: data.custom_message_templates || [],
      customer_message_templates:
        Array.isArray(data.customer_message_templates) && data.customer_message_templates.length > 0
          ? data.customer_message_templates
          : DEFAULT_CUSTOMER_PRESETS,
      kitchen_name: data.kitchen_name || DEFAULT_SETTINGS.kitchen_name,
      kitchen_address: data.kitchen_address || DEFAULT_SETTINGS.kitchen_address,
      kitchen_lat: typeof data.kitchen_lat === 'number' ? data.kitchen_lat : DEFAULT_SETTINGS.kitchen_lat,
      kitchen_lng: typeof data.kitchen_lng === 'number' ? data.kitchen_lng : DEFAULT_SETTINGS.kitchen_lng,
      payment_email: data.payment_email || DEFAULT_SETTINGS.payment_email,
    };
  } catch (err) {
    console.error('[getAppSettings] error:', err);
    return DEFAULT_SETTINGS;
  }
}

export async function geocodeKitchenAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const query = encodeURIComponent(address.trim());
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`, {
      headers: { 'User-Agent': 'TiffinOS-KitchenSettings/1.0' },
    });
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
    }
    return null;
  } catch (err) {
    console.error('[geocodeKitchenAddress] error:', err);
    return null;
  }
}

export async function saveAppSettings(settings: AppSettingsPayload): Promise<{ success: boolean; message?: string }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('app_settings').upsert({
      id: 'default',
      delivery_message_template: settings.delivery_message_template,
      last_day_message_template: settings.last_day_message_template,
      friday_message_template: settings.friday_message_template ?? null,
      friday_double_pack_template: settings.friday_double_pack_template ?? null,
      custom_message_templates: settings.custom_message_templates ?? [],
      customer_message_templates: settings.customer_message_templates ?? DEFAULT_CUSTOMER_PRESETS,
      kitchen_name: settings.kitchen_name ?? null,
      kitchen_address: settings.kitchen_address ?? null,
      kitchen_lat: settings.kitchen_lat ?? null,
      kitchen_lng: settings.kitchen_lng ?? null,
      payment_email: settings.payment_email ?? DEFAULT_SETTINGS.payment_email,
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    revalidatePath('/admin/settings');
    revalidatePath('/admin/settings/messaging');
    revalidatePath('/admin/customers');
    revalidatePath('/admin/billing');
    revalidatePath('/admin/deliveries');
    revalidatePath('/prep');
    return { success: true };
  } catch (err: any) {
    console.error('[saveAppSettings] error:', err);
    return { success: false, message: err?.message || 'Failed to save settings' };
  }
}