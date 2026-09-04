import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Next.js explicitly looks for a function named "middleware"
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Role-based redirection logic
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const isDriver = profile?.role === 'Driver'
    const isAdmin = profile?.role === 'Admin'
    const isLoginPage = request.nextUrl.pathname.startsWith('/login')
    const isDriverPath = request.nextUrl.pathname.startsWith('/driver')
    const isAdminPath = request.nextUrl.pathname.startsWith('/admin')

    if (isDriver && !isDriverPath) {
      return NextResponse.redirect(new URL('/driver', request.url))
    }

    if (isAdmin && !isAdminPath) {
      return NextResponse.redirect(new URL('/admin', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/ping|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}