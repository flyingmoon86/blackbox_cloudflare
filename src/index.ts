import { communityRoutes } from "./routes/community";
import { Hono } from "hono";
import { securityHeaders, noStore } from "./middleware/security";
import { loadUser } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { mascotImage, featuredCoverImage, health, heroImage, homePage, pageBackgroundImage } from "./routes/home";
import { memberRoutes } from "./routes/members";
import { adminRoutes } from "./routes/admin";
import { productionRoutes } from "./routes/productions";
import { contentRoutes } from "./routes/content";
import { resourceRoutes } from "./routes/resources";
import { helpRoutes } from "./routes/help";
import { uploadRoutes } from "./routes/uploads";
import { suggestionRoutes } from "./routes/suggestions";
import { operationsRoutes } from "./routes/operations";
import type { AppEnv } from "./types";
import { cleanExpiredUploads } from "./storage/cleanup";
import { requestContext, handleError } from "./middleware/errors";
import { cleanExpiredRequestLimits } from "./middleware/request-limits";

const app = new Hono<AppEnv>();

app.use("*", requestContext);
app.use("*", securityHeaders);
app.use("*", noStore);
app.use("*", loadUser);

app.get("/", homePage);
app.get("/site/hero", heroImage);
app.get("/site/mascot", mascotImage);
app.get("/site/background", pageBackgroundImage);
app.get("/site/featured-cover", featuredCoverImage);
app.get("/health", health);
app.route("/", authRoutes);
app.route("/", memberRoutes);
app.route("/", adminRoutes);
app.route("/", productionRoutes);
app.route("/", contentRoutes);
app.route("/", resourceRoutes);
app.route("/", helpRoutes);
app.route("/", uploadRoutes);
app.route("/", suggestionRoutes);
app.route("/", communityRoutes);
app.route("/", operationsRoutes);

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));
app.onError(handleError);

export default {
  fetch: app.fetch,
  scheduled(_controller, env, context) {
    context.waitUntil(cleanExpiredUploads(env));
    context.waitUntil(cleanExpiredRequestLimits(env));
  },
} satisfies ExportedHandler<AppEnv["Bindings"]>;
