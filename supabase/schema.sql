-- VMaaS Dashboard — schema, security policies, and aggregate functions.
-- Paste into Supabase → SQL Editor → Run. Safe to run on an empty project.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type user_role       as enum ('admin','user');
create type vm_status       as enum ('running','stopped','starting','stopping','restarting');
create type storage_tier    as enum ('ssd_high_perf','standard','archive');
create type commitment_tier as enum ('dedicated_committed','partial_committed',
                                     'on_demand','granular_custom');
create type subnet_kind     as enum ('routed','isolated','app_group');
create type asset_kind      as enum ('iso','template','blueprint');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per company. Everything here is readable by every member.
create table public.workspaces (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  vcpu_limit         int not null,
  ram_gb_limit       int not null,
  commitment_tier    commitment_tier not null default 'on_demand',
  rpo_seconds        int not null default 5,
  last_replicated_at timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

-- The admin-only half of a workspace: prices and storage capacity.
-- Separate table because Postgres security is per-row, not per-column —
-- keeping these columns on `workspaces` would expose them to every member.
create table public.workspace_settings (
  workspace_id         uuid primary key references public.workspaces(id) on delete cascade,
  ssd_capacity_gb      bigint not null,
  standard_capacity_gb bigint not null,
  archive_capacity_gb  bigint not null,
  vcpu_hour            numeric(10,4) not null,
  ram_gb_hour          numeric(10,4) not null,
  storage_gb_month     numeric(10,4) not null
);

-- Mirrors Supabase's auth.users, adding what it doesn't know: company and role.
create table public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  full_name    text not null,
  email        text not null,
  role         user_role not null default 'user',
  created_at   timestamptz not null default now()
);
create index on public.users (workspace_id);

-- A group is owned by one person, and so is everything in it.
-- That is what makes "power the whole group" unambiguous.
create table public.app_groups (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid not null references public.users(id),
  name          text not null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, name)
);

-- CIDRs are unique per company, not globally: two tenants may both use 192.168.1.0/24.
create table public.subnets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  kind         subnet_kind not null,
  cidr         cidr not null,
  app_group_id uuid references public.app_groups(id) on delete set null,
  unique (workspace_id, cidr)
);

create table public.provisions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  user_id           uuid not null references public.users(id),
  app_group_id      uuid references public.app_groups(id) on delete set null,
  subnet_id         uuid references public.subnets(id) on delete set null,
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
create index on public.provisions (workspace_id, status);
create index on public.provisions (user_id);
create index on public.provisions (app_group_id);

create table public.snapshots (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provision_id uuid not null references public.provisions(id) on delete cascade,
  label        text not null,
  size_gb      numeric(10,2) not null,
  created_at   timestamptz not null default now()
);
create index on public.snapshots (provision_id);

create table public.firewall_rules (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
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

create table public.nat_rules (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  kind          text not null check (kind in ('snat','dnat')),
  internal_ip   inet not null,
  external_ip   inet not null,
  internal_port int,
  external_port int,
  enabled       boolean not null default true
);

-- workspace_id null = a global blueprint published by the operator, visible to all.
create table public.catalog_assets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  name         text not null,
  kind         asset_kind not null,
  os           text,
  size_gb      numeric(10,2) not null
);

