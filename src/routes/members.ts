import { Hono } from "hono";
import type { AppEnv } from "../types";
import { registerPublicMemberRoutes } from "./members/public";
import { registerProfileMemberRoutes } from "./members/profile";
import { registerAvatarsMemberRoutes } from "./members/avatars";
import { registerAdminMemberRoutes } from "./members/admin";
import { registerFlowersMemberRoutes } from "./members/flowers";
import { registerApplicationsMemberRoutes } from "./members/applications";

export const memberRoutes = new Hono<AppEnv>();

memberRoutes.use("*", async (c, next) => {
  if (
    !c.req.path.startsWith("/members") &&
    !c.req.path.startsWith("/profile/member") &&
    !c.req.path.startsWith("/admin/members")
  )
    return next();
  if (!c.get("user") && !/^\/members(?:\/\d+(?:\/(?:avatar|flowers))?)?$/.test(c.req.path))
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  await next();
});

registerPublicMemberRoutes(memberRoutes);
registerProfileMemberRoutes(memberRoutes);
registerAvatarsMemberRoutes(memberRoutes);
registerAdminMemberRoutes(memberRoutes);
registerFlowersMemberRoutes(memberRoutes);
registerApplicationsMemberRoutes(memberRoutes);
