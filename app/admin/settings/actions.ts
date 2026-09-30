'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

export type DriverMessageSettings = {
  delivery_message_template: string;
  last_day_message_template: string;
};

const DEFAULT_SETTINGS: DriverMessageSettings = {
  delivery_message_template: 'Hi {customer_name}, your tiffin has been delivered! Enjoy your meal!',
  last_day_message_template: 'Hi {customer_name}, your tiffin has been delivered! Today is your final delivery for this cycle. Please leave your empty tiffin bag out for collection.',
};

export async function getDriverMessageSettings(): Promise<DriverMessageSettings> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('app_settings')
      .select('delivery_message_template, last_day_message_template')
      .eq('id', 'default')
      .maybeSingle();

    if (error || !data) return DEFAULT_SETTINGS;
    return {
      delivery_message_template: data.delivery_message_template || DEFAULT_SETTINGS.delivery_message_template,
      last_day_message_template: data.last_day_message_template || DEFAULT_SETTINGS.last_day_message_template,
    };
  } catch (err) {
    console.error('[getDriverMessageSettings] error:', err);
    return DEFAULT_SETTINGS;
  }
}

export async function saveDriverMessageSettings(settings: DriverMessageSettings): Promise<{ success: boolean; message?: string }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('app_settings').upsert({
      id: 'default',
      delivery_message_template: settings.delivery_message_template,
      last_day_message_template: settings.last_day_message_template,
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    revalidatePath('/admin/settings');
    revalidatePath('/admin/deliveries');
    return { success: true };
  } catch (err: any) {
    console.error('[saveDriverMessageSettings] error:', err);
    return { success: false, message: err?.message || 'Failed to save settings' };
  }
}