import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// For use in Server Components, Server Actions, and Route Handlers.
// Reads the session from cookies, so row-level security knows who is asking.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Components cannot set cookies. Safe to ignore once
            // middleware is refreshing the session (added with login).
          }
        },
      },
    }
  )
}
