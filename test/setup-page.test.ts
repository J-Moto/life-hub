import { afterEach, describe, expect, it, vi } from "vitest";

// The setup page's script, `public/setup.js`, run against a stand-in for the page: just the
// parts of `document`, `location`, `history` and `window` the script touches. What each
// answer means is tested in page-logic.test.ts; this file is about what the script does to
// the page's own controls.

interface FakeButton {
  dataset: { action: string };
  disabled: boolean;
  hidden: boolean;
  addEventListener(type: string, listener: () => Promise<void>): void;
  /** Presses the button and waits for the script's handler to finish. */
  press(): Promise<void>;
}

function fakeButton(action: string): FakeButton {
  let onClick: (() => Promise<void>) | undefined;
  return {
    dataset: { action },
    disabled: false,
    hidden: false,
    addEventListener: (type, listener) => {
      if (type === "click") onClick = listener;
    },
    press: async () => {
      await onClick?.();
    },
  };
}

/** Loads the script into a page with one Google section. */
async function loadSetupPage() {
  const connect = fakeButton("connect");
  const disconnect = fakeButton("disconnect");
  const buttons = [connect, disconnect];
  const note = { textContent: "" };
  const signin = { hidden: true };
  const status = { textContent: "not connected" };
  const section = {
    dataset: { provider: "google" },
    querySelectorAll: () => buttons,
    querySelector: (selector: string) =>
      selector === ".status" ? status : (buttons.find((b) => selector.includes(`"${b.dataset.action}"`)) ?? null),
  };
  const windowListeners = new Map<string, (event: { persisted: boolean }) => void>();
  const location = { search: "", assign: vi.fn() };

  vi.stubGlobal("document", {
    getElementById: (id: string) => (id === "note" ? note : id === "signin" ? signin : null),
    querySelectorAll: (selector: string) => (selector === "button[data-action]" ? buttons : [section]),
  });
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", { replaceState: vi.fn() });
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: { persisted: boolean }) => void) => windowListeners.set(type, listener),
  });

  vi.resetModules();
  await import("../public/setup.js");

  return {
    connect,
    disconnect,
    note,
    location,
    /** The browser shows the page: `persisted` is true when it came back from the back/forward cache. */
    pageshow: (persisted: boolean) => windowListeners.get("pageshow")?.({ persisted }),
  };
}

const SIGN_IN = "https://accounts.google.com/o/oauth2/v2/auth?state=abc";

const answer = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("setup page script", () => {
  it("Connect is on again when the browser brings the page back from Google's sign-in page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(answer({ url: SIGN_IN }));
    const page = await loadSetupPage();

    // Off to Google: the button stays off while the page is being left.
    await page.connect.press();
    expect(page.location.assign).toHaveBeenCalledWith(SIGN_IN);
    expect(page.connect.disabled).toBe(true);

    // Back is pressed on Google's page and the browser restores this one as it was left.
    page.pageshow(true);
    expect(page.connect.disabled).toBe(false);
    expect(page.disconnect.disabled).toBe(false);
  });

  it("an ordinary page load does not switch a button back on while its request is running", async () => {
    let finish: (res: Response) => void = () => undefined;
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)));
    const page = await loadSetupPage();

    const pressed = page.disconnect.press();
    expect(page.disconnect.disabled).toBe(true);
    // `pageshow` also fires at the end of a first load (not from the cache): nothing changes.
    page.pageshow(false);
    expect(page.disconnect.disabled).toBe(true);

    finish(answer({ ok: true, removeAccess: false }));
    await pressed;
    expect(page.disconnect.disabled).toBe(false);
    expect(page.note.textContent).toBe("Disconnected.");
  });
});
