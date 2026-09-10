import { Hono } from "hono";
import { securityHeaders, noStore } from "./middleware/security";
import { loadUser } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { featuredCoverImage, health, heroImage, homePage, pageBackgroundImage } from "./routes/home";
import { memberRoutes } from "./routes/members";
import { adminRoutes } from "./routes/admin";
import { productionRoutes } from "./routes/productions";
import { contentRoutes } from "./routes/content";
import { resourceRoutes } from "./routes/resources";
import { helpRoutes } from "./routes/help";
import { uploadRoutes } from "./routes/uploads";
import { suggestionRoutes } from "./routes/suggestions";
import type { AppEnv } from "./types";
import { cleanExpiredUploads } from "./storage/cleanup";

const app = new Hono<AppEnv>();

app.use("*", securityHeaders);
app.use("*", loadUser);
app.use("/login", noStore);
app.use("/register", noStore);
app.use("/profile/*", noStore);

app.get("/", homePage);
app.get("/site/hero", heroImage);
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

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  console.error(error);
  return c.text("服务暂时不可用，请稍后重试。", 500);
});

export default {
  fetch: app.fetch,
  scheduled(_controller, env, context) {
    context.waitUntil(cleanExpiredUploads(env));
  },
} satisfies ExportedHandler<AppEnv["Bindings"]>;
