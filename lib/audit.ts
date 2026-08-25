import { createClient } from '@/lib/supabase/server'

/**
 * Record an action in the audit log.
 *
 * The insert policy requires actor_id to be the caller and workspace_id to be
 * their own workspace, so a forged entry is rejected by the database rather
 * than trusted from here.
 *
 * Never throws: a failed log entry must not fail the action it describes.
 */
export async function recordAudit(
  action: string,
  detail: Record<string, unknown> = {},
  targetId?: string
): Promise<void> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', user.id)
      .single()
    if (!profile) return

    await supabase.from('audit_log').insert({
      workspace_id: profile.workspace_id,
      actor_id: user.id,
      action,
      target_id: targetId ?? null,
      detail,
    })
  } catch {
    // Deliberately swallowed.
  }
}
