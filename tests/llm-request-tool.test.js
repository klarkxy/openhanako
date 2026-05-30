import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLlmRequestTool } from "../lib/tools/llm-request-tool.js";

// ---- helpers ----------------------------------------------------------------

function makeOpts(overrides = {}) {
  return {
    resolveUtilityConfig: vi.fn(() => ({
      utility: { id: "gpt-4o", provider: "openai" },
      api_key: "sk-test-key",
      base_url: "https://api.openai.com/v1",
      api: "openai-completions",
    })),
    getAvailableModels: vi.fn(() => [
      { id: "gpt-4o", provider: "openai", api: "openai-completions", baseUrl: "https://api.openai.com/v1" },
      { id: "claude-3-5-sonnet", provider: "anthropic", api: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
      { id: "deepseek-chat", provider: "deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com/v1" },
    ]),
    resolveModelWithCredentials: vi.fn((ref) => {
      const map = {
        "openai/gpt-4o": { modelId: "gpt-4o", id: "gpt-4o", provider: "openai", apiKey: "sk-openai", baseUrl: "https://api.openai.com/v1", api: "openai-completions" },
        "anthropic/claude-3-5-sonnet": { modelId: "claude-3-5-sonnet", id: "claude-3-5-sonnet", provider: "anthropic", apiKey: "sk-ant", baseUrl: "https://api.anthropic.com", api: "anthropic-messages" },
        "deepseek/deepseek-chat": { modelId: "deepseek-chat", id: "deepseek-chat", provider: "deepseek", apiKey: "sk-ds", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions" },
      };
      return map[ref] || null;
    }),
    getAgentConfig: vi.fn(() => ({
      models: { chat: "openai/gpt-4o" },
    })),
    ...overrides,
  };
}

// ---- tests ------------------------------------------------------------------

describe("llm-request-tool", () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "Hello from LLM" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 工具结构 ──

  it("returns a tool object with correct name and schema", () => {
    const tool = createLlmRequestTool(makeOpts());
    expect(tool.name).toBe("llm_request");
    expect(tool.label).toBe("LLM Request");
    expect(tool.parameters).toBeDefined();
    expect(typeof tool.execute).toBe("function");
    expect(tool.description).toContain("direct request");
  });

  // ── 参数验证 ──

  it("returns error when messages is empty array", async () => {
    const tool = createLlmRequestTool(makeOpts());
    const result = await tool.execute("call_1", { messages: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/messages.*required/i);
  });

  it("returns error when messages is missing", async () => {
    const tool = createLlmRequestTool(makeOpts());
    const result = await tool.execute("call_1", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/messages.*required/i);
  });

  // ── 默认模型（无 model 参数）──

  it("uses agent default chat model when no model specified", async () => {
    const opts = makeOpts();
    const tool = createLlmRequestTool(opts);
    const result = await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("Hello from LLM");
    expect(result.details.model).toBe("openai/gpt-4o");

    // 默认模型走 resolveModelWithCredentials（优先）而非 resolveUtilityConfig
    expect(opts.resolveModelWithCredentials).toHaveBeenCalledWith("openai/gpt-4o");
    // resolveUtilityConfig 不应被调用（chat 模型在 availableModels 中找到了）
    expect(opts.resolveUtilityConfig).not.toHaveBeenCalled();
  });

  it("returns error when no chat model configured and no model specified", async () => {
    const opts = makeOpts({
      getAgentConfig: vi.fn(() => ({ models: {} })),
    });
    const tool = createLlmRequestTool(opts);
    const result = await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/no.*default.*chat.*model/i);
  });

  it("returns error when resolveUtilityConfig returns no utility model", async () => {
    // chat 模型不在 availableModels 中 → 走 fallback → utilityConfig 也失败
    const opts = makeOpts({
      getAgentConfig: vi.fn(() => ({ models: { chat: "unknown-provider/unknown-model" } })),
      resolveUtilityConfig: vi.fn(() => null),
    });
    const tool = createLlmRequestTool(opts);
    const result = await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/could not resolve.*default/i);
  });

  // ── 指定模型（provider/id 格式）──

  it("resolves model by provider/id format", async () => {
    // anthropic 使用不同的 API 格式，mock 需匹配
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [{ type: "text", text: "Hello from Anthropic" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    const opts = makeOpts();
    const tool = createLlmRequestTool(opts);
    const result = await tool.execute("call_1", {
      model: "anthropic/claude-3-5-sonnet",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("Hello from Anthropic");
    expect(opts.resolveModelWithCredentials).toHaveBeenCalledWith("anthropic/claude-3-5-sonnet");
  });

  it("resolves model by bare model id", async () => {
    const opts = makeOpts();
    const tool = createLlmRequestTool(opts);
    const result = await tool.execute("call_1", {
      model: "deepseek-chat",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBeUndefined();
    // bare id should match deepseek/deepseek-chat
    expect(opts.resolveModelWithCredentials).toHaveBeenCalledWith("deepseek/deepseek-chat");
  });

  it("returns error when specified model not found", async () => {
    const opts = makeOpts();
    const tool = createLlmRequestTool(opts);
    const result = await tool.execute("call_1", {
      model: "nonexistent/model",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found.*available models/i);
    expect(result.content[0].text).toContain("openai/gpt-4o");
    expect(result.content[0].text).toContain("anthropic/claude-3-5-sonnet");
  });

  it("returns error when resolveModelWithCredentials returns null", async () => {
    const opts = makeOpts({
      resolveModelWithCredentials: vi.fn(() => null),
    });
    const tool = createLlmRequestTool(opts);
    const result = await tool.execute("call_1", {
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/could not resolve credentials/i);
  });

  // ── callText 参数传递 ──

  it("passes system_prompt to callText", async () => {
    const tool = createLlmRequestTool(makeOpts());
    await tool.execute("call_1", {
      system_prompt: "You are a pirate",
      messages: [{ role: "user", content: "Hello" }],
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.messages[0]).toMatchObject({ role: "system", content: "You are a pirate" });
  });

  it("passes messages to callText without tools", async () => {
    const tool = createLlmRequestTool(makeOpts());
    await tool.execute("call_1", {
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: "How are you?" },
      ],
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    // 不应包含 tools 字段
    expect(body.tools).toBeUndefined();
    // 不应包含 functions 字段
    expect(body.functions).toBeUndefined();
  });

  it("passes temperature when provided", async () => {
    const tool = createLlmRequestTool(makeOpts());
    await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.7,
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.temperature).toBe(0.7);
  });

  it("omits temperature when not provided", async () => {
    const tool = createLlmRequestTool(makeOpts());
    await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.temperature).toBeUndefined();
  });

  it("passes max_tokens with default 4096", async () => {
    const tool = createLlmRequestTool(makeOpts());
    await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.max_tokens).toBe(4096);
  });

  it("passes custom max_tokens", async () => {
    const tool = createLlmRequestTool(makeOpts());
    await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.max_tokens).toBe(1024);
  });

  // ── 返回值 ──

  it("returns text and usage in result", async () => {
    const tool = createLlmRequestTool(makeOpts());
    const result = await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.content[0].text).toBe("Hello from LLM");
    expect(result.details).toBeDefined();
    expect(result.details.model).toBe("openai/gpt-4o");
    expect(result.details.usage).toBeDefined();
    expect(result.details.token_count).toBe(15);
  });

  // ── 错误处理 ──

  it("handles callText rejection gracefully", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: { message: "Internal server error" } }),
    });

    const tool = createLlmRequestTool(makeOpts());
    const result = await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/error executing llm request/i);
    expect(result.content[0].text).toMatch(/internal server error/i);
  });

  it("handles 401 auth failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "Unauthorized" } }),
    });

    const tool = createLlmRequestTool(makeOpts());
    const result = await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/error executing llm request/i);
  });

  it("handles timeout", async () => {
    mockFetch.mockImplementation(() => {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const tool = createLlmRequestTool(makeOpts());
    const result = await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
      timeout_ms: 1000,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/error executing llm request/i);
  });

  // ── 多轮对话 ──

  it("handles multi-turn conversation", async () => {
    const tool = createLlmRequestTool(makeOpts());
    const result = await tool.execute("call_1", {
      system_prompt: "You are a helpful assistant",
      messages: [
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "And 3+3?" },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("Hello from LLM");

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    // system + 3 messages
    expect(body.messages.length).toBeGreaterThanOrEqual(3);
  });

  // ── usageContext 正确设置 ──

  it("sets usageContext with llm_request operation", async () => {
    // 通过检查 fetch 调用来间接验证（callText 内部使用 usageLedger）
    // 这里主要确认工具不会崩溃，且返回 usage
    const tool = createLlmRequestTool(makeOpts());
    const result = await tool.execute("call_1", {
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.details.usage).toBeDefined();
  });
});
