export function formatDeliveryMessage(
  template: string,
  variables: {
    customer_name?: string;
    address?: string;
    remaining_meals?: number | string;
    day_of_week?: string;
    cycle_end_date?: string;
    total_credits?: number | string;
    used_credits?: number | string;
  }
): string {
  let text = template || 'Hello {customer_name}, your tiffin has been delivered!';

  text = text.replace(/\{customer_name\}/gi, variables.customer_name || 'there');
  text = text.replace(/\{address\}/gi, variables.address || '');
  text = text.replace(/\{remaining_meals\}/gi, String(variables.remaining_meals ?? ''));
  text = text.replace(/\{day_of_week\}/gi, variables.day_of_week || '');
  text = text.replace(/\{cycle_end_date\}/gi, variables.cycle_end_date || '');
  text = text.replace(/\{total_credits\}/gi, String(variables.total_credits ?? ''));
  text = text.replace(/\{used_credits\}/gi, String(variables.used_credits ?? ''));

  return text.trim();
}