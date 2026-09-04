'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

function addWorkingDays(startDate: Date, days: number): Date {
  let result = new Date(startDate)
  let added = 1 // Start date counts as the first delivery
  while (added < days) {
    result.setDate(result.getDate() + 1)
    const day = result.getDay()
    if (day !== 0 && day !== 6) { // 0=Sunday, 6=Saturday
      added++
    }
  }
  return result
}

export async function createSubscription(formData: FormData) {
  const supabase = await createClient()

  const customer_id = formData.get('customer_id') as string
  const plan_type = formData.get('plan_type') as string
  const start_date_str = formData.get('start_date') as string
  const start_date = new Date(start_date_str)

  // Determine number of delivery days per plan
  let deliveryDays = 1
  if (plan_type === 'Weekly') deliveryDays = 5
  if (plan_type === 'Monthly') deliveryDays = 20

  const end_date = addWorkingDays(start_date, deliveryDays)

  const { error } = await supabase
    .from('subscriptions')
    .insert([{
      customer_id,
      plan_type,
      start_date: start_date.toISOString().split('T')[0],
      end_date: end_date.toISOString().split('T')[0],
      status: 'Active'
    }])

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/admin/subscriptions')
}