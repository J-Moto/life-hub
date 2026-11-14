// Placeholder client. Uses textContent only (never innerHTML) so task titles can't inject markup.
const $ = (id) => document.getElementById(id);

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function status(text) {
  $("status").textContent = text;
}

async function load() {
  const res = await fetch("/api/today", { credentials: "same-origin" });
  if (!res.ok) {
    status(res.status === 503 ? "Not connected yet." : `Couldn't load (${res.status}).`);
    return;
  }
  const data = await res.json();
  const list = $("today");
  list.replaceChildren();
  for (const t of data.today ?? []) {
    const li = document.createElement("li");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = `t-${t.id}`;
    const label = document.createElement("label");
    label.htmlFor = box.id;
    label.textContent = t.title;
    box.addEventListener("change", async () => {
      box.disabled = true;
      try {
        await post(`/api/tasks/${encodeURIComponent(t.id)}/complete`);
        li.remove();
      } catch {
        box.checked = false;
        box.disabled = false;
        status("Couldn't complete that task.");
      }
    });
    li.append(box, label);
    list.append(li);
  }
  const habits = $("habits");
  habits.replaceChildren();
  for (const h of data.habits ?? []) {
    const li = document.createElement("li");
    li.textContent = `${h.name}: ${h.percent}%`;
    habits.append(li);
  }
  if (data.problems?.length) status(`Some parts didn't load: ${data.problems.join(", ")}`);
}

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("add").value;
  try {
    await post("/api/next", { title, job: $("job").checked });
    $("add").value = "";
    status("Added to Next.");
  } catch {
    status("Couldn't add that.");
  }
});

$("restart").addEventListener("click", async () => {
  if (!confirm("Move today's unfinished tasks to Next and start fresh?")) return;
  try {
    const r = await post("/api/restart");
    status(r.message);
    load();
  } catch {
    status("Restart failed.");
  }
});

load();
