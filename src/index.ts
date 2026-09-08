import { Hono } from "hono";
import { securityHeaders, noStore } from "./middleware/security";
import { loadUser } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { homeRoutes } from "./routes/home";
import { memberRoutes } from "./routes/members";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", securityHeaders);
app.use("*", loadUser);
app.use("/login", noStore);
app.use("/register", noStore);
app.use("/profile/*", noStore);

app.route("/", homeRoutes);
app.route("/", authRoutes);
app.route("/", memberRoutes);

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  console.error(error);
  return c.text("服务暂时不可用，请稍后重试。", 500);
});

export default app;
