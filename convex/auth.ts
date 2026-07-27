import { Password } from "@convex-dev/auth/providers/Password";
import {
  convexAuth,
  createAccount,
  getAuthUserId,
  modifyAccountCredentials,
} from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";

const roleValidator = v.union(
  v.literal("account_manager"),
  v.literal("country_gm"),
  v.literal("head_of_business"),
  v.literal("ceo"),
);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function generateTemporaryPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = params.email;
        if (typeof email !== "string") {
          throw new Error("Email is required");
        }
        const name =
          typeof params.name === "string" ? params.name.trim() : undefined;

        if (params.flow === "signUp") {
          throw new Error("Self sign-up is disabled");
        }

        return {
          email: normalizeEmail(email),
          ...(name ? { name } : {}),
        };
      },
    }),
  ],
  jwt: {
    customClaims: async (ctx, { userId }) => {
      const user = await ctx.db.get(userId);
      return {
        email: user?.email,
        name: user?.name,
      };
    },
  },
});

export const requireAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (
      !currentUser ||
      (currentUser.role !== "ceo" && currentUser.role !== "head_of_business")
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can create team members",
      });
    }

    return currentUser._id;
  },
});

export const canBootstrap = query({
  args: {},
  handler: async (ctx) => {
    const existingUser = await ctx.db.query("users").first();
    return existingUser === null;
  },
});

export const finishPasswordChange = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }
    await ctx.db.patch(args.userId, { mustChangePassword: false });
  },
});

export const requirePasswordChange = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }
    await ctx.db.patch(args.userId, { mustChangePassword: true });
  },
});

export const createTeamMember = action({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.optional(v.string()),
    role: roleValidator,
    countryId: v.optional(v.id("countries")),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.auth.requireAdmin, {});

    const email = normalizeEmail(args.email);
    const password = args.password?.trim() || generateTemporaryPassword();

    if (password.length < 8) {
      throw new ConvexError({
        code: "INVALID_PASSWORD",
        message: "Temporary password must be at least 8 characters",
      });
    }

    const profile = {
      name: args.name.trim(),
      email,
      role: args.role,
      mustChangePassword: true,
      ...(args.countryId ? { countryId: args.countryId } : {}),
    };

    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: email, secret: password },
      profile,
      shouldLinkViaEmail: false,
      shouldLinkViaPhone: false,
    });

    return {
      userId: user._id,
      temporaryPassword: password,
    };
  },
});

export const resetTeamMemberPassword = action({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.auth.requireAdmin, {});

    const user = await ctx.runQuery(internal.users.getById, {
      userId: args.userId,
    });
    if (!user?.email) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User email not found",
      });
    }

    const password = generateTemporaryPassword();
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: normalizeEmail(user.email), secret: password },
    });

    await ctx.runMutation(internal.auth.requirePasswordChange, {
      userId: args.userId,
    });

    return { temporaryPassword: password };
  },
});

export const bootstrapFirstUser = action({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const canBootstrap = await ctx.runQuery(api.auth.canBootstrap, {});
    if (!canBootstrap) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Self sign-up is disabled",
      });
    }

    const email = normalizeEmail(args.email);
    const name = args.name.trim();
    const password = args.password.trim();
    if (!name) {
      throw new ConvexError({
        code: "INVALID_NAME",
        message: "Full name is required",
      });
    }
    if (password.length < 8) {
      throw new ConvexError({
        code: "INVALID_PASSWORD",
        message: "Password must be at least 8 characters",
      });
    }

    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: email, secret: password },
      profile: {
        name,
        email,
        role: "ceo",
        mustChangePassword: false,
      },
      shouldLinkViaEmail: false,
      shouldLinkViaPhone: false,
    });

    return user._id;
  },
});

export const changeTemporaryPassword = action({
  args: { newPassword: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const user = await ctx.runQuery(internal.users.getById, { userId });
    if (!user?.email || !user.mustChangePassword) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Password change is not required for this account",
      });
    }

    const newPassword = args.newPassword.trim();
    if (newPassword.length < 8) {
      throw new ConvexError({
        code: "INVALID_PASSWORD",
        message: "New password must be at least 8 characters",
      });
    }

    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: normalizeEmail(user.email), secret: newPassword },
    });

    await ctx.runMutation(internal.auth.finishPasswordChange, { userId });
  },
});

export const disableTeamMember = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (
      !currentUser ||
      (currentUser.role !== "ceo" && currentUser.role !== "head_of_business")
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can disable team members",
      });
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    if (user.role === "ceo" && user.isDisabled !== true) {
      const ceos = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "ceo"))
        .collect();
      const activeCeoCount = ceos.filter(
        (ceo) => ceo.isDisabled !== true,
      ).length;

      if (activeCeoCount <= 1) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "Cannot disable the only active CEO account",
        });
      }
    }

    await ctx.db.patch(args.userId, { isDisabled: true });
  },
});

export const reenableTeamMember = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (
      !currentUser ||
      (currentUser.role !== "ceo" && currentUser.role !== "head_of_business")
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can re-enable team members",
      });
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    await ctx.db.patch(args.userId, { isDisabled: false });
  },
});

export const deleteTeamMember = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (
      !currentUser ||
      (currentUser.role !== "ceo" && currentUser.role !== "head_of_business")
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can delete team members",
      });
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    const [companies, leads, targets] = await Promise.all([
      ctx.db
        .query("companies")
        .withIndex("by_account_manager", (q) =>
          q.eq("accountManagerId", args.userId),
        )
        .collect(),
      ctx.db
        .query("leads")
        .withIndex("by_account_manager", (q) =>
          q.eq("accountManagerId", args.userId),
        )
        .collect(),
      ctx.db
        .query("salesTargets")
        .withIndex("by_am_year_quarter", (q) =>
          q.eq("accountManagerId", args.userId),
        )
        .collect(),
    ]);

    if (companies.length > 0 || leads.length > 0 || targets.length > 0) {
      throw new ConvexError({
        code: "HAS_ASSIGNMENTS",
        message: `Cannot delete: assigned to ${companies.length} companies, ${leads.length} leads, ${targets.length} targets - reassign or disable instead`,
      });
    }

    if (user.role === "ceo" && user.isDisabled !== true) {
      const ceos = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "ceo"))
        .collect();
      const activeCeoCount = ceos.filter(
        (ceo) => ceo.isDisabled !== true,
      ).length;

      if (activeCeoCount <= 1) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "Cannot delete the only active CEO account",
        });
      }
    }

    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.userId))
      .collect();
    for (const account of accounts) {
      const verificationCodes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .collect();
      for (const verificationCode of verificationCodes) {
        await ctx.db.delete(verificationCode._id);
      }
      await ctx.db.delete(account._id);
    }

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const session of sessions) {
      const refreshTokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .collect();
      for (const refreshToken of refreshTokens) {
        await ctx.db.delete(refreshToken._id);
      }
      await ctx.db.delete(session._id);
    }

    await ctx.db.delete(args.userId);
  },
});

export const syncCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const authUserId = await getAuthUserId(ctx);

    if (!identity || !authUserId) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const user = await ctx.db.get(authUserId);
    if (!user) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Authenticated user not found",
      });
    }

    const existingCeo = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "ceo"))
      .first();

    await ctx.db.patch(authUserId, {
      tokenIdentifier: identity.tokenIdentifier,
      name: user.name ?? identity.name,
      email: identity.email ?? user.email,
      role: user.role ?? (existingCeo ? undefined : "ceo"),
    });

    return {
      userId: authUserId,
      mustChangePassword: user.mustChangePassword === true,
      isDisabled: user.isDisabled === true,
    };
  },
});
