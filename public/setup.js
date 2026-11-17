// The setup page's script. Uses textContent only (never innerHTML). What each answer means,
// and every text shown, lives in hub-logic.js; this file only touches the page.
import { classify, setupOutcome, setupResultText } from "./hub-logic.js";

const note = document.getElementById("note");

// The OAuth callback sends the owner back here with one fixed word in the address. Show its
// fixed text, then take the word out of the address bar.
const resultText = setupResultText(location.search);
if (resultText) note.textContent = resultText;
if (location.search) history.replaceState(null, "", "/setup");

/** The same way of asking as the dashboard's: a classified answer, never a throw. */
async function post(path) {
  try {
    const res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    let body = null;
    if (res.type !== "opaqueredirect") {
      try {
        body = await res.json();
      } catch {
        body = null;
      }
    }
    return classify({ status: res.status, type: res.type, body });
  } catch {
    return classify(null);
  }
}

for (const section of document.querySelectorAll("section[data-provider]")) {
  const provider = section.dataset.provider;
  const button = (action) => section.querySelector(`button[data-action="${action}"]`);

  for (const control of section.querySelectorAll("button[data-action]")) {
    control.addEventListener("click", async () => {
      const action = control.dataset.action;
      control.disabled = true;
      const out = setupOutcome(action, provider, await post(`/setup/${action}/${provider}`));

      // Off to the provider's sign-in page. The button stays off until the page is left.
      if (out.goTo) {
        location.assign(out.goTo);
        return;
      }
      control.disabled = false;
      if (out.signIn) document.getElementById("signin").hidden = false;
      note.textContent = out.note ?? "";
      if (out.disconnected) {
        section.querySelector(".status").textContent = "not connected";
        control.hidden = true;
        const connect = button("connect");
        if (connect) connect.hidden = false;
      }
    });
  }
}
