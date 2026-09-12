import { useMutation, useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ShieldCheck, UserRound } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";

export default function EmployeeDetailPage() {
  const { employeeId } = useParams();
  const detail = useQuery(
    api.hr.getEmployee,
    employeeId ? { employeeId: employeeId as Id<"employeeProfiles"> } : "skip",
  );
  const directory = useQuery(api.hr.listEmployees, { includeDeparted: true });
  const updateLifecycleTask = useMutation(api.hr.updateLifecycleTask);
  if (!detail || !directory)
    return (
      <div className="space-y-5 p-6 md:p-8">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  const employee = directory.find((row) => row._id === detail.employee._id);
  if (!employee) return null;
  return (
    <div className="space-y-6 p-6 md:p-8">
      <Button asChild variant="ghost" className="-ml-3">
        <Link to="/people/employees">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Employees
        </Link>
      </Button>
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-cyan-50 p-4 text-cyan-700 dark:bg-cyan-950/40">
          <UserRound className="h-7 w-7" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {employee.fullName}
            </h1>
            <Badge variant="outline">{employee.status.replace("_", " ")}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            {employee.jobTitle} · {employee.employeeNumber}
          </p>
        </div>
        {detail.canManage ? (
          <Button asChild className="ml-auto">
            <Link to={`/people/employees/${employee._id}/edit`}>
              Edit employee
            </Link>
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Employment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Fact
              label="Department"
              value={employee.departmentName ?? "Not assigned"}
            />
            <Fact label="Country" value={employee.countryName} />
            <Fact label="Work email" value={employee.workEmail} />
            <Fact label="Phone" value={employee.phone ?? "Not provided"} />
            <Fact label="Employment type" value={employee.employmentType} />
            <Fact label="Start date" value={employee.startDate} />
            <Fact
              label="Probation end"
              value={employee.probationEndDate ?? "Not set"}
            />
            <Fact label="End date" value={employee.endDate ?? "Not set"} />
            <Fact
              label="Primary manager"
              value={
                employee.managers.find((row) => row?.type === "primary")
                  ?.name ?? "Not assigned"
              }
            />
            <Fact
              label="Secondary manager"
              value={
                employee.managers.find((row) => row?.type === "secondary")
                  ?.name ?? "Not assigned"
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Security readiness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Readiness
              label="Screening"
              ready={employee.screeningStatus !== "pending"}
            />
            <Readiness
              label="NDA acknowledged"
              ready={Boolean(employee.ndaAcknowledgedAt)}
            />
            <Readiness
              label="Security training"
              ready={Boolean(employee.securityTrainingCompletedAt)}
            />
          </CardContent>
        </Card>
      </div>
      {employee.status === "departed" ? (
        <Card>
          <CardHeader>
            <CardTitle>Offboarding</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Fact
              label="Departure type"
              value={
                employee.departureType?.replace("_", " ") ?? "Not recorded"
              }
            />
            <Fact
              label="Departure reason"
              value={employee.departureReason ?? "Not recorded"}
            />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Lifecycle checklist</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          {(["onboarding", "offboarding"] as const).map((phase) => {
            const tasks = detail.lifecycleTasks.filter(
              (task) => task.phase === phase,
            );
            if (!tasks.length) return null;
            return (
              <div key={phase}>
                <h3 className="mb-3 text-sm font-semibold capitalize">
                  {phase}
                </h3>
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div
                      key={task._id}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${task.status === "completed" ? "bg-emerald-500" : "bg-amber-500"}`}
                      />
                      <span className="flex-1 text-sm">{task.title}</span>
                      {detail.canManage && task.status === "pending" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void updateLifecycleTask({
                              taskId: task._id,
                              completed: true,
                            })
                              .then(() => toast.success("Checklist updated"))
                              .catch((error) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Update failed",
                                ),
                              )
                          }
                        >
                          Complete
                        </Button>
                      ) : (
                        <Badge variant="outline">{task.status}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Audit timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.events.length ? (
            <div className="space-y-4">
              {detail.events.map((event) => (
                <div
                  key={event._id}
                  className="border-l-2 border-cyan-500 pl-4"
                >
                  <p className="text-sm font-medium">{event.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(event.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No audit events are available for your access level.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium capitalize">{value}</p>
    </div>
  );
}
function Readiness({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <span className="text-sm">{label}</span>
      {ready ? (
        <ShieldCheck className="h-4 w-4 text-emerald-600" />
      ) : (
        <Badge variant="outline">Action needed</Badge>
      )}
    </div>
  );
}
