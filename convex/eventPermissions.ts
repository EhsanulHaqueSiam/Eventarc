import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
  canEditEvent,
  canReadEvent,
  ensureAdminAccess,
  requireAuthenticated,
  resolveUserRole,
} from "./authz";

export const listForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticated(ctx);
    const role = await resolveUserRole(ctx, identity.tokenIdentifier);

    if (role !== "admin") {
      const allowed = await canReadEvent(ctx, args.eventId, identity.tokenIdentifier);
      if (!allowed) {
        throw new Error("You do not have access to this event");
      }
    }

    const permissions = await ctx.db
      .query("eventPermissions")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    const users = await Promise.all(
      permissions.map(async (permission) => {
        const appUser = await ctx.db
          .query("appUsers")
          .withIndex("by_tokenIdentifier", (q) =>
            q.eq("tokenIdentifier", permission.userTokenIdentifier),
          )
          .unique();
        return {
          _id: permission._id,
          eventId: permission.eventId,
          userTokenIdentifier: permission.userTokenIdentifier,
          canEdit: permission.canEdit,
          createdAt: permission.createdAt,
          updatedAt: permission.updatedAt,
          email: appUser?.email ?? "",
          name: appUser?.name ?? "",
          role: appUser?.role ?? "eventManager",
        };
      }),
    );

    return users;
  },
});

export const grantByEmail = mutation({
  args: {
    eventId: v.id("events"),
    email: v.string(),
    canEdit: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ensureAdminAccess(ctx);
    const email = args.email.trim().toLowerCase();
    if (!email) {
      throw new Error("Email is required");
    }

    const appUser = await ctx.db
      .query("appUsers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!appUser) {
      throw new Error("User not found. Ask the user to log in once first.");
    }

    if (appUser.role !== "admin") {
      await ctx.db.patch(appUser._id, {
        role: "eventManager",
        updatedAt: Date.now(),
      });
    }

    const existing = await ctx.db
      .query("eventPermissions")
      .withIndex("by_event_and_user", (q) =>
        q.eq("eventId", args.eventId).eq("userTokenIdentifier", appUser.tokenIdentifier),
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        canEdit: args.canEdit,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("eventPermissions", {
      eventId: args.eventId,
      userTokenIdentifier: appUser.tokenIdentifier,
      canEdit: args.canEdit,
      createdByTokenIdentifier: identity.tokenIdentifier,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const revoke = mutation({
  args: {
    permissionId: v.id("eventPermissions"),
  },
  handler: async (ctx, args) => {
    await ensureAdminAccess(ctx);
    const existing = await ctx.db.get(args.permissionId);
    if (!existing) {
      throw new Error("Permission not found");
    }
    await ctx.db.delete(args.permissionId);
    return args.permissionId;
  },
});

export const myEventAccess = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticated(ctx);
    const role = await resolveUserRole(ctx, identity.tokenIdentifier);
    if (role === "admin") {
      return { canView: true, canEdit: true, role };
    }
    const canView = await canReadEvent(ctx, args.eventId, identity.tokenIdentifier);
    const canEdit = await canEditEvent(ctx, args.eventId, identity.tokenIdentifier);
    return { canView, canEdit, role };
  },
});

// --- Internal helpers for createManagerAccount action ---

export const _checkAdminRole = internalQuery({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    const appUser = await ctx.db
      .query("appUsers")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
    return appUser?.role === "admin";
  },
});

export const _createManagerRecords = internalMutation({
  args: {
    eventId: v.id("events"),
    email: v.string(),
    name: v.string(),
    tokenIdentifier: v.string(),
    canEdit: v.boolean(),
    adminTokenIdentifier: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Create or update appUsers record
    const existing = await ctx.db
      .query("appUsers")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();

    if (existing) {
      if (existing.role !== "admin") {
        await ctx.db.patch(existing._id, { role: "eventManager", updatedAt: now });
      }
    } else {
      await ctx.db.insert("appUsers", {
        tokenIdentifier: args.tokenIdentifier,
        email: args.email,
        name: args.name,
        role: "eventManager",
        createdAt: now,
        updatedAt: now,
      });
    }

    // Create or update eventPermissions
    const existingPerm = await ctx.db
      .query("eventPermissions")
      .withIndex("by_event_and_user", (q) =>
        q.eq("eventId", args.eventId).eq("userTokenIdentifier", args.tokenIdentifier),
      )
      .unique();

    if (existingPerm) {
      await ctx.db.patch(existingPerm._id, { canEdit: args.canEdit, updatedAt: now });
    } else {
      await ctx.db.insert("eventPermissions", {
        eventId: args.eventId,
        userTokenIdentifier: args.tokenIdentifier,
        canEdit: args.canEdit,
        createdByTokenIdentifier: args.adminTokenIdentifier,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// --- Public action: create manager account + assign to event ---

export const createManagerAccount = action({
  args: {
    eventId: v.id("events"),
    email: v.string(),
    password: v.string(),
    name: v.optional(v.string()),
    canEdit: v.boolean(),
  },
  handler: async (ctx, args) => {
    // 1. Verify caller is admin
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const isAdmin = await ctx.runQuery(
      internal.eventPermissions._checkAdminRole,
      { tokenIdentifier: identity.tokenIdentifier },
    );
    if (!isAdmin) throw new Error("Admin access required");

    // 2. Create Better Auth account via signup endpoint
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) throw new Error("CONVEX_SITE_URL not configured");

    const email = args.email.trim().toLowerCase();
    const name = args.name || email.split("@")[0];

    const response = await fetch(`${siteUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: args.password, name }),
    });

    if (!response.ok) {
      // Account may already exist — fall back to existing grant flow
      try {
        await ctx.runMutation(api.eventPermissions.grantByEmail, {
          eventId: args.eventId,
          email,
          canEdit: args.canEdit,
        });
        return { created: false };
      } catch {
        throw new Error(
          "Failed to create account. If the email is already registered, the user must log in once first.",
        );
      }
    }

    // 3. Extract user ID and construct tokenIdentifier
    const data: { user: { id: string } } = await response.json();
    const tokenIdentifier = `${siteUrl}|${data.user.id}`;

    // 4. Create appUsers + eventPermissions records
    await ctx.runMutation(internal.eventPermissions._createManagerRecords, {
      eventId: args.eventId,
      email,
      name,
      tokenIdentifier,
      canEdit: args.canEdit,
      adminTokenIdentifier: identity.tokenIdentifier,
    });

    return { created: true };
  },
});
