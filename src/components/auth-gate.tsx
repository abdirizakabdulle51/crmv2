import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { SignInForm } from "@/components/ui/signin.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { CrmProvider } from "@/lib/crm-context.tsx";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo.tsx";
import { InactivityLogout } from "@/components/inactivity-logout.tsx";
import { Check, ShieldCheck } from "lucide-react";

function LoginPage() {
  return (
    <div className="min-h-screen overflow-y-auto bg-background p-3 sm:p-5 lg:p-7">
      <main className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-7xl overflow-hidden rounded-2xl border bg-card shadow-xl shadow-foreground/5 sm:min-h-[calc(100vh-2.5rem)] lg:min-h-[calc(100vh-3.5rem)] lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative hidden overflow-hidden border-r border-sidebar-border bg-gradient-to-br from-sidebar via-sidebar-accent to-primary/25 p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,var(--sidebar-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--sidebar-border)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom_right,transparent,black,transparent)]" />
          <div className="relative z-10">
            <BrandLogo iconClassName="h-12 w-auto max-w-[230px]" />
            <div className="mt-24 max-w-xl">
              <h1 className="text-5xl font-bold leading-[1.08] tracking-tight text-sidebar-foreground">
                Operate your cloud business from one place.
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-8 text-sidebar-foreground/70">
                A unified workspace for customers, contracts, billing,
                collections, and operational visibility.
              </p>
              <div className="mt-10 space-y-4">
                {[
                  "Manage customers, opportunities, and contracts",
                  "Automate usage-based billing and collections",
                  "See financial and operational performance clearly",
                ].map((feature) => (
                  <div key={feature} className="flex items-center gap-3 text-sm font-medium text-sidebar-foreground">
                    <span className="grid size-6 place-items-center rounded-full border border-primary/60 bg-primary/20 text-sidebar-foreground">
                      <Check className="size-3.5" />
                    </span>
                    {feature}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="relative z-10 flex items-center gap-2 text-xs text-sidebar-foreground/65">
            <ShieldCheck className="size-4 text-primary" />
            Secure access for authorized HTGCLOUDS team members
          </div>
        </section>

        <section className="flex items-center justify-center bg-card px-6 py-10 sm:px-12">
          <div className="w-full max-w-sm">
            <BrandLogo className="mb-14 lg:hidden" iconClassName="h-11 w-auto max-w-[210px]" />
            <h2 className="text-3xl font-bold tracking-tight">Welcome back</h2>
            <p className="mb-8 mt-2 text-sm text-muted-foreground">
              Sign in to continue to HTGCLOUDS CRM.
            </p>
            <SignInForm />
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Having trouble signing in? Contact your administrator.
            </p>
          </div>
        </section>
      </main>
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
          <Button
            className="w-full"
            type="button"
            onClick={() => void signOut()}
          >
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  async function handlePasswordChange(event: React.FormEvent<HTMLFormElement>) {
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
          <Button
            className="w-full"
            type="submit"
            disabled={isChangingPassword}
          >
            Update Password
          </Button>
        </form>
      </div>
    );
  }

  return (
    <CrmProvider>
      <InactivityLogout />
      {children}
    </CrmProvider>
  );
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
