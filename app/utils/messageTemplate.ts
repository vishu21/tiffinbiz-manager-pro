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
    next_service_date?: string; // <-- 1. Added variable type definition
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
  // <-- 2. Added replacement for {next_service_date}
  text = text.replace(
    /\{next_service_date\}/gi,
    variables.next_service_date || 'your next scheduled delivery day'
  );

  return text.trim();
}