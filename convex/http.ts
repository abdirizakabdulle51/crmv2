import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/manageone/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expectedSecret = process.env.MANAGEONE_SYNC_SECRET;
    const providedSecret = request.headers.get("X-Sync-Secret");

    if (!expectedSecret || providedSecret !== expectedSecret) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    try {
      const tenants = await request.json();
      if (!Array.isArray(tenants)) {
        return Response.json(
          { success: false, error: "Request body must be an array" },
          { status: 400 },
        );
      }

      const count = await ctx.runMutation(
        internal.manageOneTenants.bulkUpsert,
        {
          tenants,
        },
      );

      return Response.json({ success: true, count });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        },
        { status: 400 },
      );
    }
  }),
});

export default http;
