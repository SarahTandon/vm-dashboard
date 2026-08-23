import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { signOut } from '@/app/login/actions'

// Every page inside (app) is behind a login. The proxy redirects anonymous
// visitors before they get here; requireUser is the second check.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()

  // Admin-only sections. This hides the links; the database is what actually
  // refuses the data, so a hand-typed URL gets an empty page, not a leak.
  const links = [
    { href: '/', label: 'Overview', admin: false },
    { href: '/compute', label: 'Compute', admin: false },
    { href: '/storage', label: 'Storage & DR', admin: true },
    { href: '/network', label: 'Networking', admin: true },
    { href: '/insights', label: 'Insights', admin: false },
  ].filter((l) => !l.admin || user.role === 'admin')

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">VMaaS</div>

        <nav>
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="whoami">
          <div className="whoami-name">{user.fullName}</div>
          <div className="muted small">{user.workspaceName}</div>
          <span className={`badge badge-${user.role}`}>{user.role}</span>
          <form action={signOut}>
            <button type="submit" className="linkish">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  )
}
