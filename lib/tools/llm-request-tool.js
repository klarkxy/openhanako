/**
 * llm-request-tool.js — 独立 LLM 请求工具
 *
 * 允许 agent 向云端大模型发送独立请求，自行指定 system prompt 和 messages。
 * 不附带任何 tools/skills，是单纯的 LLM 调用。
 * 默认使用 agent 的聊天模型，支持从已配置的供应商中选择其他模型。
 */

import { Type } from "../pi-sdk/index.ts";
import { callText } from "../../core/llm-client.ts";

/**
 * 创建 LLM 请求工具
 * @param {object} opts - 依赖注入
 * @param {() => object} opts.resolveUtilityConfig - 获取 utility 模型凭证
 * @param {() => object[]} opts.getAvailableModels - 获取所有可用模型列表
 * @param {(ref: string) => object|null} opts.resolveModelWithCredentials - 从 engine 解析指定模型的完整凭证
 * @param {() => object} opts.getAgentConfig - 获取 agent config
 * @returns {object} 工具定义
 */
export function createLlmRequestTool({
  resolveUtilityConfig,
  getAvailableModels,
  resolveModelWithCredentials,
  getAgentConfig,
}) {
  return {
    name: "llm_request",
    label: "LLM Request",
    description: `Send a direct request to a cloud LLM without any tools or skills. Use this when you need to get a raw response from a model for custom tasks.

Parameters:
- system_prompt: System prompt (optional)
- messages: Array of message objects with role and content (required)
- model: Model reference in "provider/model" format or bare model id (optional, defaults to agent's chat model)
- temperature: Temperature setting (optional)
- max_tokens: Maximum tokens for response (optional, default 4096)
- timeout_ms: Request timeout in milliseconds (optional, default 120000)

Examples:
- Basic usage: { messages: [{ role: "user", content: "Hello, how are you?" }] }
- With system prompt: { system_prompt: "You are a helpful assistant", messages: [{ role: "user", content: "Explain quantum computing" }] }
- Specify model: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Write a poem" }] }`,

    parameters: Type.Object({
      system_prompt: Type.Optional(Type.String({
        description: "System prompt to set the behavior and context for the LLM",
      })),
      messages: Type.Array(
        Type.Object({
          role: Type.Union([
            Type.Literal("user"),
            Type.Literal("assistant"),
            Type.Literal("system"),
          ], {
            description: "Role of the message sender",
          }),
          content: Type.String({
            description: "Content of the message",
          }),
        }, {
          description: "Message object with role and content",
        }),
        {
          description: "Array of messages to send to the LLM. At least one message is required.",
          minItems: 1,
        }
      ),
      model: Type.Optional(Type.String({
        description: 'Model reference in "provider/model" format (e.g., "openai/gpt-4o") or bare model id (e.g., "gpt-4o"). If not specified, uses the agent\'s default chat model.',
      })),
      temperature: Type.Optional(Type.Number({
        description: "Temperature setting for response randomness (0.0 to 2.0)",
        minimum: 0,
        maximum: 2,
      })),
      max_tokens: Type.Optional(Type.Number({
        description: "Maximum number of tokens in the response",
        minimum: 1,
        maximum: 128000,
        default: 4096,
      })),
      timeout_ms: Type.Optional(Type.Number({
        description: "Request timeout in milliseconds",
        minimum: 1000,
        maximum: 600000,
        default: 120000,
      })),
    }, {
      description: "Parameters for sending a direct LLM request",
    }),

    execute: async (toolCallId, params) => {
      const {
        system_prompt,
        messages,
        model: modelRef,
        temperature,
        max_tokens = 4096,
        timeout_ms = 120000,
      } = params;

      // 验证参数
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return {
          content: [{
            type: "text",
            text: "Error: messages parameter is required and must be a non-empty array",
          }],
          isError: true,
        };
      }

      // 解析模型
      let modelConfig;
      let modelId;
      let apiKey;
      let baseUrl;
      let api;

      try {
        if (modelRef) {
          // 用户指定了模型，从 availableModels 解析
          const availableModels = getAvailableModels();
          const model = availableModels.find(m => {
            const fullRef = `${m.provider}/${m.id}`;
            return fullRef === modelRef || m.id === modelRef;
          });

          if (!model) {
            return {
              content: [{
                type: "text",
                text: `Error: Model "${modelRef}" not found in available models. Available models: ${availableModels.map(m => `${m.provider}/${m.id}`).join(", ")}`,
              }],
              isError: true,
            };
          }

          // 用 provider/id 格式解析凭证
          const resolved = resolveModelWithCredentials(`${model.provider}/${model.id}`);
          if (!resolved) {
            return {
              content: [{
                type: "text",
                text: `Error: Could not resolve credentials for model "${modelRef}"`,
              }],
              isError: true,
            };
          }

          // resolveModelWithCredentials 返回 snake_case 字段(api_key/base_url),
          // 内部变量保持 camelCase 喂给 callText。
          // model 字段是真正的模型对象(callText 用 modelObj.id 取模型名),
          // 顶层没有 id,不能直接把 resolved 当 model 传。
          modelConfig = resolved.model;
          modelId = resolved.model?.id;
          apiKey = resolved.api_key;
          baseUrl = resolved.base_url;
          api = resolved.api;
        } else {
          // 使用默认模型（agent 聊天模型）
          const agentConfig = getAgentConfig();
          const chatModelRef = agentConfig?.models?.chat;

          if (!chatModelRef) {
            return {
              content: [{
                type: "text",
                text: "Error: No model specified and agent has no default chat model configured",
              }],
              isError: true,
            };
          }

          // 将 chatModelRef 归一化为字符串
          const chatRefStr = typeof chatModelRef === "object"
            ? `${chatModelRef.provider || chatModelRef.id}`
            : String(chatModelRef);

          // 从 availableModels 中查找聊天模型
          const availableModels = getAvailableModels();
          const chatModel = availableModels.find(m => {
            const fullRef = `${m.provider}/${m.id}`;
            return fullRef === chatRefStr || m.id === chatRefStr;
          });

          if (chatModel) {
            // 找到了，用 resolveModelWithCredentials 解析凭证
            const resolved = resolveModelWithCredentials(`${chatModel.provider}/${chatModel.id}`);
            if (resolved) {
              // resolveModelWithCredentials 返回 snake_case 字段(api_key/base_url),
              // 内部变量保持 camelCase 喂给 callText。
              // model 字段是真正的模型对象(callText 用 modelObj.id 取模型名),
              // 顶层没有 id,不能直接把 resolved 当 model 传。
              modelConfig = resolved.model;
              modelId = resolved.model?.id;
              apiKey = resolved.api_key;
              baseUrl = resolved.base_url;
              api = resolved.api;
            }
          }

          // fallback：用 utility config
          if (!modelConfig) {
            const utilCfg = resolveUtilityConfig();
            if (!utilCfg?.utility) {
              return {
                content: [{
                  type: "text",
                  text: "Error: Could not resolve default model credentials",
                }],
                isError: true,
              };
            }

            modelConfig = utilCfg.utility;
            modelId = utilCfg.utility.id;
            apiKey = utilCfg.api_key;
            baseUrl = utilCfg.base_url;
            api = utilCfg.api;
          }
        }

        // 调用 callText 发送请求（不传任何 tools/skills）
        const result = await callText({
          api,
          apiKey,
          baseUrl,
          model: modelConfig,
          systemPrompt: system_prompt || "",
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          temperature,
          maxTokens: max_tokens,
          timeoutMs: timeout_ms,
          returnUsage: true,
          usageContext: {
            source: {
              subsystem: "utility",
              operation: "llm_request",
              surface: "tool",
              trigger: "agent",
            },
          },
        });

        return {
          content: [{
            type: "text",
            text: result.text,
          }],
          details: {
            model: `${modelConfig.provider || "unknown"}/${modelId}`,
            usage: result.usage,
            token_count: result.usage?.totalTokens || 0,
          },
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: `Error executing LLM request: ${err.message}`,
          }],
          isError: true,
        };
      }
    },
  };
}
