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

  // Every section is reachable by everyone. The admin-only material lives
  // inside these pages — storage tier gauges, firewall rules, spend — and the
  // database is what withholds it, so a standard user sees a thinner page
  // rather than a forbidden one.
  const links = [
    { href: '/', label: 'Overview' },
    { href: '/compute', label: 'Compute' },
    { href: '/storage', label: 'Storage & DR' },
    { href: '/network', label: 'Networking' },
    { href: '/insights', label: 'Insights' },
  ]

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
