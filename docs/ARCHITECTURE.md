# VMaaS Dashboard — Architecture

**The database is the source of truth.** There are no real virtual machines behind this.
Clicking "Start" writes `running` to a row. Graphs are calculated, not measured. Everything
works and nothing is connected — the right trade for a first version.

## The pieces

```
Browser
   │
Next.js on Vercel ──── screens + server logic
   │
Supabase ──── Postgres (all data)  +  Auth (logins)
```

Three services, no background workers, no queue. Nothing to run because nothing real is
being controlled.

## Tables

Ten tables. Supabase Auth owns logins, so there's no password or session table here.

```sql
create type user_role       as enum ('admin','user');
create type vm_status       as enum ('running','stopped','starting','stopping','restarting');
create type storage_tier    as enum ('ssd_high_perf','standard','archive');
create type commitment_tier as enum ('dedicated_committed','partial_committed',
                                     'on_demand','granular_custom');
create type subnet_kind     as enum ('routed','isolated','app_group');
create type asset_kind      as enum ('iso','template','blueprint');

-- One row per company. Holds the limits and prices everything else is measured against.
create table workspaces (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  vcpu_limit         int not null,
  ram_gb_limit       int not null,
  ssd_capacity_gb    bigint not null,
  standard_capacity_gb bigint not null,
  archive_capacity_gb  bigint not null,
  vcpu_hour          numeric(10,4) not null,
  ram_gb_hour        numeric(10,4) not null,
  storage_gb_month   numeric(10,4) not null,
  commitment_tier    commitment_tier not null default 'on_demand',
  rpo_seconds        int not null default 5,
  last_replicated_at timestamptz not null default now()
);

-- Mirrors Supabase's auth.users, adding what it doesn't know: company and role.
create table users (
  id           uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  full_name    text not null,
  email        text not null,
  role         user_role not null default 'user',
  created_at   timestamptz not null default now()
);

-- A group is owned by one person, and so is everything in it.
-- That's what makes "power the whole group" unambiguous.
create table app_groups (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  owner_user_id uuid not null references users(id),
  name          text not null,
  unique (workspace_id, name)
);

-- CIDRs are unique per company, not globally: different tenants may both use 192.168.1.0/24.
create table subnets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  kind         subnet_kind not null,
  cidr         cidr not null,
  app_group_id uuid references app_groups(id) on delete set null,
  unique (workspace_id, cidr)
);

create table provisions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  user_id           uuid not null references users(id),
  app_group_id      uuid references app_groups(id) on delete set null,
  subnet_id         uuid references subnets(id) on delete set null,
  vm_name           text not null,
  cpu_cores         int not null check (cpu_cores > 0),
  ram_gb            int not null check (ram_gb > 0),
  storage_gb        int not null check (storage_gb > 0),
  storage_tier      storage_tier not null,
  ip_address        inet,
  status            vm_status not null default 'stopped',
  status_changed_at timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (workspace_id, vm_name)
);

create table snapshots (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provision_id uuid not null references provisions(id) on delete cascade,
  label        text not null,
  size_gb      numeric(10,2) not null,
  created_at   timestamptz not null default now()
);

create table firewall_rules (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  priority     int not null,
  action       text not null check (action in ('allow','deny')),
  direction    text not null check (direction in ('inbound','outbound')),
  protocol     text not null default 'any',
  source       text not null default 'any',
  destination  text not null default 'any',
  port_range   text not null default 'any',
  enabled      boolean not null default true,
  unique (workspace_id, priority)
);

create table nat_rules (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  kind          text not null check (kind in ('snat','dnat')),
  internal_ip   inet not null,
  external_ip   inet not null,
  internal_port int,
  external_port int,
  enabled       boolean not null default true
);

-- workspace_id null = a global blueprint published by the operator, visible to everyone.
create table catalog_assets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  name         text not null,
  kind         asset_kind not null,
  os           text,
  size_gb      numeric(10,2) not null
);

-- Who did what. Cheap now, impossible to reconstruct later.
create table audit_log (
  id           bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id     uuid references users(id) on delete set null,
  action       text not null,
  target_id    uuid,
  detail       jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
```

