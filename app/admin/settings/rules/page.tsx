import { createClient } from '@/utils/supabase/server';
import RulesSettingsClient from './RulesSettingsClient';
import { DEFAULT_PRICING_MATRIX, type PlanPricingMatrix } from '@/app/utils/subscriptionCycle';

export default async function RulesSettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('app_settings')
    .select('plan_pricing_matrix')
    .eq('id', 'default')
    .maybeSingle();

  const pricingMatrix: PlanPricingMatrix =
    data?.plan_pricing_matrix || DEFAULT_PRICING_MATRIX;

  return <RulesSettingsClient initialMatrix={pricingMatrix} />;
}