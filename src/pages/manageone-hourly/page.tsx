import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { canViewCloudHealth } from "@/lib/role-access.ts";
import { useCrm } from "@/lib/crm-context.tsx";
import { cn } from "@/lib/utils.ts";
import {
  Activity,
  Archive,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Cloud,
  Cpu,
  Database,
  Download,
  HardDrive,
  Network,
  Search,
  Server,
  Shield,
  ShieldAlert,
} from "lucide-react";

type TimeWindow = "24h" | "7d" | "30d";
type ServiceView =
  | "overview"
  | "compute"
  | "storage"
  | "backup"
  | "network"
  | "security"
  | "raw";

const monitoredRegions = ["Hoa-Mogadishu-2", "Mogadishu-region-hq3"] as const;
const monitoredRegionSet = new Set<string>(monitoredRegions);
const monitoredRegionValue = "__monitored__";
const allTenantsValue = "__all__";

type Snapshot = {
  _id: string;
  tenantName: string;
  vdcId?: string;
  domainId?: string;
  regionName?: string;
  regionId?: string;
  capturedHour: number;
  ecsInstances: number;
  cceNodes?: number;
  bmsInstances?: number;
  ecsCores: number;
  ecsRamGb: number;
  evsGb: number;
  sfsGb?: number;
  csbsGb?: number;
  vbsGb?: number;
  obsGb: number;
  publicIps: number;
  loadBalancers: number;
  vpnGateways: number;
  vpcepEndpoints?: number;
  natGateways: number;
  wafInstances: number;
  wafBasicInstances?: number;
  wafEnterpriseInstances?: number;
};

