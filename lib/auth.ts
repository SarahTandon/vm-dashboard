import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type Role = 'admin' | 'user'

export type CurrentUser = {
  id: string
  workspaceId: string
  fullName: string
  email: string
  role: Role
  workspaceName: string
  vcpuLimit: number
  ramGbLimit: number
  commitmentTier: string
  rpoSeconds: number
}

// The single place a page asks "who is looking at this?".
// Redirects to login rather than returning null, so callers can rely on it.
export async function requireUser(): Promise<CurrentUser> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, workspace_id, full_name, email, role')
    .eq('id', user.id)
    .single()

  // Signed in with Supabase but no matching row in our users table — the
  // account exists without a company, so there is nothing it may see.
  if (!profile) redirect('/login?error=no-profile')

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('name, vcpu_limit, ram_gb_limit, commitment_tier, rpo_seconds')
    .eq('id', profile.workspace_id)
    .single()

  return {
    id: profile.id,
    workspaceId: profile.workspace_id,
    fullName: profile.full_name,
    email: profile.email,
    role: profile.role as Role,
    workspaceName: workspace?.name ?? 'Unknown workspace',
    vcpuLimit: workspace?.vcpu_limit ?? 0,
    ramGbLimit: workspace?.ram_gb_limit ?? 0,
    commitmentTier: workspace?.commitment_tier ?? 'on_demand',
    rpoSeconds: workspace?.rpo_seconds ?? 0,
  }
}
