export function formatDeliveryMessage(
  template: string,
  variables: {
    customer_name: string;
    address?: string;
    remaining_meals?: number | string;
    day_of_week?: string;
  }
): string {
  let text = template || 'Hello {customer_name}, your tiffin has been delivered!';

  text = text.replace(/{customer_name}/gi, variables.customer_name || 'there');
  text = text.replace(/{address}/gi, variables.address || '');
  text = text.replace(/{remaining_meals}/gi, String(variables.remaining_meals ?? ''));
  text = text.replace(/{day_of_week}/gi, variables.day_of_week || '');

  return text.trim();
}