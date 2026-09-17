import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { MapPin } from 'lucide-react'

export default async function DriverDashboard() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetching deliveries joined with customer data
  const { data: deliveries, error } = await supabase
    .from('deliveries')
    .select(`
      id,
      delivery_date,
      status,
      customers (
        name,
        address,
        delivery_instructions,
        dietary_notes
      )
    `)
    .eq('delivery_date', today)
    .order('id', { ascending: true })

  return (
    <main className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-white px-4 py-6 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">Today's Deliveries</h1>
        <p className="text-sm text-gray-500">{today}</p>
      </header>

      <div className="mt-4 space-y-4 px-4">
        {deliveries?.length === 0 && (
          <p className="text-center text-gray-500 mt-10">No deliveries scheduled for today.</p>
        )}

        {deliveries?.map((delivery: any) => (
          <div key={delivery.id} className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-lg font-semibold text-gray-800">
                {delivery.customers?.name}
              </h3>
              <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700">
                {delivery.status}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5" /> Address:
                <p className="text-sm text-gray-700">{delivery.customers?.address}</p>
              </div>

              {delivery.customers?.delivery_instructions && (
                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                  <strong>Notes:</strong> {delivery.customers.delivery_instructions}
                </div>
              )}

              {delivery.customers?.dietary_notes && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  <strong>Dietary:</strong> {delivery.customers.dietary_notes}
                </div>
              )}
            </div>

            <button className="mt-4 w-full rounded-lg bg-green-600 py-2 text-sm font-bold text-white active:bg-green-700">
              Mark as Delivered
            </button>
          </div>
        ))}
      </div>
    </main>
  )
}
