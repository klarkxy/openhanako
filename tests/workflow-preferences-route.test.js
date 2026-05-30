// tests/workflow-preferences-route.test.js
import { describe, expect, it } from "vitest";
import { createPreferencesRoute } from "../server/routes/preferences.js";

// Proxy：已知方法走真实实现，未知方法（如 emitAppEvent 内部触达的）一律 no-op，避免 mock 不全报错。
function makeEngine(initial = false) {
  let enabled = initial;
  const real = {
    getWorkflowSettings: () => ({ enabled }),
    setWorkflowSettings: (p) => { enabled = p?.enabled === true; return { enabled }; },
  };
  return new Proxy(real, { get: (t, k) => (k in t ? t[k] : () => {}) });
}

describe("preferences /workflow route", () => {
  it("GET 返回当前设置（默认关）", async () => {
    const route = createPreferencesRoute(makeEngine(false));
    const res = await route.request("/preferences/workflow");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, settings: { enabled: false } });
  });

  it("PUT 打开后 GET 读回 true", async () => {
    const route = createPreferencesRoute(makeEngine(false));
    const put = await route.request("/preferences/workflow", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { enabled: true } }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).settings.enabled).toBe(true);
    const get = await route.request("/preferences/workflow");
    expect((await get.json()).settings.enabled).toBe(true);
  });

  it("PUT 非法 JSON body 返回 400", async () => {
    const route = createPreferencesRoute(makeEngine(false));
    const res = await route.request("/preferences/workflow", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});
