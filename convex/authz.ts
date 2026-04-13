import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type AuthCtx = QueryCtx | MutationCtx;
export type AppRole = "admin" | "eventManager";

export async function requireAuthenticated(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
  return identity;
}

export async function resolveUserRole(
  ctx: AuthCtx,
  tokenIdentifier: string,
): Promise<AppRole> {
  const appUser = await ctx.db
    .query("appUsers")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .unique();
  if (appUser) {
    return appUser.role;
  }

  // Backwards compatibility: first authenticated user is implicitly admin.
  const firstUser = await ctx.db.query("appUsers").take(1);
  return firstUser.length === 0 ? "admin" : "eventManager";
}

export async function isAdminUser(
  ctx: AuthCtx,
  tokenIdentifier: string,
): Promise<boolean> {
  const role = await resolveUserRole(ctx, tokenIdentifier);
  return role === "admin";
}

export async function ensureAdminAccess(ctx: AuthCtx) {
  const identity = await requireAuthenticated(ctx);
  const isAdmin = await isAdminUser(ctx, identity.tokenIdentifier);
  if (!isAdmin) {
    throw new Error("Admin access required");
  }
  return identity;
}

export async function canReadEvent(
  ctx: AuthCtx,
  eventId: Id<"events">,
  tokenIdentifier: string,
) {
  if (await isAdminUser(ctx, tokenIdentifier)) {
    return true;
  }
  const permission = await ctx.db
    .query("eventPermissions")
    .withIndex("by_event_and_user", (q) =>
      q.eq("eventId", eventId).eq("userTokenIdentifier", tokenIdentifier),
    )
    .unique();
  return Boolean(permission);
}

export async function canEditEvent(
  ctx: AuthCtx,
  eventId: Id<"events">,
  tokenIdentifier: string,
) {
  if (await isAdminUser(ctx, tokenIdentifier)) {
    return true;
  }
  const permission = await ctx.db
    .query("eventPermissions")
    .withIndex("by_event_and_user", (q) =>
      q.eq("eventId", eventId).eq("userTokenIdentifier", tokenIdentifier),
    )
    .unique();
  return Boolean(permission?.canEdit);
}

export async function ensureEventReadAccess(ctx: AuthCtx, eventId: Id<"events">) {
  const identity = await requireAuthenticated(ctx);
  const allowed = await canReadEvent(ctx, eventId, identity.tokenIdentifier);
  if (!allowed) {
    throw new Error("You do not have access to this event");
  }
  return identity;
}

export async function ensureEventEditAccess(ctx: AuthCtx, eventId: Id<"events">) {
  const identity = await requireAuthenticated(ctx);
  const allowed = await canEditEvent(ctx, eventId, identity.tokenIdentifier);
  if (!allowed) {
    throw new Error("You do not have edit access to this event");
  }
  return identity;
}
