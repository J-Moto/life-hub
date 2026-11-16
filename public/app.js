// Placeholder client. Uses textContent only (never innerHTML) so task titles can't inject markup.
// What each answer means lives in hub-logic.js; this file only touches the page.
import { applyResult, classify, emptySection, formatUpdated, writeOutcome } from "./hub-logic.js";

const $ = (id) => document.getElementById(id);

/**
 * The page's one way of asking. `redirect: "manual"` makes a redirect to the Access sign-in
 * page show up as type "opaqueredirect" (status 0) instead of an unreadable cross-origin error.
 * Returns the classified answer, never throws.
 */
async function ask(path, options = {}) {
  try {
    const res = await fetch(path, { credentials: "same-origin", redirect: "manual", ...options });
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

function post(path, body) {
  return ask(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function status(text) {
  $("status").textContent = text;
}

/** Applies a write's outcome. Returns true when it worked. */
function showWrite(result, control) {
  const out = writeOutcome(result);
  if (out.signIn) $("signin").hidden = false;
  if (out.hideControl && control) control.hidden = true;
  if (out.reconnect) $("tasks-reconnect").hidden = false;
  status(out.note ?? "");
  return result.kind === "ok";
}

const sections = { tasks: emptySection(), calendar: emptySection(), habits: emptySection() };

function renderChrome(name) {
  const s = sections[name];
  $(`${name}-note`).textContent = s.note ?? "";
  $(`${name}-reconnect`).hidden = !s.reconnect;
  $(`${name}-updated`).textContent = s.updatedAt ? formatUpdated(s.updatedAt) : "";
}

function renderTasks(data) {
  const list = $("today");
  list.replaceChildren();
  for (const t of data.tasks) {
    const li = document.createElement("li");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = `t-${t.id}`;
    box.disabled = !data.writes.complete;
    const label = document.createElement("label");
    label.htmlFor = box.id;
    label.textContent = t.title;
    box.addEventListener("change", async () => {
      box.disabled = true;
      const ok = showWrite(await post(`/api/tasks/${encodeURIComponent(t.id)}/complete`), null);
      if (ok) li.remove();
      else {
        box.checked = false;
        box.disabled = false;
      }
    });
    li.append(box, label);
    list.append(li);
  }
  // A control is shown only when /api/tasks says its route is on.
  $("add-form").hidden = !data.writes.next;
  $("restart").hidden = !data.writes.restart;
}

function renderCalendar(data) {
  const list = $("calendar");
  list.replaceChildren();
  for (const e of data.events) {
    const li = document.createElement("li");
    li.textContent = e.title;
    list.append(li);
  }
}

function renderHabits(data) {
  const list = $("habits");
  list.replaceChildren();
  for (const h of data.habits) {
    const li = document.createElement("li");
    li.textContent = `${h.name}: ${h.percent}%`;
    list.append(li);
  }
}

const renderers = { tasks: renderTasks, calendar: renderCalendar, habits: renderHabits };

async function loadSection(name) {
  const result = await ask(`/api/${name}`);
  if (result.kind === "signin") $("signin").hidden = false;
  sections[name] = applyResult(sections[name], result, new Date());
  if (result.kind === "ok") renderers[name](sections[name].data);
  renderChrome(name);
  if (result.kind === "ok" && name === "calendar" && sections.calendar.data.events.length === 0) {
    $("calendar-note").textContent = "Nothing on the calendar today.";
  }
}

/** Three independent loads: a slow or failing section doesn't hold up the others. */
function loadAll() {
  return Promise.all(["calendar", "tasks", "habits"].map(loadSection));
}

$("refresh").addEventListener("click", loadAll);

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("add").value;
  if (showWrite(await post("/api/next", { title, job: $("job").checked }), $("add-form"))) {
    $("add").value = "";
    status("Added to Next.");
  }
});

$("restart").addEventListener("click", async () => {
  if (!confirm("Move today's unfinished tasks to Next and start fresh?")) return;
  const result = await post("/api/restart");
  if (showWrite(result, $("restart"))) {
    status("The system is back on.");
    loadAll();
  }
});

loadAll();
