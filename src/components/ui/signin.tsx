import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

export function SignInForm() {
  const { signIn } = useAuthActions();
  const canBootstrap = useQuery(api.auth.canBootstrap, {});
  const bootstrapFirstUser = useAction(api.auth.bootstrapFirstUser);
  const [isBootstrapMode, setIsBootstrapMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const formData = new FormData(event.currentTarget);
      if (isBootstrapMode) {
        const name = String(formData.get("name") ?? "");
        const email = String(formData.get("email") ?? "");
        const password = String(formData.get("password") ?? "");
        await bootstrapFirstUser({ name, email, password });
      }
      formData.set("flow", "signIn");
      await signIn("password", formData);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Authentication failed";
      toast.error(isBootstrapMode ? "Bootstrap failed" : "Sign in failed", {
        description: message,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-4 text-left" onSubmit={handleSubmit}>
      {isBootstrapMode && (
        <div className="space-y-2">
          <Label htmlFor="name">Full Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
          />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={8}
          required
        />
      </div>
      <Button className="w-full" type="submit" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="size-4 animate-spin" />}
        {isBootstrapMode ? "Create Initial CEO Account" : "Sign In"}
      </Button>
      {canBootstrap && (
        <Button
          className="w-full"
          type="button"
          variant="ghost"
          onClick={() => setIsBootstrapMode((value) => !value)}
          disabled={isSubmitting}
        >
          {isBootstrapMode ? "Sign in instead" : "Create initial CEO account"}
        </Button>
      )}
    </form>
  );
}
