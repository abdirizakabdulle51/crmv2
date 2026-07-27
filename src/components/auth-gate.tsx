import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { SignInForm } from "@/components/ui/signin.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { CrmProvider } from "@/lib/crm-context.tsx";
import { Building2 } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { toast } from "sonner";

function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-6 max-w-md px-6">
        <div className="flex items-center justify-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center">
            <Building2 className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">HTGCLOUDS</h1>
        </div>
        <p className="text-muted-foreground">
          Sign in to access the CRM platform
        </p>
        <SignInForm />
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="space-y-4 w-64">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

function AuthenticatedCrm({ children }: { children: React.ReactNode }) {
  const { signOut } = useAuthActions();
  const syncCurrentUser = useMutation(api.auth.syncCurrentUser);
  const changeTemporaryPassword = useAction(api.auth.changeTemporaryPassword);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    let isMounted = true;

    void syncCurrentUser()
      .then((result) => {
        if (isMounted) {
          setMustChangePassword(result.mustChangePassword);
          setIsDisabled(result.isDisabled);
          setStatus("ready");
        }
      })
      .catch((error) => {
        console.error("Failed to sync current user", error);
        if (isMounted) {
          setStatus("error");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [syncCurrentUser]);

  if (status === "loading") {
    return <LoadingSkeleton />;
  }

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-2">
          <p className="font-medium text-destructive">Unable to load account</p>
          <p className="text-sm text-muted-foreground">
            Sign out and try again, or check the Convex auth configuration.
          </p>
        </div>
      </div>
    );
  }

  if (isDisabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Account disabled
            </h1>
            <p className="text-sm text-muted-foreground">
              Your account has been disabled, contact your administrator.
            </p>
          </div>
          <Button className="w-full" type="button" onClick={() => void signOut()}>
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  async function handlePasswordChange(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setIsChangingPassword(true);

    try {
      const formData = new FormData(event.currentTarget);
      const newPassword = String(formData.get("newPassword") ?? "");
      const confirmPassword = String(formData.get("confirmPassword") ?? "");

      if (newPassword !== confirmPassword) {
        toast.error("Passwords do not match");
        return;
      }

      await changeTemporaryPassword({ newPassword });
      setMustChangePassword(false);
      toast.success("Password updated");
    } catch (error) {
      toast.error("Failed to update password", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setIsChangingPassword(false);
    }
  }

  if (mustChangePassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <form
          className="w-full max-w-sm space-y-4"
          onSubmit={handlePasswordChange}
        >
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Set a new password
            </h1>
            <p className="text-sm text-muted-foreground">
              Your temporary password must be changed before continuing.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <Button className="w-full" type="submit" disabled={isChangingPassword}>
            Update Password
          </Button>
        </form>
      </div>
    );
  }

  return <CrmProvider>{children}</CrmProvider>;
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <LoadingSkeleton />
      </AuthLoading>
      <Unauthenticated>
        <LoginPage />
      </Unauthenticated>
      <Authenticated>
        <AuthenticatedCrm>{children}</AuthenticatedCrm>
      </Authenticated>
    </>
  );
}
