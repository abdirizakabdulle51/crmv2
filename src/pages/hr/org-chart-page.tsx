import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Minus, Network, Plus, Search } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";

const CARD_WIDTH = 220;
const CARD_HEIGHT = 92;
const X_GAP = 36;
const Y_GAP = 72;

export default function OrgChartPage() {
  const [includeDeparted, setIncludeDeparted] = useState(false);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("all");
  const [department, setDepartment] = useState("all");
  const [zoom, setZoom] = useState(1);
  const employees = useQuery(api.hr.listEmployees, { includeDeparted });
  const filtered = useMemo(
    () =>
      (employees ?? []).filter(
        (employee) =>
          (country === "all" || employee.countryId === country) &&
          (department === "all" || employee.departmentId === department) &&
          `${employee.fullName} ${employee.jobTitle}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [country, department, employees, search],
  );
  const chart = useMemo(() => buildChart(filtered), [filtered]);
  const countries = [
    ...new Map(
      (employees ?? []).map((row) => [row.countryId, row.countryName]),
    ).entries(),
  ];
  const departments = [
    ...new Map(
      (employees ?? [])
        .filter((row) => row.departmentId)
        .map((row) => [row.departmentId!, row.departmentName ?? "Unnamed"]),
    ).entries(),
  ];
  if (!employees)
    return (
      <div className="space-y-5 p-6 md:p-8">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Organizational Chart
        </h1>
        <p className="mt-1 text-muted-foreground">
          Generated automatically from employee reporting relationships. Dotted
          lines represent secondary managers.
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find an employee"
            />
          </div>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            <option value="all">All countries</option>
            {countries.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="all">All departments</option>
            {departments.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
            <Checkbox
              checked={includeDeparted}
              onCheckedChange={(checked) =>
                setIncludeDeparted(checked === true)
              }
            />
            Historical
          </label>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="outline"
              onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}
              aria-label="Zoom out"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}
              aria-label="Zoom in"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {filtered.length ? (
            <div className="overflow-auto p-6">
              <div
                className="relative"
                style={{
                  width: chart.width * zoom,
                  height: chart.height * zoom,
                }}
              >
                <div
                  className="relative origin-top-left"
                  style={{
                    width: chart.width,
                    height: chart.height,
                    transform: `scale(${zoom})`,
                  }}
                >
                  <svg
                    className="absolute inset-0"
                    width={chart.width}
                    height={chart.height}
                    aria-hidden="true"
                  >
                    {chart.edges.map((edge) => {
                      const from = chart.positions.get(edge.managerId);
                      const to = chart.positions.get(edge.employeeId);
                      if (!from || !to) return null;
                      const x1 = from.x + CARD_WIDTH / 2,
                        y1 = from.y + CARD_HEIGHT,
                        x2 = to.x + CARD_WIDTH / 2,
                        y2 = to.y;
                      const mid = (y1 + y2) / 2;
                      return (
                        <path
                          key={`${edge.employeeId}-${edge.managerId}`}
                          data-line-type={edge.type}
                          d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                          fill="none"
                          stroke={
                            edge.type === "secondary" ? "#94a3b8" : "#22aeb3"
                          }
                          strokeWidth="2"
                          strokeDasharray={
                            edge.type === "secondary" ? "6 5" : undefined
                          }
                        />
                      );
                    })}
                  </svg>
                  {filtered.map((employee) => {
                    const position = chart.positions.get(employee._id);
                    if (!position) return null;
                    return (
                      <Link
                        to={`/people/employees/${employee._id}`}
                        key={employee._id}
                        className="absolute rounded-xl border bg-card p-3 shadow-sm"
                        style={{
                          left: position.x,
                          top: position.y,
                          width: CARD_WIDTH,
                          height: CARD_HEIGHT,
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold">
                              {employee.fullName}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {employee.jobTitle}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px]"
                          >
                            {employee.employeeNumber}
                          </Badge>
                        </div>
                        <p className="mt-3 truncate text-xs text-muted-foreground">
                          {employee.departmentName ?? "No department"} ·{" "}
                          {employee.countryName}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center py-20 text-center">
              <Network className="h-9 w-9 text-muted-foreground" />
              <h2 className="mt-3 font-semibold">
                Organization chart is empty
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                No employees match the selected filters.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type Row = NonNullable<
  ReturnType<typeof useQuery<typeof api.hr.listEmployees>>
>[number];
function buildChart(employees: Row[]) {
  const ids = new Set(employees.map((row) => row._id));
  const edges = employees.flatMap((employee) =>
    employee.managers
      .filter(
        (manager): manager is NonNullable<typeof manager> =>
          manager !== null && ids.has(manager.id),
      )
      .map((manager) => ({
        employeeId: employee._id,
        managerId: manager.id,
        type: manager.type,
      })),
  );
  const levels = new Map<string, number>();
  const levelOf = (id: string, visiting = new Set<string>()): number => {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const managers = edges
      .filter((edge) => edge.employeeId === id)
      .map((edge) => edge.managerId);
    const level = managers.length
      ? Math.max(...managers.map((managerId) => levelOf(managerId, visiting))) +
        1
      : 0;
    levels.set(id, level);
    visiting.delete(id);
    return level;
  };
  employees.forEach((row) => levelOf(row._id));
  const rows = new Map<number, Row[]>();
  employees.forEach((employee) =>
    rows.set(levels.get(employee._id) ?? 0, [
      ...(rows.get(levels.get(employee._id) ?? 0) ?? []),
      employee,
    ]),
  );
  const maxCount = Math.max(1, ...[...rows.values()].map((row) => row.length));
  const width = maxCount * (CARD_WIDTH + X_GAP) - X_GAP;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, row] of rows) {
    row.sort((left, right) => {
      const leftManager =
        left.managers.find((manager) => manager?.type === "primary")?.name ??
        "";
      const rightManager =
        right.managers.find((manager) => manager?.type === "primary")?.name ??
        "";
      return (
        leftManager.localeCompare(rightManager) ||
        left.fullName.localeCompare(right.fullName)
      );
    });
    const rowWidth = row.length * (CARD_WIDTH + X_GAP) - X_GAP;
    row.forEach((employee, index) =>
      positions.set(employee._id, {
        x: (width - rowWidth) / 2 + index * (CARD_WIDTH + X_GAP),
        y: level * (CARD_HEIGHT + Y_GAP),
      }),
    );
  }
  return {
    edges,
    positions,
    width,
    height:
      (Math.max(0, ...levels.values()) + 1) * (CARD_HEIGHT + Y_GAP) - Y_GAP,
  };
}
