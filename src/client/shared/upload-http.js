// Transport helpers only. Each uploader still owns its task state and recovery.
export async function readUploadResponse(
  response,
  {
    optionalNotFound = false,
    authMessage,
    failureMessage = (status) => `请求失败（${status}）`,
    invalidMessage = "服务器返回异常。",
  } = {},
) {
  if (optionalNotFound && response.status === 404 && !response.redirected) return null;
  const body = await response.json().catch(() => null);
  const invalid = !body || typeof body !== "object" || Array.isArray(body);
  if (!response.ok || response.redirected || invalid) {
    const auth = response.redirected || response.status === 401 || response.status === 403;
    const message =
      auth && authMessage
        ? authMessage
        : typeof body?.error === "string" && body.error
          ? body.error
          : invalid
            ? invalidMessage
            : failureMessage(response.status);
    const error = new Error(message);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("Retry-After")) || 0;
    // Redirects and malformed successful responses must not replay writes.
    error.retryable = !response.redirected && response.status >= 500;
    throw error;
  }
  return body;
}

export async function retryUpload(
  action,
  { delayMs = 800, attempts = 3, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (
        error.name === "AbortError" ||
        error.retryable === false ||
        (error.status > 0 && error.status < 500) ||
        attempt === attempts - 1
      )
        throw error;
      await sleep(delayMs * 2 ** attempt);
    }
  }
  throw new Error("Upload retry requires at least one attempt");
}
