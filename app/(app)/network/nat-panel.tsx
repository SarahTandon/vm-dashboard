'use client'

import { useActionState, useCallback, useEffect, useState } from 'react'
import type { NatRule } from '@/lib/network'
import {
  createNatRule,
  deleteNatRule,
  setNatRuleEnabled,
  updateNatRule,
  type RuleFormState,
} from './actions'
import styles from './network.module.css'

const COLUMNS = 7

const KIND_BLURB: Record<NatRule['kind'], string> = {
  snat: 'outbound — internal source rewritten to the public address',
  dnat: 'inbound — public address forwarded to an internal machine',
}

function Row({ rule, onEdit }: { rule: NatRule; onEdit: (id: string) => void }) {
  const [toggleState, toggleAction, togglePending] = useActionState<
    RuleFormState,
    FormData
  >(setNatRuleEnabled, null)
  const [deleteState, deleteAction, deletePending] = useActionState<
    RuleFormState,
    FormData
  >(deleteNatRule, null)

  const error = toggleState?.error ?? deleteState?.error ?? null

  return (
    <>
      <tr className={rule.enabled ? undefined : styles.off}>
        <td>
          <span
            className={`${styles.pill} ${styles.pillNeutral}`}
            title={KIND_BLURB[rule.kind]}
          >
            {rule.kind}
          </span>
        </td>
        <td className={styles.mono}>{rule.internal_ip}</td>
        <td className={styles.mono}>{rule.external_ip}</td>
        <td className={`${styles.mono} ${styles.numeric}`}>
          {rule.internal_port ?? <span className="muted">—</span>}
        </td>
        <td className={`${styles.mono} ${styles.numeric}`}>
          {rule.external_port ?? <span className="muted">—</span>}
        </td>
        <td className={styles.keep}>
          <form action={toggleAction} className={styles.inlineForm}>
            <input type="hidden" name="id" value={rule.id} />
            <input
              type="hidden"
              name="enabled"
              value={rule.enabled ? 'false' : 'true'}
            />
            <button
              type="submit"
              disabled={togglePending}
              className={`${styles.toggle} ${
                rule.enabled ? styles.toggleOn : styles.toggleOff
              }`}
              title={
                rule.enabled ? 'Disable this mapping' : 'Enable this mapping'
              }
            >
              {togglePending ? '…' : rule.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </form>
        </td>
        <td className={`${styles.actionsCell} ${styles.keep}`}>
          <div className={styles.rowButtons}>
            <button type="button" onClick={() => onEdit(rule.id)}>
              Edit
            </button>
            <form action={deleteAction} className={styles.inlineForm}>
              <input type="hidden" name="id" value={rule.id} />
              <button
                type="submit"
                className={styles.danger}
                disabled={deletePending}
              >
                {deletePending ? 'Removing…' : 'Delete'}
              </button>
            </form>
          </div>
        </td>
      </tr>
      {error && (
        <tr className={styles.errorRow}>
          <td colSpan={COLUMNS}>
            <p className={styles.rowError} role="alert">
              {error}
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

function Editor({ rule, onDone }: { rule: NatRule | null; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<RuleFormState, FormData>(
    rule ? updateNatRule : createNatRule,
    null
  )

  useEffect(() => {
    if (state && state.error === null) onDone()
  }, [state, onDone])

  return (
    <form action={formAction} className={styles.editor}>
      {rule && <input type="hidden" name="id" value={rule.id} />}

      <h3 className={styles.editorTitle}>
        {rule
          ? `Edit ${rule.kind.toUpperCase()} mapping`
          : 'New address mapping'}
      </h3>

      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="nat-kind">Kind</label>
          <select id="nat-kind" name="kind" defaultValue={rule?.kind ?? 'dnat'}>
            <option value="dnat">DNAT (inbound)</option>
            <option value="snat">SNAT (outbound)</option>
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="nat-internal-ip">Internal IP</label>
          <input
            id="nat-internal-ip"
            name="internal_ip"
            required
            defaultValue={rule?.internal_ip ?? ''}
            placeholder="192.168.1.11"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="nat-external-ip">External IP</label>
          <input
            id="nat-external-ip"
            name="external_ip"
            required
            defaultValue={rule?.external_ip ?? ''}
            placeholder="198.51.100.11"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="nat-internal-port">Internal port</label>
          <input
            id="nat-internal-port"
            name="internal_port"
            inputMode="numeric"
            defaultValue={rule?.internal_port ?? ''}
            placeholder="—"
          />
          <span className={styles.hint}>Blank for a whole-address SNAT.</span>
        </div>

        <div className={styles.field}>
          <label htmlFor="nat-external-port">External port</label>
          <input
            id="nat-external-port"
            name="external_port"
            inputMode="numeric"
            defaultValue={rule?.external_port ?? ''}
            placeholder="—"
          />
        </div>

        <div className={styles.checkField}>
          <input
            id="nat-enabled"
            name="enabled"
            type="checkbox"
            defaultChecked={rule ? rule.enabled : true}
          />
          <label htmlFor="nat-enabled">Enabled</label>
        </div>
      </div>

      {state?.error && (
        <p className={styles.formError} role="alert">
          {state.error}
        </p>
      )}

      <div className={styles.editorButtons}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? 'Saving…' : rule ? 'Save mapping' : 'Add mapping'}
        </button>
        <button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** SNAT and DNAT mappings between private addresses and public IPs. */
export function NatPanel({ rules }: { rules: NatRule[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const closeEditor = useCallback(() => setEditing(null), [])

  const editingRule =
    editing && editing !== 'new'
      ? (rules.find((r) => r.id === editing) ?? null)
      : null
  const editorOpen = editing === 'new' || editingRule !== null

  return (
    <section className="panel">
      <div className={styles.panelHead}>
        <div>
          <h2>Public address mapping</h2>
          <p className="muted small">
            SNAT gives internal machines an outbound identity; DNAT publishes
            one to the internet.
          </p>
        </div>
        <button
          type="button"
          className={styles.primary}
          onClick={() => setEditing('new')}
          disabled={editing === 'new'}
        >
          Add mapping
        </button>
      </div>

      {rules.length === 0 ? (
        <p className={styles.empty}>
          No NAT rules — nothing in this workspace is published to a public
          address.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Internal IP</th>
                <th scope="col">External IP</th>
                <th scope="col">Internal port</th>
                <th scope="col">External port</th>
                <th scope="col">State</th>
                <th scope="col">
                  <span className={styles.rowButtons}>Manage</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <Row key={rule.id} rule={rule} onEdit={setEditing} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editorOpen && (
        <Editor
          key={editingRule?.id ?? 'new'}
          rule={editingRule}
          onDone={closeEditor}
        />
      )}
    </section>
  )
}
