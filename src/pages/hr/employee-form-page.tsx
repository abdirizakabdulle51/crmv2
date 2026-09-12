import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useCrm } from "@/lib/crm-context.tsx";

export default function EmployeeFormPage() {
  const { employeeId } = useParams();
  const isEdit = Boolean(employeeId);
  const { canManageHr } = useCrm();
  const navigate = useNavigate();
  const detail = useQuery(
    api.hr.getEmployee,
    isEdit ? { employeeId: employeeId as Id<"employeeProfiles"> } : "skip",
  );
  const employees = useQuery(api.hr.listEmployees, {});
  const countries = useQuery(api.hr.listAccessibleCountries, {});
  const departments = useQuery(api.hr.listDepartments, {});
  const users = useQuery(api.hr.listLinkableUsers, {});
  const createEmployee = useMutation(api.hr.createEmployee);
  const updateEmployee = useMutation(api.hr.updateEmployee);
  const [pending, setPending] = useState(false);
  const [countryId, setCountryId] = useState("");
  const [status, setStatus] = useState("preboarding");
  const [primaryManagerId, setPrimaryManagerId] = useState("none");
  const [secondaryManagerId, setSecondaryManagerId] = useState("none");

  useEffect(() => {
    if (detail) {
      setCountryId(detail.employee.countryId);
      setStatus(detail.employee.status);
      setPrimaryManagerId(
        detail.lines.find((line) => line.type === "primary")?.managerId ??
          "none",
      );
      setSecondaryManagerId(
        detail.lines.find((line) => line.type === "secondary")?.managerId ??
          "none",
      );
    } else if (!isEdit && countries?.length && !countryId) {
      setCountryId(countries[0]._id);
    }
  }, [countries, countryId, detail, isEdit]);

  if (!canManageHr) return <Navigate to="/people/employees" replace />;
  if (
    !employees ||
    !countries ||
    !departments ||
    !users ||
    (isEdit && !detail)
  ) {
    return (
      <div className="space-y-5 p-6 md:p-8">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }
  if (detail && !detail.canManage)
    return <Navigate to="/people/employees" replace />;
  const current = detail?.employee;
  const availableManagers = employees.filter(
    (row) => row._id !== employeeId && row.status !== "suspended",
  );
  const availableDepartments = departments.filter(
    (row) => !row.countryId || row.countryId === countryId,
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    const data = new FormData(event.currentTarget);
    const optional = (name: string) =>
      String(data.get(name) ?? "").trim() || undefined;
    const id = <T extends string>(name: string) => {
      const value = optional(name);
      return value && value !== "none" ? (value as Id<T & never>) : undefined;
    };
    const payload = {
      userId: id<"users">("userId") as Id<"users"> | undefined,
      firstName: String(data.get("firstName") ?? ""),
      lastName: String(data.get("lastName") ?? ""),
      workEmail: String(data.get("workEmail") ?? ""),
      phone: optional("phone"),
      countryId: String(data.get("countryId")) as Id<"countries">,
      departmentId: id<"hrDepartments">("departmentId") as
        | Id<"hrDepartments">
        | undefined,
      jobTitle: String(data.get("jobTitle") ?? ""),
      workLocation: optional("workLocation"),
      employmentType: String(data.get("employmentType")) as
        | "permanent"
        | "temporary"
        | "contractor"
        | "intern",
      status: String(data.get("status")) as
        | "preboarding"
        | "active"
        | "on_leave"
        | "suspended"
        | "departed",
      startDate: String(data.get("startDate") ?? ""),
      probationEndDate: optional("probationEndDate"),
      endDate: optional("endDate"),
      departureType: optional("departureType") as
        | "resignation"
        | "termination"
        | "contract_end"
        | "retirement"
        | "other"
        | undefined,
      departureReason: optional("departureReason"),
      screeningStatus: String(data.get("screeningStatus")) as
        | "not_required"
        | "pending"
        | "completed",
      ndaAcknowledged: data.get("ndaAcknowledged") === "on",
      securityTrainingCompleted: data.get("securityTrainingCompleted") === "on",
      primaryManagerId: id<"employeeProfiles">("primaryManagerId") as
        | Id<"employeeProfiles">
        | undefined,
      secondaryManagerId: id<"employeeProfiles">("secondaryManagerId") as
        | Id<"employeeProfiles">
        | undefined,
      changeReason: optional("changeReason"),
    };
    try {
      const savedId = current
        ? (await updateEmployee({ employeeId: current._id, ...payload }),
          current._id)
        : await createEmployee(payload);
      toast.success(current ? "Employee updated" : "Employee created");
      navigate(`/people/employees/${savedId}`);
    } catch (error) {
      toast.error("Employee could not be saved", {
        description:
          error instanceof Error ? error.message : "Please review the form",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <Button asChild variant="ghost" className="-ml-3">
        <Link
          to={
            current ? `/people/employees/${current._id}` : "/people/employees"
          }
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {current
            ? `Edit ${current.firstName} ${current.lastName}`
            : "New employee"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          Employment, access, compliance, and reporting details.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Employment profile</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="First name">
              <Input
                name="firstName"
                defaultValue={current?.firstName}
                required
              />
            </Field>
            <Field label="Last name">
              <Input
                name="lastName"
                defaultValue={current?.lastName}
                required
              />
            </Field>
            <Field label="Work email">
              <Input
                name="workEmail"
                type="email"
                defaultValue={current?.workEmail}
                required
              />
            </Field>
            <Field label="Phone">
              <Input name="phone" defaultValue={current?.phone} />
            </Field>
            <Field label="Job title">
              <Input
                name="jobTitle"
                defaultValue={current?.jobTitle}
                required
              />
            </Field>
            <Field label="Work location">
              <Input name="workLocation" defaultValue={current?.workLocation} />
            </Field>
            <Field label="Country">
              <Select
                name="countryId"
                value={countryId}
                onChange={(event) => setCountryId(event.target.value)}
                required
              >
                {countries.map((row) => (
                  <option key={row._id} value={row._id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Department">
              <Select
                name="departmentId"
                defaultValue={current?.departmentId ?? "none"}
              >
                <option value="none">No department</option>
                {availableDepartments.map((row) => (
                  <option key={row._id} value={row._id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Employment type">
              <Select
                name="employmentType"
                defaultValue={current?.employmentType ?? "permanent"}
              >
                <option value="permanent">Permanent</option>
                <option value="temporary">Temporary</option>
                <option value="contractor">Contractor</option>
                <option value="intern">Intern</option>
              </Select>
            </Field>
            <Field label="Status">
              <Select
                name="status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="preboarding">Preboarding</option>
                <option value="active">Active</option>
                <option value="on_leave">On leave</option>
                <option value="suspended">Suspended</option>
                <option value="departed">Departed</option>
              </Select>
            </Field>
            <Field label="Start date">
              <Input
                name="startDate"
                type="date"
                defaultValue={current?.startDate}
                required
              />
            </Field>
            <Field label="Probation end">
              <Input
                name="probationEndDate"
                type="date"
                defaultValue={current?.probationEndDate}
              />
            </Field>
            <Field label="End date">
              <Input
                name="endDate"
                type="date"
                defaultValue={current?.endDate}
                required={status === "departed"}
              />
            </Field>
            {status === "departed" ? (
              <>
                <Field label="Departure type">
                  <Select
                    name="departureType"
                    defaultValue={current?.departureType ?? "resignation"}
                    required
                  >
                    <option value="resignation">Resignation</option>
                    <option value="termination">Termination</option>
                    <option value="contract_end">Contract end</option>
                    <option value="retirement">Retirement</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Departure reason">
                  <Input
                    name="departureReason"
                    defaultValue={current?.departureReason}
                    required
                  />
                </Field>
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Access and reporting</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Field label="Linked system login">
              <Select name="userId" defaultValue={current?.userId ?? "none"}>
                <option value="none">No login</option>
                {users.map((user) => (
                  <option
                    key={user.id}
                    value={user.id}
                    disabled={user.linked && user.id !== current?.userId}
                  >
                    {user.name ?? user.email ?? "Unnamed user"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Primary manager">
              <Select
                name="primaryManagerId"
                value={primaryManagerId}
                onChange={(event) => setPrimaryManagerId(event.target.value)}
              >
                <option value="none">No manager</option>
                {availableManagers.map((row) => (
                  <option
                    key={row._id}
                    value={row._id}
                    disabled={row._id === secondaryManagerId}
                  >
                    {row.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Secondary manager">
              <Select
                name="secondaryManagerId"
                value={secondaryManagerId}
                onChange={(event) => setSecondaryManagerId(event.target.value)}
              >
                <option value="none">No second manager</option>
                {availableManagers.map((row) => (
                  <option
                    key={row._id}
                    value={row._id}
                    disabled={row._id === primaryManagerId}
                  >
                    {row.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Security and compliance</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Field label="Screening">
              <Select
                name="screeningStatus"
                defaultValue={current?.screeningStatus ?? "pending"}
              >
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="not_required">Not required</option>
              </Select>
            </Field>
            <Check
              name="ndaAcknowledged"
              label="NDA acknowledged"
              checked={Boolean(current?.ndaAcknowledgedAt)}
            />
            <Check
              name="securityTrainingCompleted"
              label="Security training completed"
              checked={Boolean(current?.securityTrainingCompletedAt)}
            />
          </CardContent>
        </Card>
        {current ? (
          <Card>
            <CardContent className="pt-6">
              <Field label="Reason for sensitive changes">
                <Input
                  name="changeReason"
                  placeholder="Required for status, login, or compliance corrections"
                />
              </Field>
            </CardContent>
          </Card>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button asChild variant="outline">
            <Link
              to={
                current
                  ? `/people/employees/${current._id}`
                  : "/people/employees"
              }
            >
              Cancel
            </Link>
          </Button>
          <Button disabled={pending}>
            {pending ? "Saving..." : "Save employee"}
          </Button>
        </div>
      </form>
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
function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    />
  );
}
function Check({
  name,
  label,
  checked,
}: {
  name: string;
  label: string;
  checked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 self-end rounded-lg border p-3 text-sm">
      <Checkbox name={name} defaultChecked={checked} />
      <ShieldCheck className="h-4 w-4 text-cyan-600" />
      {label}
    </label>
  );
}
