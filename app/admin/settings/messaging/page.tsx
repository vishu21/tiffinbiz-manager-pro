import { getAppSettings } from '../actions';
import MessagingSettingsClient from './MessagingSettingsClient';

export default async function MessagingSettingsPage() {
  const settings = await getAppSettings();
  return <MessagingSettingsClient initialSettings={settings} />;
}