-- Who did what. Cheap now, impossible to reconstruct later.
create table public.audit_log (
  id           bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id     uuid references public.users(id) on delete set null,
  action       text not null,
  target_id    uuid,
  detail       jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index on public.audit_log (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Who is asking
--
-- security definer, so these can read `users` without being blocked by the
-- very policies they are used to write. search_path is pinned to '' and every
-- name fully qualified, so nothing can be shadowed by a caller's search path.
-- ---------------------------------------------------------------------------

create or replace function public.my_workspace()
returns uuid language sql stable security definer set search_path = '' as
$$ select workspace_id from public.users where id = (select auth.uid()) $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as
$$ select coalesce((select role = 'admin' from public.users where id = (select auth.uid())), false) $$;

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Every policy is scoped `to authenticated`, so a logged-out visitor never
-- matches one. A table with RLS on and no matching policy returns zero rows.
-- ---------------------------------------------------------------------------

alter table public.workspaces         enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.users              enable row level security;
alter table public.app_groups         enable row level security;
alter table public.subnets            enable row level security;
alter table public.provisions         enable row level security;
alter table public.snapshots          enable row level security;
alter table public.firewall_rules     enable row level security;
alter table public.nat_rules          enable row level security;
alter table public.catalog_assets     enable row level security;
alter table public.audit_log          enable row level security;

-- Your own company, readable by everyone in it.
create policy workspaces_read on public.workspaces
  for select to authenticated
  using (id = public.my_workspace());

-- Prices and capacity: admins only. This is what hides cost data —
-- a standard user's query returns no rows, so there is nothing to leak.
create policy workspace_settings_admin on public.workspace_settings
  for all to authenticated
  using (workspace_id = public.my_workspace() and public.is_admin())
  with check (workspace_id = public.my_workspace() and public.is_admin());

-- Colleagues are visible (the VM table shows owner names); only admins manage them.
create policy users_read on public.users
  for select to authenticated
  using (workspace_id = public.my_workspace());

create policy users_admin_write on public.users
  for all to authenticated
  using (workspace_id = public.my_workspace() and public.is_admin())
  with check (workspace_id = public.my_workspace() and public.is_admin());

create policy app_groups_access on public.app_groups
  for all to authenticated
  using (workspace_id = public.my_workspace()
         and (public.is_admin() or owner_user_id = (select auth.uid())))
  with check (workspace_id = public.my_workspace()
         and (public.is_admin() or owner_user_id = (select auth.uid())));

-- Everyone can see the network layout; only admins change it.
create policy subnets_read on public.subnets
  for select to authenticated
  using (workspace_id = public.my_workspace());

create policy subnets_admin_write on public.subnets
  for all to authenticated
  using (workspace_id = public.my_workspace() and public.is_admin())
  with check (workspace_id = public.my_workspace() and public.is_admin());

-- The core rule: admins see the whole company, users see their own machines.
create policy provisions_access on public.provisions
  for all to authenticated
  using (workspace_id = public.my_workspace()
         and (public.is_admin() or user_id = (select auth.uid())))
  with check (workspace_id = public.my_workspace()
         and (public.is_admin() or user_id = (select auth.uid())));

-- Snapshots follow their machine. The subquery is itself filtered by the
-- policy above, so it only ever lists machines the caller can already see.
create policy snapshots_access on public.snapshots
  for all to authenticated
  using (workspace_id = public.my_workspace()
         and provision_id in (select id from public.provisions))
  with check (workspace_id = public.my_workspace()
         and provision_id in (select id from public.provisions));

create policy firewall_admin on public.firewall_rules
  for all to authenticated
  using (workspace_id = public.my_workspace() and public.is_admin())
  with check (workspace_id = public.my_workspace() and public.is_admin());

create policy nat_admin on public.nat_rules
  for all to authenticated
  using (workspace_id = public.my_workspace() and public.is_admin())
  with check (workspace_id = public.my_workspace() and public.is_admin());

-- Your company's assets, plus the operator's global blueprints.
create policy catalog_read on public.catalog_assets
  for select to authenticated
  using (workspace_id = public.my_workspace() or workspace_id is null);

create policy catalog_admin_write on public.catalog_assets
  for all to authenticated
  using (workspace_id = public.my_workspace() and public.is_admin())
  with check (workspace_id = public.my_workspace() and public.is_admin());

-- Anyone may add an entry; only admins may read the history back.
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (workspace_id = public.my_workspace() and actor_id = (select auth.uid()));

create policy audit_admin_read on public.audit_log
  for select to authenticated
  using (workspace_id = public.my_workspace() and public.is_admin());

-- ---------------------------------------------------------------------------
-- Totals
--
-- Calculated on demand, never stored — a saved counter drifts the first time
-- a delete and an edit overlap, and nothing tells you it is wrong.
--
-- These are functions rather than views on purpose. The quota banner must show
-- the whole company's usage, but a standard user's policy hides other people's
-- machines. security definer lets the total be correct without exposing the
-- individual rows behind it.
-- ---------------------------------------------------------------------------

create or replace function public.quota_usage()
returns table (vcpu_limit int, ram_gb_limit int, vcpu_used bigint, ram_gb_used bigint)
language sql stable security definer set search_path = '' as $$
  select w.vcpu_limit, w.ram_gb_limit,
         coalesce(sum(p.cpu_cores), 0), coalesce(sum(p.ram_gb), 0)
  from public.workspaces w
  left join public.provisions p on p.workspace_id = w.id
  where w.id = public.my_workspace()
  group by w.vcpu_limit, w.ram_gb_limit
$$;

-- Admin only: returns nothing for a standard user.
create or replace function public.storage_usage()
returns table (tier storage_tier, capacity_gb bigint, used_gb bigint)
language sql stable security definer set search_path = '' as $$
  select t.tier, t.capacity_gb, coalesce(sum(p.storage_gb), 0)
  from (
    select 'ssd_high_perf'::storage_tier, s.ssd_capacity_gb      from public.workspace_settings s where s.workspace_id = public.my_workspace()
    union all
    select 'standard'::storage_tier,      s.standard_capacity_gb from public.workspace_settings s where s.workspace_id = public.my_workspace()
    union all
    select 'archive'::storage_tier,       s.archive_capacity_gb  from public.workspace_settings s where s.workspace_id = public.my_workspace()
  ) as t(tier, capacity_gb)
  left join public.provisions p
    on p.workspace_id = public.my_workspace() and p.storage_tier = t.tier
  where public.is_admin()
  group by t.tier, t.capacity_gb
$$;

-- Admin only: month-to-date spend, priced from workspace_settings.
create or replace function public.monthly_spend()
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(round(sum(
    extract(epoch from (now() - greatest(p.created_at, date_trunc('month', now())))) / 3600
      * (p.cpu_cores * s.vcpu_hour + p.ram_gb * s.ram_gb_hour)
    + p.storage_gb * s.storage_gb_month
  ), 2), 0)
  from public.provisions p
  join public.workspace_settings s on s.workspace_id = p.workspace_id
  where p.workspace_id = public.my_workspace() and public.is_admin()
$$;

-- ---------------------------------------------------------------------------
-- Grants
--
-- "Automatically expose new tables" is off, so nothing is reachable through
-- the API until it is granted here. That is a second lock behind the policies
-- above. `anon` gets nothing — logged-out visitors only need the auth endpoint.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select                         on public.workspaces         to authenticated;
grant select, insert, update, delete on public.workspace_settings to authenticated;
grant select, insert, update, delete on public.users              to authenticated;
grant select, insert, update, delete on public.app_groups         to authenticated;
grant select, insert, update, delete on public.subnets            to authenticated;
grant select, insert, update, delete on public.provisions         to authenticated;
grant select, insert, update, delete on public.snapshots          to authenticated;
grant select, insert, update, delete on public.firewall_rules     to authenticated;
grant select, insert, update, delete on public.nat_rules          to authenticated;
grant select, insert, update, delete on public.catalog_assets     to authenticated;
grant select, insert                 on public.audit_log          to authenticated;
grant usage, select on sequence public.audit_log_id_seq to authenticated;

grant execute on function public.my_workspace()  to authenticated;
grant execute on function public.is_admin()      to authenticated;
grant execute on function public.quota_usage()   to authenticated;
grant execute on function public.storage_usage() to authenticated;
grant execute on function public.monthly_spend() to authenticated;
