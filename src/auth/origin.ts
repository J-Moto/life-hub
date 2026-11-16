/**
 * Blocks cross-site requests to routes that change data (CSRF defense on top of Access).
 * A request passes only when its `Origin` header is exactly the request's own origin
 * (scheme, host and port). A missing `Origin` is rejected; no other header stands in for it.
 */
export function isSameOrigin(request: Request): boolean {
  return request.headers.get("Origin") === new URL(request.url).origin;
}
