-- VMaaS Dashboard — sample data.
-- Paste into Supabase → SQL Editor → Run. Re-runnable: it clears first.
--
-- Two companies on purpose. Northwind has an admin (Sarah) and a regular user
-- (Tom); Globex has only Rita. Logging in as Rita should show none of
-- Northwind's machines — that is how we check the security rules actually hold.
--
-- Login IDs come from Supabase Auth. If you recreate those accounts, the IDs
-- change and the three below must be updated to match.

truncate public.audit_log, public.snapshots, public.provisions, public.subnets,
  public.app_groups, public.catalog_assets, public.firewall_rules,
  public.nat_rules, public.users, public.workspace_settings, public.workspaces
  restart identity cascade;

-- ---------------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------------

insert into public.workspaces
  (id, name, vcpu_limit, ram_gb_limit, commitment_tier, rpo_seconds, last_replicated_at) values
  ('11111111-1111-1111-1111-111111111111', 'Northwind Traders', 64, 256,
   'partial_committed', 4, now() - interval '3 seconds'),
  ('22222222-2222-2222-2222-222222222222', 'Globex Corporation', 32, 128,
   'on_demand', 8, now() - interval '6 seconds');

-- Capacity and prices. Admin-only table — this is the financial masking.
insert into public.workspace_settings
  (workspace_id, ssd_capacity_gb, standard_capacity_gb, archive_capacity_gb,
   vcpu_hour, ram_gb_hour, storage_gb_month) values
  ('11111111-1111-1111-1111-111111111111', 8192, 4096, 20480, 0.0200, 0.0030, 0.0500),
  ('22222222-2222-2222-2222-222222222222', 4096, 2048, 10240, 0.0250, 0.0035, 0.0600);

-- ---------------------------------------------------------------------------
-- People — ids must match auth.users
-- ---------------------------------------------------------------------------

insert into public.users (id, workspace_id, full_name, email, role) values
  ('74858105-75d8-464b-b8a9-a818b5523957', '11111111-1111-1111-1111-111111111111',
   'Sarah Tandon', 'sarah@example.com', 'admin'),
  ('f0199ab1-10a4-416e-b1ff-8aa16af6e453', '11111111-1111-1111-1111-111111111111',
   'Tom Okafor', 'tom@example.com', 'user'),
  ('d078192e-b4f8-422e-966d-2d0efb91d217', '22222222-2222-2222-2222-222222222222',
   'Rita Alvarez', 'rita@example.com', 'admin');

-- ---------------------------------------------------------------------------
-- App groups — one owner each, and everything inside shares that owner
-- ---------------------------------------------------------------------------

