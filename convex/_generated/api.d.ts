/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminGateway from "../adminGateway.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as cardTemplates from "../cardTemplates.js";
import type * as categories from "../categories.js";
import type * as deviceSessions from "../deviceSessions.js";
import type * as eventPermissions from "../eventPermissions.js";
import type * as events from "../events.js";
import type * as foodRules from "../foodRules.js";
import type * as foodScans from "../foodScans.js";
import type * as guests from "../guests.js";
import type * as http from "../http.js";
import type * as internalGateway from "../internalGateway.js";
import type * as lib_hmac from "../lib/hmac.js";
import type * as model_categories from "../model/categories.js";
import type * as model_events from "../model/events.js";
import type * as model_guests from "../model/guests.js";
import type * as model_phone from "../model/phone.js";
import type * as model_vendors from "../model/vendors.js";
import type * as qr from "../qr.js";
import type * as seed from "../seed.js";
import type * as smsDeliveries from "../smsDeliveries.js";
import type * as stalls from "../stalls.js";
import type * as sync from "../sync.js";
import type * as vendorCategories from "../vendorCategories.js";
import type * as vendorTypes from "../vendorTypes.js";
import type * as vendors from "../vendors.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminGateway: typeof adminGateway;
  auth: typeof auth;
  authz: typeof authz;
  cardTemplates: typeof cardTemplates;
  categories: typeof categories;
  deviceSessions: typeof deviceSessions;
  eventPermissions: typeof eventPermissions;
  events: typeof events;
  foodRules: typeof foodRules;
  foodScans: typeof foodScans;
  guests: typeof guests;
  http: typeof http;
  internalGateway: typeof internalGateway;
  "lib/hmac": typeof lib_hmac;
  "model/categories": typeof model_categories;
  "model/events": typeof model_events;
  "model/guests": typeof model_guests;
  "model/phone": typeof model_phone;
  "model/vendors": typeof model_vendors;
  qr: typeof qr;
  seed: typeof seed;
  smsDeliveries: typeof smsDeliveries;
  stalls: typeof stalls;
  sync: typeof sync;
  vendorCategories: typeof vendorCategories;
  vendorTypes: typeof vendorTypes;
  vendors: typeof vendors;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
