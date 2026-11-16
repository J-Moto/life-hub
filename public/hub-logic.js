// What each answer from the Worker means to the page (docs/design/v1.md, section 3).
// Pure functions: no document, no window, no fetch. Tested in test/page-logic.test.ts.

const PROVIDERS = ["ticktick", "google"];

/**
 * `answer` is `{ status, type, body }` (type is Response.type, body the parsed JSON or null),
 * or null when there was no answer at all (fetch threw).
 * Returns `{ kind, provider?, body? }`; kind is one of
 * ok | signin | reconnect | not_configured | not_enabled | failure.
 */
export function classify(answer) {
  if (!answer) return { kind: "failure" };
  const { status, type, body } = answer;
  const error = body && typeof body === "object" ? body.error : undefined;

  // A redirect the browser stopped (fetch with redirect: "manual"): the Access sign-in page.
  if (type === "opaqueredirect" && status === 0) return { kind: "signin" };
  if (status === 0) return { kind: "failure" };

  // A 403 cross_site means no or a null Origin on a POST. Signing in again would not fix it.
  if (status === 403 && error === "cross_site") return { kind: "failure" };
  if (status === 401 || status === 403) return { kind: "signin" };

  if (status === 503 && error === "not_connected") {
    return PROVIDERS.includes(body.provider) ? { kind: "reconnect", provider: body.provider } : { kind: "failure" };
  }
  if (status === 503 && error === "not_configured") return { kind: "not_configured" };
  if (status === 503 && error === "not_enabled") return { kind: "not_enabled" };

  if (status >= 200 && status < 300 && body && typeof body === "object") return { kind: "ok", body };
  return { kind: "failure" };
}

/** What a write shows: a note, the page-level sign-in link, whether its control is hidden. */
export function writeOutcome(result) {
  switch (result.kind) {
    case "ok":
      return { note: null, signIn: false, hideControl: false };
    case "signin":
      return { note: null, signIn: true, hideControl: false };
    case "not_enabled":
      return { note: null, signIn: false, hideControl: true };
    case "reconnect":
      return { note: null, signIn: false, hideControl: false, reconnect: result.provider };
    default:
      return { note: "didn't save", signIn: false, hideControl: false };
  }
}

export function emptySection() {
  return { data: null, updatedAt: null, note: null, reconnect: null };
}

/** The section after one load. Never mutates `state`. */
export function applyResult(state, result, now) {
  switch (result.kind) {
    case "ok":
      return { data: result.body, updatedAt: now, note: null, reconnect: null };
    case "signin":
      return state; // the page-level link handles it; the section stays as it was
    case "reconnect":
      return { ...state, reconnect: result.provider, note: null };
    case "not_configured":
      return { ...state, note: "not set up yet", reconnect: null };
    default:
      return { ...state, note: state.data ? "couldn't update" : "couldn't load", reconnect: null };
  }
}

/** "updated 9:41", in the browser's own time. */
export function formatUpdated(date) {
  return `updated ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
