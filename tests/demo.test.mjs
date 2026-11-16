import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../demo/server.mjs";
import { pageForLicense, publicStatus } from "../demo/gate.mjs";

const initial = { status: "ACTIVE", restrict: false, scope: null };
test("the demo sends no protected content when marketing-site entitlement is restricted", () => {
  assert.equal(pageForLicense(initial, "home").page, "index.html");
  assert.equal(pageForLicense(initial, "portfolio").page, "portfolio.html");
  for (const route of ["home", "portfolio"]) {
    const restricted = pageForLicense({
      status: "RESTRICTED", restrict: true, scope: "licensed_marketing_site"
    }, route);
    assert.equal(restricted.page, "restricted.html");
    assert.equal(restricted.blocked, true);
  }
});
test("premium_features restriction is scoped only to premium portfolio", () => {
  const decision = { status: "RESTRICTED", restrict: true, scope: "premium_features" };
  assert.equal(pageForLicense(decision, "home").blocked, false);
  assert.equal(pageForLicense(decision, "portfolio").blocked, true);
});
test("grace, disputes, permanent and connection failures always preserve marketing access", () => {
  for (const status of ["ACTIVE", "GRACE", "PERMANENT", "UNKNOWN"]) {
    assert.equal(pageForLicense({ status, restrict: false }, "home").blocked, false);
    assert.equal(publicStatus({ status, restrict: false }).restricted_marketing, false);
  }
  assert.equal(pageForLicense({ status: "RESTRICTED", restrict: false }, "home").blocked, false);
});
test("standalone demo server gates actual routes rather than merely hiding text with CSS", async () => {
  let decision = { status: "ACTIVE", restrict: false, scope: null };
  const server = createDemoServer({ client: { decision: async () => decision } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    let response = await fetch(base + "/");
    let html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Ideas that/);
    assert.doesNotMatch(html, /is taking a pause/);
    response = await fetch(base + "/portfolio");
    assert.match(await response.text(), /Bloomfield Botanics/);

    decision = { status: "RESTRICTED", restrict: true, scope: "licensed_marketing_site" };
    response = await fetch(base + "/");
    html = await response.text();
    assert.match(html, /is taking a pause/);
    assert.doesNotMatch(html, /Ideas that|Bloomfield Botanics|Thoughtful identities/);
    assert.match(html, /fictional website/i);
    response = await fetch(base + "/portfolio");
    assert.doesNotMatch(await response.text(), /Bloomfield Botanics/);
    const json = await (await fetch(base + "/api/demo/status")).json();
    assert.equal(json.status, "RESTRICTED");
    assert.equal(json.restricted_marketing, true);
    assert.equal(json.demonstration_only, true);
    assert.equal(JSON.stringify(json).includes("balance"), false);

    decision = { status: "GRACE", restrict: false };
    assert.match(await (await fetch(base + "/")).text(), /Ideas that/);
    decision = { status: "PERMANENT", restrict: false };
    assert.match(await (await fetch(base + "/portfolio")).text(), /Bloomfield Botanics/);

    decision = { status: "UNKNOWN", restrict: false };
    assert.match(await (await fetch(base + "/")).text(), /Ideas that/);
    assert.equal((await (await fetch(base + "/api/demo/status")).json()).status, "UNKNOWN");

    response = await fetch(base + "/assets/site.js");
    assert.equal(response.status, 200);
    const source = await response.text();
    assert.doesNotMatch(source, /DEMO_PROJECT_KEY|x-guard-project-key|GUARD_ADMIN_TOKEN/);
    response = await fetch(base + "/api/demo/status", { method: "POST" });
    assert.equal(response.status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
