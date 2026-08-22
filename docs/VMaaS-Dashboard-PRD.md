# Product Requirements Document: Multi-Tenant VMaaS Dashboard (MVP Edition)

## 1. Strategic Intent & System Architecture

This updated PRD refines the VMaaS Dashboard MVP to include core persistence models. The architecture decouples the frontend user experience from backend state management using a lightweight, native database schema—omitting external Auth0 dependencies in favor of an internal user authentication model.

### System Architecture & Database Diagram

```
+------------------------------------------------------------+
|                  MULTI-TENANT VMaaS DASHBOARD              |
|              [ SYSTEM ARCHITECTURE & DATABASE ]            |
+------------------------------------------------------------+
                             |
                 +-----------+-----------+
                 |   RBAC / ROUTER ENGINE|
                 +-----------+-----------+
                             |
         +-------------------+-------------------+
         |                                       |
         v                                       v
+---------------------------+   +---------------------------+
|     TENANT ADMIN VIEW     |   |     TENANT USER VIEW      |
|   (Workspace Governance)  |   |  (Operational Workloads)  |
+---------------------------+   +---------------------------+
|                           |   |                           |
| COMPUTE & CAPACITY        |   | WORKLOAD CONTROLS         |
| +-----------------------+ |   | +-----------------------+ |
| | CPU/RAM Alloc: [80%]  | |   | | [> Start] [|| Stop] [O] |
| | Quotas: 64 vCPU/256GB | |   | |  * VM-Web-01 (Running)| |
| +-----------------------+ |   | |  * VM-App-02 (Stopped)| |
|                           |   | +-----------------------+ |
| STORAGE TIERS             |   |                           |
| +-----------------------+ |   | APP GROUP CONTAINERS      |
| | Tier 1 SSD: [60/100TB]| |   | +-----------------------+ |
| | Tier 2 Arch:[20/500TB]| |   | | [1-Click Bulk Power]  | |
| +-----------------------+ |   | | Container: "E-Commerce"| |
|                           |   | +-----------------------+ |
| PERIMETER SECURITY        |   |                           |
| +-----------------------+ |   | NETWORKING & SUBNETS      |
| | [x] North-South FW    | |   | +-----------------------+ |
| | [x] SNAT / DNAT Rules | |   | | - Isolated-Net (10.0.x)| |
| +-----------------------+ |   | | - Routed-Net (192.168.x)|
|                           |   | +-----------------------+ |
| FINANCIAL CHARGEBACK      |   |                           |
| +-----------------------+ |   | CATALOG ASSETS            |
| | Est. Spend: $1,240/mo | |   | +-----------------------+ |
| | [Export Billing Rep]  | |   | | - Ubuntu 24.04 (Global)| |
| +-----------------------+ |   | +-----------------------+ |
+---------------------------+   +---------------------------+
              |                              |
              +--------------+---------------+
                             |
                             v
+------------------------------------------------------------+
|                       DATABASE LAYER                       |
+------------------------------------------------------------+
|                                                            |
|  +---------------------------+  +------------------------+ |
|  |        USERS TABLE        |  |    PROVISIONS TABLE    | |
|  +---------------------------+  +------------------------+ |
|  | PK | id                   |  | PK | id                | |
|  |    | tenant_workspace_id  |  | FK | user_id           | |
|  |    | full_name         1  N |  | vm_name              | |
|  |    | email        |-------<  |  | cpu_cores          | |
|  |    | password_hash        |  |    | ram_gb            | |
|  |    | role (admin/user)    |  |    | storage_gb        | |
|  |    | created_at           |  |    | storage_tier      | |
|  +---------------------------+  |    | ip_address        | |
|                                 |    | status            | |
|                                 |    | app_group_id      | |
|                                 |    | created_at        | |
|                                 +------------------------+ |
+------------------------------------------------------------+
```

## 2. User Personas & Experience Routing

The dashboard applies dynamic Persona Routing using standard credentials stored in the application database:

- **Tenant Administrator:** Full observation and control over workspace quotas, multi-tier storage allocation, perimeter gateway firewalls, near-second RPO health, and financial cost tracking.
- **Tenant User / Workload Owner:** Operational access restricted strictly to provisioned virtual assets belonging to their user account or assigned application groups. Financial data remains hidden by default.

## 3. MVP Functional Requirements

### 3.1 Identity, Authentication & Compute Workspace

- **Simple Native Authentication:** Native login interface referencing internal `USERS` table credentials (`email` + `password_hash`).
- **Workspace Quota Summary Widget:** Top-level banner calculating aggregate resource usage across all provisions vs. hard workspace limits.
- **VM Inventory Table:** Filterable list displaying provisioned VMs, current status, assigned IP, resource specs, and immediate power controls (Start, Stop, Restart, Snapshot).
- **Application Group Containers:** Grouping model enabling 1-click bulk power controls across tied virtual instances. *(Sequential boot delay timers deferred to v1.1)*.
- **Resource Commitment Tiers:** Status indicators showing active billing models—*Dedicated Committed*, *Partial Committed*, *On-Demand*, or *Granular Custom*.

### 3.2 Storage & Disaster Recovery

- **Storage Tier Gauge (Admin View):** Real-time status tracking space usage across 3 performance tiers (e.g., SSD High-Perf, Standard, Archive).
- **User Storage Control:** Allows users to pick pre-approved storage profiles, execute local VM snapshots, and inspect disk usage.
- **RPO Health & DR Test Panel:** Near-second RPO status badge with a single-click trigger for non-disruptive failover/failback tests.

### 3.3 Networking & Edge Controls

- **Subnet Topology Summary:** Structured list detailing active subnets—*Routed*, *Isolated*, and *Application Group Networks*—supporting overlapping private IP ranges (e.g., `192.168.1.0/24`).
- **Perimeter Security Panel (Admin View):** Interface to manage North-South Edge Firewall rules and SNAT/DNAT rules for public IP mapping. *(East-West micro-segmentation deferred to v1.1)*.

### 3.4 Observability, Financials & Catalogs

- **Performance Telemetry Widgets:** Real-time graphs tracking CPU/RAM utilization, IOPS, and network latencies.
- **Financial Chargeback Ticker (Admin View):** Monthly spend calculations ($$/GB/month), project showback summaries, and downloadable billing reports. Masked for standard users unless overridden.
- **Asset Catalogs:** Asset browser separating private tenant-uploaded media/ISOs from operator-published global blueprints.

## 5. MVP vs. Deferral Feature Matrix

| Module | Included in MVP (Scope In) | Deferred to v1.1+ (Scope Out) |
| --- | --- | --- |
| **Authentication & IAM** | Native DB Auth (`USERS` Table) & Role Persona Routing | Auth0 / External Identity Provider Integration |
| **Data Persistence** | Relational 1-to-N User-to-Provisions Mapping | Complex Multi-Tenant Sub-Provider Hierarchies |
| **Workload Controls** | 1-Click VM/App Group Power Actions & Snapshots | Custom Drag-and-Drop Boot Delay Timers |
| **Networking & Security** | North-South FW Rules, SNAT/DNAT Setup, Subnet Mapping | East-West Micro-segmentation, L2/IPsec VPN |
| **Storage & DR** | 3-Tier Storage Capacity Gauges & RPO Health Badge | Advanced S3 Object Lock Rules & 3-Site DR |
| **Financials & Reports** | Monthly Cost Ticker & User Billing Masking | Dynamic Cost Optimization & Anomaly Alerts |