## Who sees what

The database enforces this, not our code. Supabase already knows who's logged in via
`auth.uid()`, so we only need two helpers. They're `security definer` so the lookup itself
isn't blocked by the rules it's used to write.

```sql
create function my_workspace() returns uuid
  language sql stable security definer set search_path = public as
  $$ select workspace_id from users where id = auth.uid() $$;

create function is_admin() returns boolean
  language sql stable security definer set search_path = public as
  $$ select role = 'admin' from users where id = auth.uid() $$;
```

Turn the rules on for every table:

```sql
alter table provisions enable row level security;
```

**Machines** — admins see the whole company, users see their own:

```sql
create policy provisions_access on provisions
using (workspace_id = my_workspace() and (is_admin() or user_id = auth.uid()));
```

**Money, firewall, NAT, storage limits** — admins only:

```sql
create policy admin_only on firewall_rules
using (workspace_id = my_workspace() and is_admin());
```

That last one is how cost data stays hidden. It isn't sent to the browser and hidden with
CSS — a regular user's query returns no rows at all, so there's nothing to leak.

**Catalog** — company assets plus the global blueprints:

```sql
create policy catalog_access on catalog_assets
using (workspace_id = my_workspace() or workspace_id is null);
```

## Totals are calculated, never stored

"48 of 64 CPUs used" is added up from `provisions` each time it's asked. A stored counter
drifts the first time a delete and an edit overlap, and nothing tells you it's wrong.

```sql
create view quota_usage with (security_invoker = true) as
select w.id as workspace_id, w.vcpu_limit, w.ram_gb_limit,
       coalesce(sum(p.cpu_cores), 0) as vcpu_used,
       coalesce(sum(p.ram_gb), 0)    as ram_gb_used
from workspaces w
left join provisions p on p.workspace_id = w.id
group by w.id;
```

`security_invoker` matters — without it the view would run with its creator's permissions and
bypass the rules above. Storage usage and monthly spend follow the same shape.

## Graphs without real machines

Performance charts aren't recorded anywhere. Each point is calculated from the machine's id
and the time:

```
value(t) = base(id) + swing · sin(t / period + offset(id)) + small wobble
```

Because it's a formula and not random numbers, a machine always draws the same line. Refresh
the page and the history is identical; two people see the same thing. Random values would
jump on every reload and give the game away. A stopped machine reads flat zero.

## Buttons

Clicking Start writes `starting`, logs it, and returns. The screen shows a spinner, and about
twenty seconds later the row reads `running`.

Nothing schedules that change — it's worked out when read:

```sql
case when status = 'starting' and status_changed_at < now() - interval '20 seconds'
     then 'running' else status end
```

So there's no timer, no background job, and no way for a machine to get stuck mid-transition.
The delay is deliberate: a button that finishes instantly feels fake, and real machines do
take that long.

Group power is the same write across every machine in the group. Since one person owns the
group and everything in it, there's no question of permission.

**Quota checks happen on create**, in one place, in the same transaction as the insert —
otherwise two people adding machines at once can both slip under the limit.

## One habit

All writes to `provisions` go through a single file. Not spread across screens. If real
machines are ever connected, that's the one place that changes.

## Build order

| # | Slice |
|---|---|
| 1 | Tables, security rules, seed data |
| 2 | Login and admin/user routing |
| 3 | Machine list, power buttons, audit log |
| 4 | Quota banner, app groups, group power |
| 5 | Storage gauges, snapshots, RPO badge |
| 6 | Subnets, firewall, NAT |
| 7 | Graphs, cost ticker, catalog |

Seed data ships in slice 1 and grows with each one. With no real machines, it's the only
thing making the demo convincing — budget real time for it.
