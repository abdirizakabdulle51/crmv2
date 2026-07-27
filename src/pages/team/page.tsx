import { useAction, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { useCrm, getRoleLabel, type UserRole } from "@/lib/crm-context.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import ConfirmDeleteDialog from "@/components/confirm-delete-dialog.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { toast } from "sonner";
import { Copy, KeyRound, Plus, ShieldCheck, Trash2, UserCheck, UserX } from "lucide-react";
import { useState } from "react";

const ROLES: UserRole[] = [
  "account_manager",
  "country_gm",
  "head_of_business",
  "ceo",
];

function generateTemporaryPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export default function TeamPage() {
  const { currentUser, isAdmin } = useCrm();
  const users = useQuery(api.users.listAll, {});
  const countries = useQuery(api.countries.list, {});
  const updateRole = useMutation(api.users.updateRole);
  const assignCountry = useMutation(api.users.assignCountry);
  const createTeamMember = useAction(api.auth.createTeamMember);
  const resetTeamMemberPassword = useAction(api.auth.resetTeamMemberPassword);
  const disableTeamMember = useMutation(api.auth.disableTeamMember);
  const reenableTeamMember = useMutation(api.auth.reenableTeamMember);
  const deleteTeamMember = useMutation(api.auth.deleteTeamMember);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [resettingUserId, setResettingUserId] = useState<Id<"users"> | null>(
    null,
  );
  const [resetPassword, setResetPassword] = useState<{
    userId: Id<"users">;
    password: string;
  } | null>(null);
  const [deleteUserId, setDeleteUserId] = useState<Id<"users"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState<Id<"users"> | null>(null);
  const [tempPassword, setTempPassword] = useState(generateTemporaryPassword);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  if (!users || !countries) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  const handleRoleChange = async (userId: Id<"users">, role: UserRole) => {
    try {
      await updateRole({ userId, role });
      toast.success("Role updated");
    } catch (error) {
      toast.error("Failed to update role");
    }
  };

  const handleCountryChange = async (
    userId: Id<"users">,
    countryId: Id<"countries">,
  ) => {
    try {
      await assignCountry({ userId, countryId });
      toast.success("Country assigned");
    } catch (error) {
      toast.error("Failed to assign country");
    }
  };

  const handleDisabledChange = async (
    userId: Id<"users">,
    shouldDisable: boolean,
  ) => {
    setTogglingUserId(userId);
    try {
      if (shouldDisable) {
        await disableTeamMember({ userId });
        toast.success("Team member disabled");
      } else {
        await reenableTeamMember({ userId });
        toast.success("Team member re-enabled");
      }
    } catch (error) {
      toast.error(
        shouldDisable
          ? "Failed to disable team member"
          : "Failed to re-enable team member",
        {
          description:
            error instanceof Error ? error.message : "Please try again",
        },
      );
    } finally {
      setTogglingUserId(null);
    }
  };

  const handleResetPassword = async (userId: Id<"users">) => {
    setResettingUserId(userId);
    setResetPassword(null);
    try {
      const result = await resetTeamMemberPassword({ userId });
      setResetPassword({ userId, password: result.temporaryPassword });
      toast.success("Temporary password generated");
    } catch (error) {
      toast.error("Failed to reset password", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setResettingUserId(null);
    }
  };

  const handleDeleteTeamMember = async () => {
    if (!deleteUserId) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteTeamMember({ userId: deleteUserId });
      setDeleteUserId(null);
      setResetPassword((current) =>
        current?.userId === deleteUserId ? null : current,
      );
      toast.success("Team member deleted");
    } catch (error) {
      toast.error("Failed to delete team member", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCreateTeamMember = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    setIsCreating(true);
    setCreatedPassword(null);

    try {
      const formData = new FormData(form);
      const name = String(formData.get("name") ?? "").trim();
      const email = String(formData.get("email") ?? "").trim();
      const password = String(formData.get("password") ?? "").trim();
      const role = String(formData.get("role")) as UserRole;
      const countryIdValue = String(formData.get("countryId") ?? "none");

      const result = await createTeamMember({
        name,
        email,
        password,
        role,
        countryId:
          countryIdValue === "none"
            ? undefined
            : (countryIdValue as Id<"countries">),
      });

      setCreatedPassword(result.temporaryPassword);
      toast.success("Team member created");
      form.reset();
      setTempPassword(generateTemporaryPassword());
    } catch (error) {
      toast.error("Failed to create team member", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const copyCreatedPassword = async () => {
    if (!createdPassword) {
      return;
    }
    await navigator.clipboard.writeText(createdPassword);
    toast.success("Temporary password copied");
  };

  const copyResetPassword = async () => {
    if (!resetPassword) {
      return;
    }
    await navigator.clipboard.writeText(resetPassword.password);
    toast.success("Temporary password copied");
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground mt-1">
            Manage team members, roles, and country assignments
          </p>
        </div>

        {isAdmin && (
          <Dialog
            open={isCreateOpen}
            onOpenChange={(open) => {
              setIsCreateOpen(open);
              if (!open) {
                setCreatedPassword(null);
                setTempPassword(generateTemporaryPassword());
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" />
                Create Team Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Team Member</DialogTitle>
                <DialogDescription>
                  Create an account with a temporary password.
                </DialogDescription>
              </DialogHeader>

              <form className="space-y-4" onSubmit={handleCreateTeamMember}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" name="name" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" name="email" type="email" required />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Temporary password</Label>
                  <div className="flex gap-2">
                    <Input
                      id="password"
                      name="password"
                      value={tempPassword}
                      onChange={(event) => setTempPassword(event.target.value)}
                      minLength={8}
                      required
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setTempPassword(generateTemporaryPassword())}
                      title="Generate password"
                    >
                      <KeyRound className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select name="role" defaultValue="account_manager">
                      <SelectTrigger>
                        <SelectValue placeholder="Assign role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {getRoleLabel(role)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Country</Label>
                    <Select name="countryId" defaultValue="none">
                      <SelectTrigger>
                        <SelectValue placeholder="Assign country" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {countries.map((country) => (
                          <SelectItem key={country._id} value={country._id}>
                            {country.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {createdPassword && (
                  <div className="rounded-md border bg-muted/40 p-3">
                    <div className="text-sm font-medium">
                      Temporary password
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="flex-1 rounded bg-background px-2 py-1 text-sm">
                        {createdPassword}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={copyCreatedPassword}
                        title="Copy password"
                      >
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}

                <DialogFooter>
                  <Button type="submit" disabled={isCreating}>
                    Create Account
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {!isAdmin && (
        <div className="rounded-lg border border-border bg-muted/50 p-4 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Only CEO and Head of Business can modify roles and assignments
          </p>
        </div>
      )}

      <div className="space-y-3">
        {users.map((user) => (
          <Card key={user._id}>
            <CardContent className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-4 py-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate">
                    {user.name || "Unnamed User"}
                  </div>
                  {user.isDisabled === true && (
                    <Badge variant="destructive">Disabled</Badge>
                  )}
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {user.email || "No email"}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                {isAdmin ? (
                  <>
                    <Select
                      value={user.role || "none"}
                      onValueChange={(val) => {
                        if (val !== "none") {
                          handleRoleChange(user._id, val as UserRole);
                        }
                      }}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Assign role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {getRoleLabel(role)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={user.countryId || "none"}
                      onValueChange={(val) => {
                        if (val !== "none") {
                          handleCountryChange(
                            user._id,
                            val as Id<"countries">,
                          );
                        }
                      }}
                    >
                      <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Assign country" />
                      </SelectTrigger>
                      <SelectContent>
                        {countries.map((c) => (
                          <SelectItem key={c._id} value={c._id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleResetPassword(user._id)}
                      disabled={resettingUserId === user._id}
                    >
                      <KeyRound className="size-4" />
                      Reset Password
                    </Button>

                    {user.isDisabled === true ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleDisabledChange(user._id, false)}
                        disabled={togglingUserId === user._id}
                      >
                        <UserCheck className="size-4" />
                        Re-enable
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => handleDisabledChange(user._id, true)}
                        disabled={togglingUserId === user._id}
                      >
                        <UserX className="size-4" />
                        Disable
                      </Button>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setDeleteUserId(user._id)}
                      disabled={isDeleting}
                      title="Delete team member"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Badge variant="secondary">
                      {getRoleLabel(user.role)}
                    </Badge>
                    {user.countryId && (
                      <Badge variant="secondary">
                        {countries.find((c) => c._id === user.countryId)?.name ||
                          "Unknown"}
                      </Badge>
                    )}
                  </>
                )}
              </div>
              {resetPassword?.userId === user._id && (
                <div className="w-full rounded-md border bg-muted/40 p-3 sm:basis-full">
                  <div className="text-sm font-medium">
                    New temporary password
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 rounded bg-background px-2 py-1 text-sm">
                      {resetPassword.password}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={copyResetPassword}
                      title="Copy password"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <ConfirmDeleteDialog
        open={deleteUserId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteUserId(null);
          }
        }}
        onConfirm={handleDeleteTeamMember}
        title="Delete this team member?"
        description="This permanently removes the team member account. Users assigned to companies, leads, or targets cannot be deleted."
        loading={isDeleting}
      />
    </div>
  );
}
