export function formatDeliveryMessage(
  template: string,
  params: {
    customer_name: string;
    address?: string | null;
    remaining_meals?: number | null;
  }
): string {
  if (!template) return '';
  return template
    .replace(/{customer_name}/g, params.customer_name || 'there')
    .replace(/{address}/g, params.address || '')
    .replace(/{remaining_meals}/g, String(params.remaining_meals ?? ''));
}