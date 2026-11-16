import test from "node:test";
import assert from "node:assert/strict";
import { GuardClient } from "../sdk/node.mjs";

const projectId = "8a7fdcc2-91ea-4535-94b8-8b26b58ca272";
const base = { endpoint: "http://127.0.0.1:4080", projectId, projectKey: "private-server-only" };
test("SDK fails open on network errors without modifying any content", async () => {
  const client = new GuardClient({ ...base, fetchImpl: async () => { throw Error("offline"); } });
  const answer = await client.decision();
  assert.equal(answer.status, "UNKNOWN");
  assert.equal(answer.restrict, false);
});
test("SDK accepts eligible, non-dry-run restricted decisions from Guard", async () => {
  const client = new GuardClient({ ...base, fetchImpl: async () => ({
    ok: true, json: async () => ({
      project_id: projectId, status: "RESTRICTED", restrict: true,
      scope: "premium_features", dry_run: false, expires_at: new Date(Date.now() + 30000).toISOString()
    })
  }) });
  assert.equal((await client.decision()).restrict, true);
});
test("SDK rejects forged, stale or dry-run restrictions", async () => {
  for(const patch of [
    { project_id: "wrong" },{dry_run:true},{expires_at:"2020-01-01T00:00:00Z"},{scope:"customer_data"}
  ]) {
    const value = {
      project_id: projectId, status:"RESTRICTED",restrict:true,scope:"premium_features",
      dry_run:false,expires_at:new Date(Date.now()+30000).toISOString(),...patch
    };
    const client=new GuardClient({ ...base,fetchImpl:async()=>({ok:true,json:async()=>value}) });
    assert.equal((await client.decision()).restrict,false);
  }
});
test("SDK requires TLS outside local development", () => {
  assert.throws(() => new GuardClient({ ...base,endpoint:"http://example.com" }),/HTTPS/);
});