insert into public.app_groups (id, workspace_id, owner_user_id, name) values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'f0199ab1-10a4-416e-b1ff-8aa16af6e453', 'E-Commerce'),
  ('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   '74858105-75d8-464b-b8a9-a818b5523957', 'Analytics'),
  ('a3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
   'd078192e-b4f8-422e-966d-2d0efb91d217', 'Billing');

-- ---------------------------------------------------------------------------
-- Networks
--
-- Note both companies use 192.168.1.0/24 and 10.0.5.0/24. That is the point —
-- the PRD requires overlapping private ranges across tenants, and CIDRs are
-- unique per company rather than globally.
-- ---------------------------------------------------------------------------

insert into public.subnets (id, workspace_id, name, kind, cidr, app_group_id) values
  ('51111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'Prod-Routed',    'routed',    '192.168.1.0/24', null),
  ('52222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Isolated-Data',  'isolated',  '10.0.5.0/24',    null),
  ('53333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'ECom-Group-Net', 'app_group', '172.16.20.0/24', 'a1111111-1111-1111-1111-111111111111'),
  ('54444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
   'Globex-Routed',   'routed',   '192.168.1.0/24', null),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222',
   'Globex-Isolated', 'isolated', '10.0.5.0/24',    null);

-- ---------------------------------------------------------------------------
-- Machines
--
-- Northwind: 52 of 64 vCPU (81%), 200 of 256 GB RAM (78%).
-- VM-ETL-01 is mid-start, so the transitional state is visible on first load.
-- ---------------------------------------------------------------------------

insert into public.provisions
  (workspace_id, user_id, app_group_id, subnet_id, vm_name, cpu_cores, ram_gb,
   storage_gb, storage_tier, ip_address, status, status_changed_at, created_at) values

  -- Tom's machines (Northwind)
  ('11111111-1111-1111-1111-111111111111', 'f0199ab1-10a4-416e-b1ff-8aa16af6e453',
   'a1111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111111',
   'VM-Web-01', 4, 16, 200, 'ssd_high_perf', '192.168.1.11', 'running',
   now() - interval '9 days', now() - interval '40 days'),
  ('11111111-1111-1111-1111-111111111111', 'f0199ab1-10a4-416e-b1ff-8aa16af6e453',
   'a1111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111111',
   'VM-Web-02', 4, 16, 200, 'ssd_high_perf', '192.168.1.12', 'running',
   now() - interval '9 days', now() - interval '40 days'),
  ('11111111-1111-1111-1111-111111111111', 'f0199ab1-10a4-416e-b1ff-8aa16af6e453',
   'a1111111-1111-1111-1111-111111111111', '53333333-3333-3333-3333-333333333333',
   'VM-App-01', 8, 32, 500, 'ssd_high_perf', '172.16.20.21', 'running',
   now() - interval '9 days', now() - interval '40 days'),
  ('11111111-1111-1111-1111-111111111111', 'f0199ab1-10a4-416e-b1ff-8aa16af6e453',
   'a1111111-1111-1111-1111-111111111111', '53333333-3333-3333-3333-333333333333',
   'VM-App-02', 8, 32, 500, 'ssd_high_perf', '172.16.20.22', 'stopped',
   now() - interval '2 days', now() - interval '40 days'),
  ('11111111-1111-1111-1111-111111111111', 'f0199ab1-10a4-416e-b1ff-8aa16af6e453',
   null, '51111111-1111-1111-1111-111111111111',
   'VM-Cache-01', 2, 8, 100, 'ssd_high_perf', '192.168.1.15', 'running',
   now() - interval '21 days', now() - interval '35 days'),
  ('11111111-1111-1111-1111-111111111111', 'f0199ab1-10a4-416e-b1ff-8aa16af6e453',
   null, '51111111-1111-1111-1111-111111111111',
   'VM-Test-01', 2, 4, 50, 'standard', '192.168.1.16', 'stopped',
   now() - interval '5 days', now() - interval '12 days'),

  -- Sarah's machines (Northwind)
  ('11111111-1111-1111-1111-111111111111', '74858105-75d8-464b-b8a9-a818b5523957',
   'a2222222-2222-2222-2222-222222222222', '52222222-2222-2222-2222-222222222222',
   'VM-DB-01', 8, 32, 2000, 'ssd_high_perf', '10.0.5.11', 'running',
   now() - interval '30 days', now() - interval '90 days'),
  ('11111111-1111-1111-1111-111111111111', '74858105-75d8-464b-b8a9-a818b5523957',
   'a2222222-2222-2222-2222-222222222222', '52222222-2222-2222-2222-222222222222',
   'VM-DB-02', 8, 32, 2000, 'ssd_high_perf', '10.0.5.12', 'running',
   now() - interval '30 days', now() - interval '90 days'),
  ('11111111-1111-1111-1111-111111111111', '74858105-75d8-464b-b8a9-a818b5523957',
   'a2222222-2222-2222-2222-222222222222', '52222222-2222-2222-2222-222222222222',
   'VM-ETL-01', 4, 16, 1000, 'standard', '10.0.5.13', 'starting',
   now() - interval '5 seconds', now() - interval '60 days'),
  ('11111111-1111-1111-1111-111111111111', '74858105-75d8-464b-b8a9-a818b5523957',
   null, '52222222-2222-2222-2222-222222222222',
   'VM-Backup-01', 2, 8, 8000, 'archive', '10.0.5.20', 'running',
   now() - interval '60 days', now() - interval '120 days'),
  ('11111111-1111-1111-1111-111111111111', '74858105-75d8-464b-b8a9-a818b5523957',
   null, '51111111-1111-1111-1111-111111111111',
   'VM-Bastion-01', 2, 4, 50, 'standard', '192.168.1.5', 'running',
   now() - interval '75 days', now() - interval '120 days'),

  -- Rita's machines (Globex) — note GBX-Web-01 reuses 192.168.1.11
  ('22222222-2222-2222-2222-222222222222', 'd078192e-b4f8-422e-966d-2d0efb91d217',
   'a3333333-3333-3333-3333-333333333333', '54444444-4444-4444-4444-444444444444',
   'GBX-Web-01', 4, 16, 200, 'ssd_high_perf', '192.168.1.11', 'running',
   now() - interval '14 days', now() - interval '50 days'),
  ('22222222-2222-2222-2222-222222222222', 'd078192e-b4f8-422e-966d-2d0efb91d217',
   'a3333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555',
   'GBX-DB-01', 8, 32, 1000, 'ssd_high_perf', '10.0.5.11', 'running',
   now() - interval '14 days', now() - interval '50 days'),
  ('22222222-2222-2222-2222-222222222222', 'd078192e-b4f8-422e-966d-2d0efb91d217',
   null, '54444444-4444-4444-4444-444444444444',
   'GBX-Worker-01', 4, 8, 100, 'standard', '192.168.1.20', 'stopped',
   now() - interval '1 day', now() - interval '20 days'),
  ('22222222-2222-2222-2222-222222222222', 'd078192e-b4f8-422e-966d-2d0efb91d217',
   null, '55555555-5555-5555-5555-555555555555',
   'GBX-Archive-01', 2, 4, 4000, 'archive', '10.0.5.30', 'running',
   now() - interval '40 days', now() - interval '80 days');

-- ---------------------------------------------------------------------------
-- Snapshots
-- ---------------------------------------------------------------------------

insert into public.snapshots (workspace_id, provision_id, label, size_gb, created_at)
select p.workspace_id, p.id, s.label, s.size_gb, now() - s.age
from public.provisions p
join (values
  ('VM-Web-01'::text, 'pre-deploy-v2.4'::text, 42.10::numeric, interval '6 days'),
  ('VM-App-01',   'before-migration',  118.75, interval '9 days'),
  ('VM-DB-01',    'nightly-2026-08-22', 640.00, interval '18 hours'),
  ('VM-DB-02',    'nightly-2026-08-22', 631.40, interval '18 hours'),
  ('GBX-DB-01',   'pre-patch',         310.20, interval '4 days')
) as s(vm_name, label, size_gb, age) on s.vm_name = p.vm_name;

-- ---------------------------------------------------------------------------
-- Perimeter security — admin-only tables
-- ---------------------------------------------------------------------------

insert into public.firewall_rules
  (workspace_id, priority, action, direction, protocol, source, destination, port_range, enabled) values
  ('11111111-1111-1111-1111-111111111111', 100, 'allow', 'inbound',  'tcp', 'any',            '192.168.1.11-12', '443',   true),
  ('11111111-1111-1111-1111-111111111111', 200, 'allow', 'inbound',  'tcp', '203.0.113.0/24', '192.168.1.5',     '22',    true),
  ('11111111-1111-1111-1111-111111111111', 300, 'deny',  'inbound',  'any', 'any',            '10.0.5.0/24',     'any',   true),
  ('11111111-1111-1111-1111-111111111111', 400, 'allow', 'outbound', 'any', 'any',            'any',             'any',   true),
  ('22222222-2222-2222-2222-222222222222', 100, 'allow', 'inbound',  'tcp', 'any',            '192.168.1.11',    '80,443', true),
  ('22222222-2222-2222-2222-222222222222', 200, 'deny',  'inbound',  'any', 'any',            'any',             'any',   true);

insert into public.nat_rules
  (workspace_id, kind, internal_ip, external_ip, internal_port, external_port, enabled) values
  ('11111111-1111-1111-1111-111111111111', 'snat', '192.168.1.0', '198.51.100.10', null, null, true),
  ('11111111-1111-1111-1111-111111111111', 'dnat', '192.168.1.11', '198.51.100.11', 443, 443, true),
  ('22222222-2222-2222-2222-222222222222', 'dnat', '192.168.1.11', '198.51.100.80', 443, 443, true);

-- ---------------------------------------------------------------------------
-- Catalog — null workspace means an operator blueprint everyone can see
-- ---------------------------------------------------------------------------

insert into public.catalog_assets (workspace_id, name, kind, os, size_gb) values
  (null, 'Ubuntu 24.04 LTS',        'blueprint', 'Ubuntu 24.04',      2.60),
  (null, 'Debian 12',               'blueprint', 'Debian 12',         1.90),
  (null, 'Rocky Linux 9',           'blueprint', 'Rocky Linux 9',     2.20),
  (null, 'Windows Server 2022',     'blueprint', 'Windows 2022',      12.40),
  ('11111111-1111-1111-1111-111111111111', 'northwind-base-2026.03', 'template', 'Ubuntu 24.04', 4.80),
  ('11111111-1111-1111-1111-111111111111', 'ops-toolkit.iso',        'iso',      null,           1.10),
  ('22222222-2222-2222-2222-222222222222', 'globex-billing-base',    'template', 'Debian 12',    3.40);

-- ---------------------------------------------------------------------------
-- A little history
-- ---------------------------------------------------------------------------

insert into public.audit_log (workspace_id, actor_id, action, detail, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'f0199ab1-10a4-416e-b1ff-8aa16af6e453',
   'vm.stop',     '{"vm":"VM-App-02"}',            now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111111', '74858105-75d8-464b-b8a9-a818b5523957',
   'vm.snapshot', '{"vm":"VM-DB-01"}',             now() - interval '18 hours'),
  ('11111111-1111-1111-1111-111111111111', '74858105-75d8-464b-b8a9-a818b5523957',
   'firewall.add','{"priority":300}',              now() - interval '11 days'),
  ('11111111-1111-1111-1111-111111111111', '74858105-75d8-464b-b8a9-a818b5523957',
   'vm.start',    '{"vm":"VM-ETL-01"}',            now() - interval '5 seconds'),
  ('22222222-2222-2222-2222-222222222222', 'd078192e-b4f8-422e-966d-2d0efb91d217',
   'vm.stop',     '{"vm":"GBX-Worker-01"}',        now() - interval '1 day');
