import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { betterAuth } from "better-auth/minimal";
import { ConvexError } from "convex/values";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL ?? "http://localhost:5173";

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV !== "development",
    },
    plugins: [
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    try {
      return await authComponent.getAuthUser(ctx);
    } catch (e) {
      if (e instanceof ConvexError && e.data === "Unauthenticated") {
        return null;
      }
      throw e;
    }
  },
});

export const ensureCurrentUserProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const existing = await ctx.db
      .query("appUsers")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    const now = Date.now();

    if (existing) {
      const updates: Record<string, string | number> = {};
      if (identity.email && identity.email !== existing.email) {
        updates.email = identity.email;
      }
      if (identity.name && identity.name !== existing.name) {
        updates.name = identity.name;
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = now;
        await ctx.db.patch(existing._id, updates);
      }
      return existing._id;
    }

    // First user becomes admin, subsequent users become eventManager
    const firstUser = await ctx.db.query("appUsers").take(1);
    const role = firstUser.length === 0 ? "admin" : "eventManager";

    return await ctx.db.insert("appUsers", {
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email ?? "",
      name: identity.name ?? "",
      role,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getMyAccess = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const appUser = await ctx.db
      .query("appUsers")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    const eventPermissions = await ctx.db
      .query("eventPermissions")
      .withIndex("by_userTokenIdentifier", (q) =>
        q.eq("userTokenIdentifier", identity.tokenIdentifier),
      )
      .collect();

    if (!appUser) {
      // No profile yet — first user would be admin
      const firstUser = await ctx.db.query("appUsers").take(1);
      return {
        isAdmin: firstUser.length === 0,
        eventPermissions,
      };
    }

    return {
      isAdmin: appUser.role === "admin",
      eventPermissions,
    };
  },
});
