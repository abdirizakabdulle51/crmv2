import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Search, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useCrm } from "@/lib/crm-context.tsx";

const statusLabel: Record<string, string> = {
  preboarding: "Preboarding",
  active: "Active",
  on_leave: "On leave",
  suspended: "Suspended",
  departed: "Departed",
};

export default function EmployeesPage() {
  const { canManageHr } = useCrm();
  const [includeDeparted, setIncludeDeparted] = useState(false);
  const [search, setSearch] = useState("");
  const [departmentOpen, setDepartmentOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const employees = useQuery(api.hr.listEmployees, { includeDeparted });
  const countries = useQuery(api.hr.listAccessibleCountries, {});
  const createDepartment = useMutation(api.hr.createDepartment);
  const filtered = useMemo(
    () =>
      (employees ?? []).filter((row) =>
        `${row.fullName} ${row.employeeNumber} ${row.jobTitle} ${row.departmentName ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [employees, search],
  );

  if (!employees || !countries) {
    return (
      <div className="space-y-5 p-6 md:p-8">
        <Skeleton className="h-9 w-60" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const submitDepartment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      await createDepartment({
        name: String(data.get("name") ?? ""),
        code: String(data.get("code") ?? ""),
        countryId:
          data.get("countryId") && data.get("countryId") !== "global"
            ? (String(data.get("countryId")) as Id<"countries">)
            : undefined,
      });
      toast.success("Department created");
      setDepartmentOpen(false);
    } catch (error) {
      toast.error("Department could not be created", {
        description:
          error instanceof Error ? error.message : "Please review the form",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employees</h1>
          <p className="mt-1 text-muted-foreground">
            Secure workforce records and reporting relationships.
          </p>
        </div>
        {canManageHr ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDepartmentOpen(true)}>
              New department
            </Button>
            <Button asChild>
              <Link to="/people/employees/new">
                <Plus className="mr-2 h-4 w-4" />
                New employee
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search people, roles, or departments"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={includeDeparted}
              onCheckedChange={(checked) =>
                setIncludeDeparted(checked === true)
              }
            />
            Include departed employees
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {filtered.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3">Employee</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3">Country</th>
                    <th className="px-5 py-3">Managers</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Security</th>
                    {canManageHr ? <th className="px-5 py-3">Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((employee) => (
                    <tr key={employee._id} className="border-b last:border-0">
                      <td className="px-5 py-4">
                        <Link
                          to={`/people/employees/${employee._id}`}
                          className="font-medium hover:text-cyan-600 hover:underline"
                        >
                          {employee.fullName}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {employee.employeeNumber} · {employee.workEmail}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p>{employee.jobTitle}</p>
                        <p className="text-xs text-muted-foreground">
                          {employee.departmentName ?? "No department"}
                        </p>
                      </td>
                      <td className="px-5 py-4">{employee.countryName}</td>
                      <td className="px-5 py-4">
                        {employee.managers.length ? (
                          employee.managers.map((manager) => (
                            <div key={manager?.id} className="text-xs">
                              <span className="font-medium">
                                {manager?.name}
                              </span>{" "}
                              <span className="text-muted-foreground">
                                ({manager?.type})
                              </span>
                            </div>
                          ))
                        ) : (
                          <span className="text-muted-foreground">
                            Top level
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <Badge variant="outline">
                          {statusLabel[employee.status]}
                        </Badge>
                      </td>
                      <td className="px-5 py-4">
                        {employee.complianceReady ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <ShieldCheck className="h-4 w-4" />
                            Ready
                          </span>
                        ) : (
                          <span className="text-amber-700">Action needed</span>
                        )}
                      </td>
                      {canManageHr ? (
                        <td className="px-5 py-4">
                          <Button asChild size="sm" variant="ghost">
                            <Link to={`/people/employees/${employee._id}/edit`}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </Link>
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <h2 className="mt-3 font-semibold">No employees found</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create the first profile or adjust your search.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={departmentOpen} onOpenChange={setDepartmentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New department</DialogTitle>
            <DialogDescription>
              Use a global department or limit it to one country.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitDepartment} className="space-y-4">
            <Field label="Name">
              <Input name="name" required />
            </Field>
            <Field label="Code">
              <Input name="code" required placeholder="e.g. FIN" />
            </Field>
            <Field label="Scope">
              <select
                name="countryId"
                defaultValue="global"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="global">Global</option>
                {countries.map((country) => (
                  <option key={country._id} value={country._id}>
                    {country.name}
                  </option>
                ))}
              </select>
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDepartmentOpen(false)}
              >
                Cancel
              </Button>
              <Button disabled={pending}>
                {pending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
