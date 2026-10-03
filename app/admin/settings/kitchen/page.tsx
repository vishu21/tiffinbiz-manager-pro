import { getAppSettings } from '../actions';
import KitchenSettingsClient from './KitchenSettingsClient';

export default async function KitchenSettingsPage() {
  const settings = await getAppSettings();
  return <KitchenSettingsClient initialSettings={settings} />;
}