/**
 * Blocks cross-site requests to routes that change data (CSRF defense on top of Access).
 * A request passes only if the browser says it came from this same site.
 */
export function isSameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin !== null) return origin === url.origin;
  const site = request.headers.get("Sec-Fetch-Site");
  return site === "same-origin";
}
