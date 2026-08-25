import { createClient } from '@/lib/supabase/server'

/**
 * The asset catalog.
 *
 * `catalog_assets.workspace_id` is nullable, and the null is meaningful: a null
 * row is a blueprint the operator has published to every tenant, a non-null one
 * is private to that company. The read policy hands back exactly those two
 * groups (`workspace_id = my_workspace() or workspace_id is null`), so this
 * module never filters by workspace — it only splits what arrives into the two
 * shelves the PRD asks for.
 */

export type AssetKind = 'iso' | 'template' | 'blueprint'

export type CatalogAsset = {
  id: string
  workspace_id: string | null
  name: string
  kind: AssetKind
  os: string | null
  size_gb: number
}

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  iso: 'ISO',
  template: 'Template',
  blueprint: 'Blueprint',
}

export type Catalog = {
  /** Operator-published, visible to every tenant. */
  global: CatalogAsset[]
  /** Uploaded by this company, visible to nobody else. */
  tenant: CatalogAsset[]
}

export async function listCatalog(): Promise<Catalog> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('catalog_assets')
    .select('id, workspace_id, name, kind, os, size_gb')
    .order('kind')
    .order('name')

  const assets = ((data ?? []) as CatalogAsset[]).map((a) => ({
    ...a,
    // numeric(10,2) arrives as a string from PostgREST.
    size_gb: Number(a.size_gb),
  }))

  return {
    global: assets.filter((a) => a.workspace_id === null),
    tenant: assets.filter((a) => a.workspace_id !== null),
  }
}
