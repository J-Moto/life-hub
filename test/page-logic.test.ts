import { describe, expect, it } from "vitest";
import { applyResult, classify, emptySection, formatUpdated, writeOutcome } from "../public/hub-logic.js";

// What the page does with each answer from the Worker (docs/design/v1.md, section 3,
// "What each answer means to the page"). The logic is pure: no page, no fetch.

const ok = (body: unknown = {}) => ({ status: 200, type: "basic", body });

describe("classify: one case per row of the answers table", () => {
  it("row 1: the hub's own 401 or 403 means the sign-in has ended", () => {
    expect(classify({ status: 401, type: "basic", body: null }).kind).toBe("signin");
    expect(classify({ status: 403, type: "basic", body: null }).kind).toBe("signin");
    expect(classify({ status: 403, type: "basic", body: { error: "forbidden" } }).kind).toBe("signin");
  });

  it("row 1: a stopped redirect to the Access sign-in page means the sign-in has ended", () => {
    // In a browser, fetch with redirect: "manual" gives type "opaqueredirect" and status 0.
    expect(classify({ status: 0, type: "opaqueredirect", body: null }).kind).toBe("signin");
  });

  it("row 1: status 0 with any other type is a failure, not a sign-in", () => {
    expect(classify({ status: 0, type: "error", body: null }).kind).toBe("failure");
    expect(classify({ status: 0, type: "basic", body: null }).kind).toBe("failure");
  });

  it("row 1 exception: a 403 cross_site is a failure, not a sign-in", () => {
    expect(classify({ status: 403, type: "basic", body: { error: "cross_site" } }).kind).toBe("failure");
  });

  it("row 2: not_connected with a provider name means Reconnect for that provider", () => {
    expect(classify({ status: 503, type: "basic", body: { error: "not_connected", provider: "ticktick" } })).toEqual({
      kind: "reconnect",
      provider: "ticktick",
    });
    expect(classify({ status: 503, type: "basic", body: { error: "not_connected", provider: "google" } })).toEqual({
      kind: "reconnect",
      provider: "google",
    });
  });

  it("row 2: not_connected without a known provider is a failure", () => {
    expect(classify({ status: 503, type: "basic", body: { error: "not_connected" } }).kind).toBe("failure");
    expect(classify({ status: 503, type: "basic", body: { error: "not_connected", provider: "evil" } }).kind).toBe("failure");
  });

  it("row 3: not_configured means a fixed 'not set up yet' line", () => {
    expect(classify({ status: 503, type: "basic", body: { error: "not_configured" } }).kind).toBe("not_configured");
  });

  it("row 4: not_enabled means the control is hidden", () => {
    expect(classify({ status: 503, type: "basic", body: { error: "not_enabled" } }).kind).toBe("not_enabled");
  });

  it("row 5: anything else, or no answer, is a failure", () => {
    const others = [
      { status: 500, type: "basic", body: { error: "internal" } },
      { status: 404, type: "basic", body: { error: "not_found" } },
      { status: 429, type: "basic", body: null },
      { status: 503, type: "basic", body: { error: "something_else" } },
      { status: 200, type: "basic", body: null }, // 200 with a body that is not JSON
    ];
    for (const answer of others) expect(classify(answer).kind).toBe("failure");
    expect(classify(null).kind).toBe("failure"); // fetch threw: no answer at all
  });

  it("a 200 with a JSON body is ok, and keeps the body", () => {
    expect(classify(ok({ tasks: [] }))).toEqual({ kind: "ok", body: { tasks: [] } });
  });
});

describe("writeOutcome", () => {
  it("a 403 cross_site on a write says 'didn't save' and shows no Sign in again link", () => {
    const result = classify({ status: 403, type: "basic", body: { error: "cross_site" } });
    expect(writeOutcome(result)).toEqual({ note: "didn't save", signIn: false, hideControl: false });
  });

  it("an ended sign-in shows the link and no 'didn't save'", () => {
    const result = classify({ status: 401, type: "basic", body: null });
    expect(writeOutcome(result)).toEqual({ note: null, signIn: true, hideControl: false });
  });

  it("not_enabled hides the control and shows no note", () => {
    const result = classify({ status: 503, type: "basic", body: { error: "not_enabled" } });
    expect(writeOutcome(result)).toEqual({ note: null, signIn: false, hideControl: true });
  });

  it("any other failure says 'didn't save'", () => {
    expect(writeOutcome(classify({ status: 500, type: "basic", body: null }))).toEqual({
      note: "didn't save",
      signIn: false,
      hideControl: false,
    });
    expect(writeOutcome(classify(null)).note).toBe("didn't save");
  });

  it("a Reconnect answer on a write names the provider's banner, not 'didn't save'", () => {
    const result = classify({ status: 503, type: "basic", body: { error: "not_connected", provider: "ticktick" } });
    expect(writeOutcome(result)).toEqual({ note: null, signIn: false, hideControl: false, reconnect: "ticktick" });
  });
});

describe("applyResult: what a section shows after a load", () => {
  const t1 = new Date(2026, 10, 16, 9, 41);
  const t2 = new Date(2026, 10, 16, 9, 51);
  const loaded = () => applyResult(emptySection(), classify(ok({ tasks: ["a"] })), t1);

  it("a good load keeps the data and the time of that load", () => {
    const s = loaded();
    expect(s.data).toEqual({ tasks: ["a"] });
    expect(s.updatedAt).toEqual(t1);
    expect(s.note).toBeNull();
  });

  it("a failed refresh keeps the last data and its time, with 'couldn't update'", () => {
    const s = applyResult(loaded(), classify({ status: 500, type: "basic", body: null }), t2);
    expect(s.data).toEqual({ tasks: ["a"] });
    expect(s.updatedAt).toEqual(t1);
    expect(s.note).toBe("couldn't update");
  });

  it("a section that never loaded says 'couldn't load'", () => {
    const s = applyResult(emptySection(), classify(null), t1);
    expect(s.data).toBeNull();
    expect(s.note).toBe("couldn't load");
  });

  it("a later good load clears the note", () => {
    const failed = applyResult(loaded(), classify(null), t2);
    const s = applyResult(failed, classify(ok({ tasks: [] })), t2);
    expect(s.note).toBeNull();
    expect(s.updatedAt).toEqual(t2);
  });

  it("reconnect shows that provider's banner and keeps the old data", () => {
    const s = applyResult(loaded(), classify({ status: 503, type: "basic", body: { error: "not_connected", provider: "google" } }), t2);
    expect(s.reconnect).toBe("google");
    expect(s.data).toEqual({ tasks: ["a"] });
  });

  it("not_configured shows the fixed 'not set up yet' line", () => {
    const s = applyResult(emptySection(), classify({ status: 503, type: "basic", body: { error: "not_configured" } }), t1);
    expect(s.note).toBe("not set up yet");
    expect(s.data).toBeNull();
  });

  it("an ended sign-in leaves the section as it was: no 'couldn't update'", () => {
    const before = loaded();
    const s = applyResult(before, classify({ status: 401, type: "basic", body: null }), t2);
    expect(s).toEqual(before);
  });
});

describe("formatUpdated", () => {
  it("shows the time of the last good load", () => {
    expect(formatUpdated(new Date(2026, 10, 16, 9, 41))).toMatch(/^updated .*9:41/);
  });
});
