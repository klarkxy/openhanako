// Regression test for the scheduleReconnect backoff reset bug.
//
// Symptom (pre-fix): once `ws.on("open")` had succeeded even once
// (setting `lastConnectedAt`), the next round of fetch failures would
// hit `Date.now() - lastConnectedAt >5*60*1000`, which forced
// `reconnectAttempts =0` on every scheduleReconnect call. As a result
// the adapter retried every1s and printed `[bridge] [qq]1s 后重连(第1次)`
// forever — an hour of logs, hundreds of "fetch failed" entries.
//
// Symptom (post-fix): the counter resets only inside `ws.on("open")`,
// so a sustained outage advances through the [1,2,5,10,30,60] backoff
// schedule and caps at60s.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ws", () => {
 class MockWebSocket {
 static OPEN =1;
 static CLOSED =3;
 static __lastInstance: MockWebSocket | null = null;
 readyState =0;
 handlers: Record<string, (...args: any[]) => void> = {};
 constructor() {
 MockWebSocket.__lastInstance = this;
 }
 on(event: string, handler: (...args: any[]) => void) {
 // Capture handlers so the test can drive open / close manually.
 this.handlers[event] = handler;
 }
 send() {}
 close(code =1000) {
 this.readyState = MockWebSocket.CLOSED;
 this.handlers?.close?.(code);
 }
 }
 return { default: MockWebSocket };
});

const debugLogMock = {
 log: vi.fn(),
 warn: vi.fn(),
 error: vi.fn(),
};

vi.mock("../lib/debug-log.js", () => ({
 debugLog: () => debugLogMock,
 createModuleLogger: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { createQQAdapter } from "../lib/bridge/qq-adapter.ts";

describe("createQQAdapter reconnect backoff", () => {
 beforeEach(() => {
 vi.useFakeTimers();
 vi.stubGlobal("fetch", vi.fn(async () => {
 // Simulate the outage that produced the bug report: every fetch throws.
 throw new TypeError("fetch failed");
 }));
 debugLogMock.log.mockClear();
 debugLogMock.warn.mockClear();
 debugLogMock.error.mockClear();
 });

 afterEach(() => {
 vi.useRealTimers();
 vi.unstubAllGlobals();
 });

 it("advances the backoff schedule across consecutive connect() failures", async () => {
 const adapter = createQQAdapter({
 appID: "app-id",
 appSecret: "app-secret",
 agentId: "hana",
 onMessage: vi.fn(),
 } as any);

 // The factory kicks off connect() which immediately fails on the
 // mocked fetch, scheduling the first retry (1s, attempt #1).
 await vi.advanceTimersByTimeAsync(0);

 function lastReconnectLog(): { sec: number; idx: number } | null {
 const recent = debugLogMock.log.mock.calls
 .map((c) => c.map((x: any) => typeof x === "string" ? x : JSON.stringify(x)).join(" "))
 .filter((line) => line.includes("后重连"))
 .pop();
 if (!recent) return null;
 const m = recent.match(/(\d+)s 后重连[（(]第 (\d+) 次[)）]/);
 if (!m) return null;
 return { sec: Number(m[1]), idx: Number(m[2]) };
 }

 // Initial log:1s, attempt #1 (the factory's connect() failed
 // immediately and scheduleReconnect booked the first retry).
 const initial = lastReconnectLog();
 expect(initial).not.toBeNull();
 expect(initial!.sec).toBe(1);
 expect(initial!.idx).toBe(1);

 // Each advance fires the next pending retry, which fails again and
 // books the next one. Expected sequence after each tick:1,2,5,10,30,60
 // then capped at60.
 const expectedAfterEachAdvance = [2,5,10,30,60,60,60,60];
 for (const expected of expectedAfterEachAdvance) {
 await vi.advanceTimersToNextTimerAsync();
 const got = lastReconnectLog();
 expect(got, `no reconnect log after advancing timers`).not.toBeNull();
 expect(got!.sec).toBe(expected);
 }

 // The counter should monotonically increment without regressing.
 const totalAttempts = lastReconnectLog()!.idx;
 expect(totalAttempts).toBe(expectedAfterEachAdvance.length +1);

 adapter.stop();
 });

 it("does not reset the backoff when the previous connection aged past5 minutes", async () => {
 // Drive a successful ws.open first, age the connection past5 minutes,
 // then break the network. The pre-fix code reset reconnectAttempts on
 // every scheduleReconnect after that5-minute window, pinning the
 // delay at1s. The fix removes that branch entirely so the counter
 // keeps advancing.
 const fetchMock = vi.mocked(fetch as any);
 const okResponse = {
 ok: true,
 json: async () => ({ url: "ws://localhost/qq" }),
 text: async () => JSON.stringify({ url: "ws://localhost/qq" }),
 };
 const tokenResponse = {
 ok: true,
 json: async () => ({ access_token: "qq-token", expires_in:7200 }),
 text: async () => JSON.stringify({ access_token: "qq-token", expires_in:7200 }),
 };
 fetchMock.mockImplementation(async (url: any) => {
 const href = String(url);
 if (href.includes("/app/getAppAccessToken")) return tokenResponse;
 return okResponse;
 });

 const adapter = createQQAdapter({
 appID: "app-id",
 appSecret: "app-secret",
 agentId: "hana",
 onMessage: vi.fn(),
 } as any);
 await vi.advanceTimersByTimeAsync(0);

 // Find the MockWebSocket instance the adapter created and trigger open.
 const wsCtor = (await import("ws")).default as any;
 const wsInstance = wsCtor.__lastInstance;
 expect(wsInstance, "ws constructor was not called by adapter").toBeTruthy();
 wsInstance.handlers?.open?.();

 // Now the connection is "alive": lastConnectedAt = now, and
 // reconnectAttempts was just reset to0. Age the wall clock past5
 // minutes so the pre-fix `Date.now() - lastConnectedAt >5*60*1000`
 // branch would have triggered on every retry.
 vi.setSystemTime(new Date(Date.now() +10 *60 *1000));

 // Break the network and run the adapter into a sustained outage.
 fetchMock.mockImplementation(async () => {
 throw new TypeError("fetch failed");
 });
 // Close the ws to fire the close handler, which schedules a reconnect
 // with reconnectAttempts =0 (will increment to1 once the timer fires).
 wsInstance.close();

 function lastReconnectLog(): { sec: number; idx: number } | null {
 const recent = debugLogMock.log.mock.calls
 .map((c) => c.map((x: any) => typeof x === "string" ? x : JSON.stringify(x)).join(" "))
 .filter((line) => line.includes("后重连"))
 .pop();
 if (!recent) return null;
 const m = recent.match(/(\d+)s 后重连[（(]第 (\d+) 次[)）]/);
 if (!m) return null;
 return { sec: Number(m[1]), idx: Number(m[2]) };
 }

 const expectedAfterEachAdvance = [2,5,10,30,60,60];
 const seen: number[] = [];
 for (const expected of expectedAfterEachAdvance) {
 await vi.advanceTimersToNextTimerAsync();
 const got = lastReconnectLog();
 expect(got).not.toBeNull();
 expect(got!.sec).toBe(expected);
 seen.push(got!.sec);
 }

 // The pre-fix bug would have left every entry at1s. Confirm we get
 // the full backoff progression regardless of the5-minute cliff.
 expect(seen).toEqual(expectedAfterEachAdvance);

 adapter.stop();
 });
});
