import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import {
  syncFoodConsumption,
  syncGuestCard,
  syncGuestCheckIn,
} from "./internalGateway";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth, { cors: true });

http.route({
  path: "/internal/sync/guest-card",
  method: "POST",
  handler: syncGuestCard,
});

http.route({
  path: "/internal/sync/guest-checkin",
  method: "POST",
  handler: syncGuestCheckIn,
});

http.route({
  path: "/internal/sync/food-consumption",
  method: "POST",
  handler: syncFoodConsumption,
});

export default http;
