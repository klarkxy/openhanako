import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const MAIN_PATH = path.join(process.cwd(), "desktop", "main.cjs");

/**
 * 契约测试：desktop 端 browser 控制 WS 在 server 重启后必须能拿到新 token 重连。
 *
 * 根因历史：
 * 旧实现把 `ws://...?token=...` 闭包到 setupBrowserCommands() 函数体顶部，
 * server 重启 -> token 变 -> 旧 ws 用 2s 循环重连永远拿旧 token,
 * server 端 401 -> _transport.connected 永远 false -> 浏览器调用抛
 * "browserDesktopOnly"（误导文案）。
 *
 * 修复：connect() 内动态读 serverPort/serverToken;
 * monitorServer() 重启 server 成功后主动 close 旧 ws,让 on("close") 触发
 * 自然重连（这次重连拿到新 token）。
 */
describe("desktop browser WS reconnect picks up rotated serverToken", () => {
  function readSource() {
    return fs.readFileSync(MAIN_PATH, "utf-8");
  }

  function functionBody(source, name) {
    const start = source.indexOf(`function ${name}`);
    expect(start, `function ${name} should exist`).toBeGreaterThan(-1);
    const bodyStart = source.indexOf(") {", start) + 2;
    expect(bodyStart).toBeGreaterThan(1);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") depth--;
      if (depth === 0) return source.slice(bodyStart + 1, i);
    }
    throw new Error(`unterminated function ${name}`);
  }

  it("setupBrowserCommands() reads serverToken inside connect(), not as a closure constant", () => {
    const source = readSource();
    const body = functionBody(source, "setupBrowserCommands");

    // 反向断言：旧实现里那条把 url 拼好闭包到函数体顶部的写法必须消失
    expect(body).not.toMatch(
      /const\s+url\s*=\s*`ws:\/\/127\.0\.0\.1:\$\{serverPort\}\/internal\/browser\?token=\$\{serverToken\}`/,
    );

    // 正向断言：connect() 内部必须重新读 serverToken / serverPort
    const connectStart = body.indexOf("function connect");
    expect(connectStart, "connect() inner function should exist").toBeGreaterThan(-1);
    const connectBody = functionBody(body.slice(connectStart), "connect");

    expect(connectBody).toMatch(/currentPort\s*=\s*serverPort/);
    expect(connectBody).toMatch(/currentToken\s*=\s*serverToken/);
    expect(connectBody).toMatch(/token=\$\{currentToken\}/);
  });

  it("setupBrowserCommands() exposes a closeable ws handle for monitorServer() to reset", () => {
    const source = readSource();

    // 模块级必须有一个可被 close 的 ws 引用
    expect(source).toMatch(/let\s+_browserWs\s*=\s*null/);
    // 必须有一个对外的 close helper
    const closeBody = functionBody(source, "closeBrowserCommandsWs");
    expect(closeBody).toMatch(/ws\.close\(\)/);
    // 必须先 clear 重连 timer，避免 close 后又 2s 自动重连一次（旧 token）
    expect(closeBody).toMatch(/clearTimeout\(_browserWsReconnectTimer\)/);
  });

  it("monitorServer() closes the browser WS after a successful startServer()", () => {
    const source = readSource();
    const body = functionBody(source, "monitorServer");

    // 重启路径里 closeBrowserCommandsWs 必须在 send("server-restarted", ...) 之前
    const closeIdx = body.indexOf("closeBrowserCommandsWs()");
    const sendIdx = body.indexOf('"server-restarted"');
    expect(closeIdx, "closeBrowserCommandsWs() should be called in monitorServer").toBeGreaterThan(-1);
    expect(sendIdx, 'server-restarted IPC should still fire').toBeGreaterThan(-1);
    expect(closeIdx).toBeLessThan(sendIdx);
  });
});
