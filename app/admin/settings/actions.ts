'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

export type CustomTemplate = {
  id: string;
  title: string;
  template: string;
};

export type AppSettingsPayload = {
  delivery_message_template: string;
  last_day_message_template: string;
  friday_message_template?: string;
  friday_double_pack_template?: string;
  custom_message_templates?: CustomTemplate[];
  kitchen_name: string;
  kitchen_address: string;
  kitchen_lat: number;
  kitchen_lng: number;
};

const DEFAULT_SETTINGS: AppSettingsPayload = {
  delivery_message_template: 'Hi {customer_name}, your tiffin has been delivered! Enjoy your meal!',
  last_day_message_template:
    'Hello, your tiffin service will be renewed from tomorrow kindly let me know if you would like to make any changes.\n\nThank you',
  friday_message_template: 'Hello {customer_name}, your tiffin has been delivered! Have a wonderful weekend!',
  friday_double_pack_template:
    'Hello {customer_name}, your tiffins have been delivered! Today includes 2 tiffins for Friday and Saturday. Please refrigerate the Saturday meal. Have a great weekend!',
  custom_message_templates: [],
  kitchen_name: 'Singleton Kitchen Hub',
  kitchen_address: 'Unit 42, 3270 Singleton Ave, London, ON N6L 0E5',
  kitchen_lat: 42.9238,
  kitchen_lng: -81.2782,
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
      kitchen_name: data.kitchen_name || DEFAULT_SETTINGS.kitchen_name,
      kitchen_address: data.kitchen_address || DEFAULT_SETTINGS.kitchen_address,
      kitchen_lat: typeof data.kitchen_lat === 'number' ? data.kitchen_lat : DEFAULT_SETTINGS.kitchen_lat,
      kitchen_lng: typeof data.kitchen_lng === 'number' ? data.kitchen_lng : DEFAULT_SETTINGS.kitchen_lng,
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
      kitchen_name: settings.kitchen_name,
      kitchen_address: settings.kitchen_address,
      kitchen_lat: settings.kitchen_lat,
      kitchen_lng: settings.kitchen_lng,
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    revalidatePath('/admin/settings');
    revalidatePath('/admin/deliveries');
    revalidatePath('/prep');
    return { success: true };
  } catch (err: any) {
    console.error('[saveAppSettings] error:', err);
    return { success: false, message: err?.message || 'Failed to save settings' };
  }
}