'use client'

import { useActionState, useCallback, useEffect, useState } from 'react'
import type { FirewallRule } from '@/lib/network'
import {
  createFirewallRule,
  deleteFirewallRule,
  setFirewallRuleEnabled,
  updateFirewallRule,
  type RuleFormState,
} from './actions'
import styles from './network.module.css'

const COLUMNS = 9

function nextPriority(rules: FirewallRule[]): number {
  if (rules.length === 0) return 100
  const highest = Math.max(...rules.map((r) => r.priority))
  return Math.min(highest + 100, 65535)
}

function Row({
  rule,
  onEdit,
}: {
  rule: FirewallRule
  onEdit: (id: string) => void
}) {
  const [toggleState, toggleAction, togglePending] = useActionState<
    RuleFormState,
    FormData
  >(setFirewallRuleEnabled, null)
  const [deleteState, deleteAction, deletePending] = useActionState<
    RuleFormState,
    FormData
  >(deleteFirewallRule, null)

  const error = toggleState?.error ?? deleteState?.error ?? null

  return (
    <>
      <tr className={rule.enabled ? undefined : styles.off}>
        <td className={styles.numeric}>{rule.priority}</td>
        <td>
          <span
            className={`${styles.pill} ${
              rule.action === 'allow' ? styles.pillAllow : styles.pillDeny
            }`}
          >
            {rule.action}
          </span>
        </td>
        <td>{rule.direction}</td>
        <td className={styles.mono}>{rule.protocol}</td>
        <td className={styles.mono}>{rule.source}</td>
        <td className={styles.mono}>{rule.destination}</td>
        <td className={styles.mono}>{rule.port_range}</td>
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
                rule.enabled
                  ? 'Disable this rule'
                  : 'Enable this rule'
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

function Editor({
  rule,
  defaultPriority,
  onDone,
}: {
  rule: FirewallRule | null
  defaultPriority: number
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<RuleFormState, FormData>(
    rule ? updateFirewallRule : createFirewallRule,
    null
  )

  // The action returns a null error only when the row was actually written,
  // and revalidatePath has already refreshed the table by then, so closing
  // the editor is all that is left to do.
  useEffect(() => {
    if (state && state.error === null) onDone()
  }, [state, onDone])

  return (
    <form action={formAction} className={styles.editor}>
      {rule && <input type="hidden" name="id" value={rule.id} />}

      <h3 className={styles.editorTitle}>
        {rule ? `Edit rule ${rule.priority}` : 'New firewall rule'}
      </h3>

      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="fw-priority">Priority</label>
          <input
            id="fw-priority"
            name="priority"
            inputMode="numeric"
            required
            defaultValue={rule ? rule.priority : defaultPriority}
          />
          <span className={styles.hint}>Unique. Lowest matches first.</span>
        </div>

        <div className={styles.field}>
          <label htmlFor="fw-action">Action</label>
          <select
            id="fw-action"
            name="action"
            defaultValue={rule?.action ?? 'allow'}
          >
            <option value="allow">allow</option>
            <option value="deny">deny</option>
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="fw-direction">Direction</label>
          <select
            id="fw-direction"
            name="direction"
            defaultValue={rule?.direction ?? 'inbound'}
          >
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="fw-protocol">Protocol</label>
          <input
            id="fw-protocol"
            name="protocol"
            defaultValue={rule?.protocol ?? 'any'}
            placeholder="any"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="fw-source">Source</label>
          <input
            id="fw-source"
            name="source"
            defaultValue={rule?.source ?? 'any'}
            placeholder="any"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="fw-destination">Destination</label>
          <input
            id="fw-destination"
            name="destination"
            defaultValue={rule?.destination ?? 'any'}
            placeholder="any"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="fw-ports">Port range</label>
          <input
            id="fw-ports"
            name="port_range"
            defaultValue={rule?.port_range ?? 'any'}
            placeholder="any"
          />
          <span className={styles.hint}>e.g. 443, 80,443 or 8000-8100</span>
        </div>

        <div className={styles.checkField}>
          <input
            id="fw-enabled"
            name="enabled"
            type="checkbox"
            defaultChecked={rule ? rule.enabled : true}
          />
          <label htmlFor="fw-enabled">Enabled</label>
        </div>
      </div>

      {state?.error && (
        <p className={styles.formError} role="alert">
          {state.error}
        </p>
      )}

      <div className={styles.editorButtons}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? 'Saving…' : rule ? 'Save rule' : 'Add rule'}
        </button>
        <button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/**
 * North-South edge firewall rules, in priority order.
 *
 * East-West micro-segmentation is deferred to v1.1 and is deliberately absent.
 */
export function FirewallPanel({ rules }: { rules: FirewallRule[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const closeEditor = useCallback(() => setEditing(null), [])

  const editingRule =
    editing && editing !== 'new'
      ? (rules.find((r) => r.id === editing) ?? null)
      : null

  // A row can disappear under an open editor if it was deleted elsewhere.
  const editorOpen = editing === 'new' || editingRule !== null

  return (
    <section className="panel">
      <div className={styles.panelHead}>
        <div>
          <h2>Edge firewall</h2>
          <p className="muted small">
            North-South rules, evaluated in priority order. East-West
            micro-segmentation is deferred to v1.1.
          </p>
        </div>
        <button
          type="button"
          className={styles.primary}
          onClick={() => setEditing('new')}
          disabled={editing === 'new'}
        >
          Add rule
        </button>
      </div>

      {rules.length === 0 ? (
        <p className={styles.empty}>
          No firewall rules yet — everything falls through to the platform
          default.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Priority</th>
                <th scope="col">Action</th>
                <th scope="col">Direction</th>
                <th scope="col">Protocol</th>
                <th scope="col">Source</th>
                <th scope="col">Destination</th>
                <th scope="col">Ports</th>
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
          defaultPriority={nextPriority(rules)}
          onDone={closeEditor}
        />
      )}
    </section>
  )
}
