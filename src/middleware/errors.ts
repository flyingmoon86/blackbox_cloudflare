import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types";

const requests = new WeakMap<Context<AppEnv>, { id: string; started: number }>();
const codes: Record<number, string> = {
  400: "INVALID_REQUEST",
  401: "AUTH_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "INVALID_INPUT",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "UPSTREAM_UNAVAILABLE",
  503: "SERVICE_UNAVAILABLE",
};

function requestInfo(c: Context<AppEnv>) {
  let info = requests.get(c);
  if (!info) {
    info = { id: crypto.randomUUID(), started: Date.now() };
    requests.set(c, info);
  }
  return info;
}

export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const info = requestInfo(c);
  await next();
  c.header("X-Request-Id", info.id);
  // Preserve the existing error text field for upload.js while adding stable metadata.
  if (c.res.status >= 400 && c.res.headers.get("Content-Type")?.includes("application/json")) {
    const payload: unknown = await c.res
      .clone()
      .json()
      .catch(() => null);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      c.res = new Response(
        JSON.stringify({
          ...payload,
          code: (payload as { code?: string }).code || codes[c.res.status] || "REQUEST_FAILED",
          requestId: info.id,
        }),
        c.res,
      );
    }
  }
};

export const handleError: ErrorHandler<AppEnv> = (error, c) => {
  const info = requestInfo(c);
  const status = error instanceof HTTPException ? error.status : 500;
  const message =
    status < 500 && error instanceof HTTPException && error.message ? error.message : "服务暂时不可用，请稍后重试。";
  // Never log raw error messages/stacks, query strings, headers or request bodies.
  console.error(
    JSON.stringify({
      event: "request_error",
      requestId: info.id,
      method: c.req.method,
      route: c.req.routePath || "unmatched",
      status,
      elapsedMs: Math.max(0, Date.now() - info.started),
    }),
  );
  c.header("X-Request-Id", info.id);
  c.header("Cache-Control", "private, no-store");
  if (error instanceof HTTPException && error.res) {
    const retry = error.res.headers.get("Retry-After");
    if (retry) c.header("Retry-After", retry);
  }
  return c.req.path.startsWith("/api/") || c.req.header("Accept")?.includes("application/json")
    ? c.json({ error: message, code: codes[status] || "REQUEST_FAILED", requestId: info.id }, status)
    : c.text(`${message}\n请求编号：${info.id}`, status);
};