function formatNumber(value: number | undefined | null, maximumFractionDigits = 1) {
  if (value == null) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function formatCompact(value: number | undefined | null) {
  if (value == null) return "-";
  if (Math.abs(value) >= 1_000_000) {
    return `${formatNumber(value / 1_000_000)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${formatNumber(value / 1_000)}K`;
  }
  return formatNumber(value);
}

function formatDateTime(value: number | undefined | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function windowStart(window: TimeWindow) {
  const hours = window === "24h" ? 24 : window === "7d" ? 24 * 7 : 24 * 30;
  return Date.now() - hours * 60 * 60 * 1000;
}

function rowRegion(row: Snapshot) {
  return row.regionName || row.regionId || "Unknown";
}

function positive(value: number | undefined | null) {
  return value != null && value > 0;
}

function csvCell(value: string | number | undefined | null) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadVisibleRows(rows: Snapshot[]) {
  const headers = [
    "Tenant",
    "Region",
    "Region ID",
    "Captured",
    "ECS",
    "ECS-CCE",
    "BMS",
    "vCPU",
    "RAM GB",
    "EVS GB",
    "SFS GB",
    "CSBS GB",
    "VBS GB",
    "OBS GB",
    "EIP",
    "ELB",
    "VPN",
    "VPCEP",
    "NAT",
    "WAF",
    "WAF Basic",
    "WAF Enterprise",
  ];
  const lines = rows.map((row) =>
    [
      row.tenantName,
      row.regionName,
      row.regionId,
      formatDateTime(row.capturedHour),
      row.ecsInstances,
      row.cceNodes ?? 0,
      row.bmsInstances ?? 0,
      row.ecsCores,
      row.ecsRamGb,
      row.evsGb,
      row.sfsGb ?? 0,
      row.csbsGb ?? 0,
      row.vbsGb ?? 0,
      row.obsGb,
      row.publicIps,
      row.loadBalancers,
      row.vpnGateways,
      row.vpcepEndpoints ?? 0,
      row.natGateways,
      row.wafInstances,
      row.wafBasicInstances ?? 0,
      row.wafEnterpriseInstances ?? 0,
    ]
      .map(csvCell)
      .join(","),
  );
  const blob = new Blob([[headers.map(csvCell).join(","), ...lines].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `manageone-hourly-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ManageOneHourlyPage() {
  const { currentUser } = useCrm();
  const canView = canViewCloudHealth(currentUser?.role);
  const snapshots = useQuery(
    api.manageOneHourlyMonitoring.latest,
    canView ? { limit: 500 } : "skip",
  ) as Snapshot[] | undefined;
  const latestRun = useQuery(
    api.manageOneHourlyMonitoring.latestRun,
    canView ? {} : "skip",
  );
  const [tenant, setTenant] = useState(allTenantsValue);
  const [tenantOpen, setTenantOpen] = useState(false);
  const [region, setRegion] = useState(monitoredRegionValue);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("24h");
  const [serviceView, setServiceView] = useState<ServiceView>("overview");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const filteredSnapshots = useMemo(() => {
    if (!snapshots) return [];

    const cutoff = windowStart(timeWindow);

    return snapshots.filter((row) => {
      if (row.capturedHour < cutoff) return false;
      const currentRegion = rowRegion(row);
      if (region === monitoredRegionValue && !monitoredRegionSet.has(currentRegion)) {
        return false;
      }
      if (region !== monitoredRegionValue && currentRegion !== region) {
        return false;
      }
      if (tenant !== allTenantsValue && row.tenantName !== tenant) {
        return false;
      }
      return true;
    });
  }, [region, snapshots, tenant, timeWindow]);

  const tenants = useMemo(() => {
    if (!snapshots) return [];
    return Array.from(new Set(snapshots.map((row) => row.tenantName)))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [snapshots]);

  const regions = useMemo(() => {
    return monitoredRegions;
  }, []);

  const summary = useMemo(() => {
    const latestHour = filteredSnapshots[0]?.capturedHour;
    const latestRows = latestHour
      ? filteredSnapshots.filter((row) => row.capturedHour === latestHour)
      : [];

    return latestRows.reduce(
      (totals, row) => ({
        tenants: totals.tenants + 1,
        ecs: totals.ecs + row.ecsInstances,
        cce: totals.cce + (row.cceNodes ?? 0),
        bms: totals.bms + (row.bmsInstances ?? 0),
        vcpu: totals.vcpu + row.ecsCores,
        ram: totals.ram + row.ecsRamGb,
        evs: totals.evs + row.evsGb,
        sfs: totals.sfs + (row.sfsGb ?? 0),
        csbs: totals.csbs + (row.csbsGb ?? 0),
        vbs: totals.vbs + (row.vbsGb ?? 0),
        obs: totals.obs + row.obsGb,
        eip: totals.eip + row.publicIps,
        elb: totals.elb + row.loadBalancers,
        vpn: totals.vpn + row.vpnGateways,
        vpcep: totals.vpcep + (row.vpcepEndpoints ?? 0),
        nat: totals.nat + row.natGateways,
        waf: totals.waf + row.wafInstances,
        wafBasic: totals.wafBasic + (row.wafBasicInstances ?? 0),
        wafEnterprise: totals.wafEnterprise + (row.wafEnterpriseInstances ?? 0),
      }),
      {
        tenants: 0,
        ecs: 0,
        cce: 0,
        bms: 0,
        vcpu: 0,
        ram: 0,
        evs: 0,
        sfs: 0,
        csbs: 0,
        vbs: 0,
        obs: 0,
        eip: 0,
        elb: 0,
        vpn: 0,
        vpcep: 0,
        nat: 0,
        waf: 0,
        wafBasic: 0,
        wafEnterprise: 0,
      },
    );
  }, [filteredSnapshots]);

  if (!canView) {
    return (
      <div className="p-6 md:p-8">
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <ShieldAlert className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Access Restricted</h2>
          <p className="max-w-md text-center text-muted-foreground">
            Only Monitoring, Country GM, Head of Business, or CEO can view
            hourly monitoring.
          </p>
        </div>
      </div>
    );
  }

  if (!snapshots || latestRun === undefined) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const selectedTenantLabel =
    tenant === allTenantsValue ? "All companies" : tenant || "All companies";

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Hourly Monitoring
          </h1>
          <p className="mt-1 text-muted-foreground">
            Read-only ManageOne resource snapshots collected by HTGweb.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            Last run: {formatDateTime(latestRun?.finishedAt ?? latestRun?.startedAt)}
          </span>
          {latestRun ? <Badge variant="secondary">{latestRun.status}</Badge> : null}
          <Badge variant="outline">HOA + HQ3</Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          icon={Cloud}
          label="Tenants"
          value={formatNumber(summary.tenants)}
          detail={tenant === allTenantsValue ? "Selected scope" : selectedTenantLabel}
        />
        <SummaryCard
          icon={Cpu}
          label="Compute"
          value={formatNumber(summary.ecs + summary.cce + summary.bms)}
          detail={`ECS ${formatNumber(summary.ecs)} · CCE ${formatNumber(summary.cce)} · BMS ${formatNumber(summary.bms)}`}
        />
        <SummaryCard
          icon={HardDrive}
          label="Storage"
          value={`${formatCompact(summary.evs + summary.obs + summary.sfs)} GB`}
          detail={`EVS ${formatCompact(summary.evs)} · OBS ${formatCompact(summary.obs)} · SFS ${formatCompact(summary.sfs)}`}
        />
        <SummaryCard
          icon={Network}
          label="Network"
          value={formatNumber(
            summary.eip + summary.elb + summary.vpn + summary.vpcep + summary.nat,
          )}
          detail={`EIP ${formatNumber(summary.eip)} · ELB ${formatNumber(summary.elb)} · VPN ${formatNumber(summary.vpn)}`}
        />
        <SummaryCard
          icon={Shield}
          label="Security"
          value={formatNumber(summary.waf)}
          detail={`Basic ${formatNumber(summary.wafBasic)} · Enterprise ${formatNumber(summary.wafEnterprise)}`}
        />
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-primary" />
                Latest Snapshots
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Grouped by service area. Use Raw Table when you need every column.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 sm:w-auto"
              onClick={() => downloadVisibleRows(filteredSnapshots)}
              disabled={filteredSnapshots.length === 0}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>

          <div className="grid gap-2 md:grid-cols-[minmax(220px,1.2fr)_minmax(180px,.8fr)_minmax(160px,.7fr)]">
            <Popover open={tenantOpen} onOpenChange={setTenantOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={tenantOpen}
                  className="justify-between"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{selectedTenantLabel}</span>
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-(--radix-popover-trigger-width) p-0"
                align="start"
              >
                <Command>
                  <CommandInput placeholder="Search companies..." />
                  <CommandList>
                    <CommandEmpty>No companies found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="All companies"
                        onSelect={() => {
                          setTenant(allTenantsValue);
                          setTenantOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            tenant === allTenantsValue ? "opacity-100" : "opacity-0",
                          )}
                        />
                        All companies
                      </CommandItem>
                      {tenants.map((item) => (
                        <CommandItem
                          key={item}
                          value={item}
                          onSelect={() => {
                            setTenant(item);
                            setTenantOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              tenant === item ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="truncate">{item}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={monitoredRegionValue}>HOA + HQ3</SelectItem>
                {regions.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={timeWindow}
              onValueChange={(value) => setTimeWindow(value as TimeWindow)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filteredSnapshots.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
              <Activity className="h-8 w-8 text-muted-foreground" />
              <div className="font-medium">No hourly snapshots found</div>
              <p className="text-sm text-muted-foreground">
                Try a wider time range or select All companies.
              </p>
            </div>
          ) : (
            <Tabs
              value={serviceView}
              onValueChange={(value) => setServiceView(value as ServiceView)}
            >
              <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start bg-muted/60 p-1 lg:w-fit">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="compute">Compute</TabsTrigger>
                <TabsTrigger value="storage">Storage</TabsTrigger>
                <TabsTrigger value="backup">Backup</TabsTrigger>
                <TabsTrigger value="network">Network</TabsTrigger>
                <TabsTrigger value="security">Security</TabsTrigger>
                <TabsTrigger value="raw">Raw Table</TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                <OverviewTable
                  rows={filteredSnapshots}
                  expandedRowId={expandedRowId}
                  onToggleRow={(id) =>
                    setExpandedRowId(expandedRowId === id ? null : id)
                  }
                />
              </TabsContent>
              <TabsContent value="compute">
                <FocusedTable rows={filteredSnapshots} columns={computeColumns} />
              </TabsContent>
              <TabsContent value="storage">
                <FocusedTable rows={filteredSnapshots} columns={storageColumns} />
              </TabsContent>
              <TabsContent value="backup">
                <FocusedTable rows={filteredSnapshots} columns={backupColumns} />
              </TabsContent>
              <TabsContent value="network">
                <FocusedTable rows={filteredSnapshots} columns={networkColumns} />
              </TabsContent>
              <TabsContent value="security">
                <FocusedTable rows={filteredSnapshots} columns={securityColumns} />
              </TabsContent>
              <TabsContent value="raw">
                <RawTable rows={filteredSnapshots} />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const computeColumns = [
  ["ECS", (row: Snapshot) => row.ecsInstances],
  ["ECS-CCE", (row: Snapshot) => row.cceNodes ?? 0],
  ["BMS", (row: Snapshot) => row.bmsInstances ?? 0],
  ["vCPU", (row: Snapshot) => row.ecsCores],
  ["RAM GB", (row: Snapshot) => row.ecsRamGb],
] as const;

const storageColumns = [
  ["EVS GB", (row: Snapshot) => row.evsGb],
  ["SFS GB", (row: Snapshot) => row.sfsGb ?? 0],
  ["OBS GB", (row: Snapshot) => row.obsGb],
] as const;

const backupColumns = [
  ["CSBS GB", (row: Snapshot) => row.csbsGb ?? 0],
  ["VBS GB", (row: Snapshot) => row.vbsGb ?? 0],
] as const;

const networkColumns = [
  ["EIP", (row: Snapshot) => row.publicIps],
  ["ELB", (row: Snapshot) => row.loadBalancers],
  ["VPN", (row: Snapshot) => row.vpnGateways],
  ["VPCEP", (row: Snapshot) => row.vpcepEndpoints ?? 0],
  ["NAT", (row: Snapshot) => row.natGateways],
] as const;

const securityColumns = [
  ["WAF", (row: Snapshot) => row.wafInstances],
  ["WAF Basic", (row: Snapshot) => row.wafBasicInstances ?? 0],
  ["WAF Enterprise", (row: Snapshot) => row.wafEnterpriseInstances ?? 0],
] as const;

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Cloud;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-medium uppercase text-muted-foreground">
            {label}
          </div>
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="mt-3 text-2xl font-bold">{value}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

function OverviewTable({
  rows,
  expandedRowId,
  onToggleRow,
}: {
  rows: Snapshot[];
  expandedRowId: string | null;
  onToggleRow: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1050px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="p-3 text-left font-medium">Tenant</th>
            <th className="p-3 text-left font-medium">Region</th>
            <th className="p-3 text-left font-medium">Captured</th>
            <th className="p-3 text-left font-medium">Compute</th>
            <th className="p-3 text-left font-medium">Storage</th>
            <th className="p-3 text-left font-medium">Backup</th>
            <th className="p-3 text-left font-medium">Network</th>
            <th className="p-3 text-left font-medium">Security</th>
            <th className="p-3 text-right font-medium">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isExpanded = expandedRowId === row._id;

            return (
              <FragmentRow
                key={row._id}
                row={row}
                isExpanded={isExpanded}
                onToggleRow={onToggleRow}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  row,
  isExpanded,
  onToggleRow,
}: {
  row: Snapshot;
  isExpanded: boolean;
  onToggleRow: (id: string) => void;
}) {
  return (
    <>
      <tr className="border-b align-top last:border-0">
        <td className="p-3">
          <TenantCell row={row} />
        </td>
        <td className="p-3">
          <RegionCell row={row} />
        </td>
        <td className="p-3">{formatDateTime(row.capturedHour)}</td>
        <td className="p-3">
          <ChipList
            items={[
              ["ECS", row.ecsInstances],
              ["CCE", row.cceNodes ?? 0],
              ["BMS", row.bmsInstances ?? 0],
              ["vCPU", row.ecsCores],
              ["RAM", row.ecsRamGb, "GB"],
            ]}
          />
        </td>
        <td className="p-3">
          <ChipList
            items={[
              ["EVS", row.evsGb, "GB"],
              ["SFS", row.sfsGb ?? 0, "GB"],
              ["OBS", row.obsGb, "GB"],
            ]}
          />
        </td>
        <td className="p-3">
          <ChipList
            items={[
              ["CSBS", row.csbsGb ?? 0, "GB"],
              ["VBS", row.vbsGb ?? 0, "GB"],
            ]}
          />
        </td>
        <td className="p-3">
          <ChipList
            items={[
              ["EIP", row.publicIps],
              ["ELB", row.loadBalancers],
              ["VPN", row.vpnGateways],
              ["VPCEP", row.vpcepEndpoints ?? 0],
              ["NAT", row.natGateways],
            ]}
          />
        </td>
        <td className="p-3">
          <ChipList
            items={[
              ["WAF", row.wafInstances],
              ["Basic", row.wafBasicInstances ?? 0],
              ["Ent", row.wafEnterpriseInstances ?? 0],
            ]}
          />
        </td>
        <td className="p-3 text-right">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={() => onToggleRow(row._id)}
          >
            {isExpanded ? "Hide" : "Open"}
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                isExpanded && "rotate-180",
              )}
            />
          </Button>
        </td>
      </tr>
      {isExpanded ? (
        <tr className="border-b bg-muted/20">
          <td colSpan={9} className="p-4">
            <DetailGrid row={row} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function FocusedTable({
  rows,
  columns,
}: {
  rows: Snapshot[];
  columns: readonly (readonly [string, (row: Snapshot) => number])[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="p-3 text-left font-medium">Tenant</th>
            <th className="p-3 text-left font-medium">Region</th>
            <th className="p-3 text-left font-medium">Captured</th>
            {columns.map(([label]) => (
              <th key={label} className="p-3 text-right font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row._id} className="border-b last:border-0">
              <td className="p-3">
                <TenantCell row={row} />
              </td>
              <td className="p-3">
                <RegionCell row={row} />
              </td>
              <td className="p-3">{formatDateTime(row.capturedHour)}</td>
              {columns.map(([label, getValue]) => (
                <td key={label} className="p-3 text-right">
                  {formatNumber(getValue(row))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawTable({ rows }: { rows: Snapshot[] }) {
  const columns = [
    ...computeColumns,
    ...storageColumns,
    ...backupColumns,
    ...networkColumns,
    ...securityColumns,
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1600px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="p-3 text-left font-medium">Tenant</th>
            <th className="p-3 text-left font-medium">Region</th>
            <th className="p-3 text-left font-medium">Captured</th>
            {columns.map(([label]) => (
              <th key={label} className="p-3 text-right font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row._id} className="border-b last:border-0">
              <td className="p-3">
                <TenantCell row={row} />
              </td>
              <td className="p-3">
                <RegionCell row={row} />
              </td>
              <td className="p-3">{formatDateTime(row.capturedHour)}</td>
              {columns.map(([label, getValue]) => (
                <td key={label} className="p-3 text-right">
                  {formatNumber(getValue(row))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailGrid({ row }: { row: Snapshot }) {
  const groups = [
    {
      title: "Compute",
      icon: Server,
      items: [
        ["ECS", row.ecsInstances],
        ["ECS-CCE", row.cceNodes ?? 0],
        ["BMS", row.bmsInstances ?? 0],
        ["vCPU", row.ecsCores],
        ["RAM GB", row.ecsRamGb],
      ],
    },
    {
      title: "Storage",
      icon: Database,
      items: [
        ["EVS GB", row.evsGb],
        ["SFS GB", row.sfsGb ?? 0],
        ["OBS GB", row.obsGb],
      ],
    },
    {
      title: "Backup",
      icon: Archive,
      items: [
        ["CSBS GB", row.csbsGb ?? 0],
        ["VBS GB", row.vbsGb ?? 0],
      ],
    },
    {
      title: "Network",
      icon: Network,
      items: [
        ["EIP", row.publicIps],
        ["ELB", row.loadBalancers],
        ["VPN", row.vpnGateways],
        ["VPCEP", row.vpcepEndpoints ?? 0],
        ["NAT", row.natGateways],
      ],
    },
    {
      title: "Security",
      icon: Shield,
      items: [
        ["WAF", row.wafInstances],
        ["WAF Basic", row.wafBasicInstances ?? 0],
        ["WAF Enterprise", row.wafEnterpriseInstances ?? 0],
      ],
    },
  ] as const;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {groups.map((group) => (
        <div key={group.title} className="rounded-lg border bg-background p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <group.icon className="h-4 w-4 text-primary" />
            {group.title}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {group.items.map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted/50 p-2">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="text-base font-semibold">{formatNumber(value)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TenantCell({ row }: { row: Snapshot }) {
  return (
    <div>
      <div className="font-medium">{row.tenantName}</div>
      <div className="max-w-[220px] truncate text-xs text-muted-foreground">
        {row.vdcId}
      </div>
    </div>
  );
}

function RegionCell({ row }: { row: Snapshot }) {
  return (
    <div>
      <div>{row.regionName || row.regionId || "-"}</div>
      {row.regionName && row.regionId ? (
        <div className="text-xs text-muted-foreground">{row.regionId}</div>
      ) : null}
    </div>
  );
}

function ChipList({
  items,
}: {
  items: readonly (readonly [string, number | undefined | null, string?])[];
}) {
  const nonZeroItems = items.filter(([, value]) => positive(value));

  if (nonZeroItems.length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }

  return (
    <div className="flex max-w-[260px] flex-wrap gap-1.5">
      {nonZeroItems.map(([label, value, unit]) => (
        <Badge key={`${label}-${unit ?? ""}`} variant="secondary" className="font-normal">
          {label} <span className="ml-1 font-semibold">{formatNumber(value)}</span>
          {unit ? <span className="ml-0.5 text-muted-foreground">{unit}</span> : null}
        </Badge>
      ))}
    </div>
  );
}
