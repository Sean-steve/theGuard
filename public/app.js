let token = "";
let projects = [];
let audits = [];
let current = null;
let dryRun = true;
const byId = id => document.getElementById(id);
const money = minor => "KES " + (Number(minor || 0) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toast(message) {
  const box = byId("toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.hidden = true; }, 5500);
}
async function api(path, method = "GET", payload) {
  const response = await fetch(path, {
    method,
    headers: { "Authorization": "Bearer " + token, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    cache: "no-store"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Request failed (" + response.status + ")");
  return result;
}
function showPage(name) {
  document.querySelectorAll(".page").forEach(element => { element.hidden = element.id !== name; });
  document.querySelectorAll(".nav").forEach(element => {
    element.classList.toggle("active", element.dataset.page === name);
  });
}
function statusTag(status) {
  const span = document.createElement("span");
  span.className = "status " + status;
  span.textContent = status;
  return span;
}
function displayProjectList(container, entries) {
  container.replaceChildren();
  if (!entries.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No projects registered yet.";
    container.append(p); return;
  }
  for (const project of entries) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "row";
    const left = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = project.name;
    const desc = document.createElement("small");
    desc.textContent = project.client_name + " · " + project.domain;
    left.append(title, desc);
    button.append(left, statusTag(project.license.status));
    button.addEventListener("click", () => {
      showPage("projects");
      openDetail(project.id);
    });
    container.append(button);
  }
}
function render() {
  byId("total").textContent = String(projects.length);
  byId("active").textContent = String(projects.filter(p => p.license.status === "ACTIVE" || p.license.status === "PERMANENT").length);
  byId("grace").textContent = String(projects.filter(p => p.license.status === "GRACE").length);
  byId("restricted").textContent = String(projects.filter(p => p.license.status === "RESTRICTED").length);
  byId("projectCount").textContent = projects.length + " RECORDS";
  byId("modeTag").textContent = dryRun ? "DRY RUN" : "ENFORCEMENT MODE";
  byId("securityBanner").textContent = dryRun
    ? "DRY-RUN SAFETY MODE: no real restrictions will be issued. Sandbox balances cannot enforce licences."
    : "ENFORCEMENT MODE: restrictions require verified financial events, a signed contract, written notice, eligible hosting and an expired grace period.";
  displayProjectList(byId("recentProjects"), projects.slice(0, 5));
  displayProjectList(byId("projectList"), projects);
  renderAudit();
  if (current) openDetail(current);
}
function addFact(parent, label, value) {
  const cell = document.createElement("div");
  cell.className = "detailfact";
  const small = document.createElement("small");
  small.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value || "—";
  cell.append(small, strong); parent.append(cell);
}
function openDetail(id) {
  const p = projects.find(item => item.id === id);
  if (!p) return;
  current = id;
  byId("detail").hidden = false;
  byId("detailName").textContent = p.name;
  byId("detailStatus").className = "status " + p.license.status;
  byId("detailStatus").textContent = p.license.status;
  byId("detailReason").textContent = p.license.reason;
  const facts = byId("detailFacts");
  facts.replaceChildren();
  addFact(facts, "Invoice reference", p.external_invoice_id);
  addFact(facts, "Deployment", p.deployment_kind.replaceAll("_", " "));
  addFact(facts, "Tracked outstanding balance", money(p.balance_minor));
  addFact(facts, "Payment evidence", p.payment_source);
  addFact(facts, "Payment due", p.due_at ? new Date(p.due_at).toLocaleString() : "Not received");
  addFact(facts, "Notice sent", p.notice_sent_at ? new Date(p.notice_sent_at).toLocaleString() : "Not recorded");
  const form = byId("policyForm");
  form.elements.contract_reference.value = p.contract_reference || "";
  form.elements.contract_date.value = p.contract_accepted_at ? String(p.contract_accepted_at).slice(0, 10) : "";
  form.elements.restriction_scope.value = p.restriction_scope;
  form.elements.grace_days.value = p.grace_days;
  form.elements.enforcement_enabled.checked = p.enforcement_enabled;
  byId("placeHold").textContent = p.hold_reason ? "Release payment hold" : "Place payment dispute hold";
  byId("recordNotice").disabled = !!p.notice_sent_at || !p.invoice_overdue || !p.contract_reference;
  byId("makePermanent").disabled = !!p.permanent_at || p.payment_source !== "verified" || Number(p.balance_minor) !== 0;
  byId("detail").scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderAudit() {
  const box = byId("activityList");
  box.replaceChildren();
  if (!audits.length) {
    const p = document.createElement("p"); p.className = "muted"; p.textContent = "No activity yet.";
    box.append(p); return;
  }
  for (const entry of audits) {
    const row = document.createElement("div"); row.className = "row";
    const text = document.createElement("span");
    const strong = document.createElement("strong"); strong.textContent = entry.action;
    const small = document.createElement("small");
    small.textContent = (entry.project_id || "System") + " · " + new Date(entry.created_at).toLocaleString();
    text.append(strong, small); row.append(text); box.append(row);
  }
}
async function refresh() {
  const [one, two] = await Promise.all([api("/api/projects"), api("/api/audit")]);
  projects = one.projects; audits = two.events; dryRun = one.dry_run;
  render();
}
document.querySelectorAll(".nav").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});
document.querySelectorAll(".goto-projects").forEach(button => button.addEventListener("click", () => showPage("projects")));
byId("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  token = byId("adminToken").value;
  try {
    await refresh();
    byId("loginOverlay").hidden = true;
    byId("adminToken").value = "";
    byId("loginError").textContent = "";
  } catch (error) {
    token = "";
    byId("loginError").textContent = error.message;
  }
});
byId("projectForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const b = Object.fromEntries(new FormData(form).entries());
  try {
    const result = await api("/api/projects", "POST", b);
    byId("keyText").textContent = result.project_key_once;
    byId("keyResult").hidden = false;
    form.reset();
    await refresh();
    toast("Project registered. Copy and securely store its one-time project key.");
  } catch (error) { toast(error.message); }
});
byId("policyForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!current) return;
  const form = event.currentTarget;
  const b = {
    contract_reference: form.elements.contract_reference.value,
    contract_accepted_at: form.elements.contract_date.value ? form.elements.contract_date.value + "T00:00:00Z" : null,
    restriction_scope: form.elements.restriction_scope.value,
    grace_days: Number(form.elements.grace_days.value),
    enforcement_enabled: form.elements.enforcement_enabled.checked
  };
  try {
    await api("/api/projects/" + current + "/policy", "POST", b);
    await refresh(); toast("Contract and licensing policy saved.");
  } catch (error) { toast(error.message); }
});
byId("recordNotice").addEventListener("click", async () => {
  if (!current) return;
  const evidence = prompt("Enter an independently verifiable notice delivery / document reference:");
  if (!evidence) return;
  try {
    await api("/api/projects/" + current + "/notice", "POST", { notice_evidence: evidence });
    await refresh(); toast("Notice evidence recorded. No email was sent by Guard.");
  } catch (error) { toast(error.message); }
});
byId("placeHold").addEventListener("click", async () => {
  if (!current) return;
  const p = projects.find(item => item.id === current);
  const clear = Boolean(p.hold_reason);
  const reason = clear ? "" : prompt("Reason for the payment dispute / manual hold:");
  if (!clear && !reason) return;
  if (clear && !confirm("Release this hold only after reviewing the dispute. Continue?")) return;
  try {
    await api("/api/projects/" + current + "/hold", "POST", clear ? { clear: true } : { reason });
    await refresh(); toast(clear ? "Hold released." : "Hold placed. Licensed features remain unrestricted.");
  } catch (error) { toast(error.message); }
});
byId("makePermanent").addEventListener("click", async () => {
  if (!current) return;
  const handover = prompt("Enter the final verified handover / settlement reference:");
  if (!handover) return;
  if (!confirm("Issue an irreversible permanent development licence after verifying complete payment?")) return;
  try {
    await api("/api/projects/" + current + "/permanent", "POST", { handover_reference: handover });
    await refresh(); toast("Permanent licence issued.");
  } catch (error) { toast(error.message); }
});
