/**
 * plugins/image-gen/tools/generate-image.js
 *
 * Non-blocking image generation. Registers a local task immediately, then
 * submits to the provider in the background. Completion is delivered through
 * Poller + DeferredResultStore.
 */
import {
  bridgeDeliveryTarget,
  buildImageParams,
  createSubmitContext,
  createTaskId,
  imageDeferredMeta,
  normalizeSessionPath,
  resolveImageTarget,
  runSubmitInBackground,
} from "../lib/image-task-runner.js";

export const name = "generate-image";
export const description =
  "根据文字描述生成图片。非阻塞：提交后立即返回，完成后自动显示。";

export const parameters = {
  type: "object",
  properties: {
    prompt:     { type: "string", description: "图片描述（中英文均可）" },
    count:      { type: "number", description: "并发生成张数，默认 1，最大 9" },
    image:      { type: "string", description: "参考图路径（图生图）" },
    ratio:      { type: "string", description: "长宽比：1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9" },
    resolution: { type: "string", description: "分辨率：2k, 4k（默认 2k）" },
    model:      { type: "string", description: "模型 ID 或简称（如 5.0、dall-e-3）。省略时使用已配置的默认模型" },
    provider:   { type: "string", description: "指定 provider（可选）" },
  },
  required: ["prompt"],
};

export async function execute(input, ctx) {
  const { registry, store, poller } = ctx._mediaGen || {};
  if (!registry || !store || !poller) {
    return { content: [{ type: "text", text: "图片生成插件未初始化" }] };
  }

  const sessionPath = normalizeSessionPath(ctx);
  if (!sessionPath) {
    return { content: [{ type: "text", text: "图片生成需要明确的会话归属，当前工具调用缺少 sessionPath" }] };
  }

  // Build adapter context
  const submitCtx = createSubmitContext(ctx);

  // Resolve target: explicit → configured default → first credentialed media provider → legacy adapter fallback.
  let target;
  try {
    target = await resolveImageTarget(input, registry, submitCtx);
  } catch (err) {
    return { content: [{ type: "text", text: err?.message || String(err) }] };
  }
  const adapter = target?.adapter || null;
  if (!adapter) {
    return { content: [{ type: "text", text: "没有可用的图片生成 provider" }] };
  }

  const count = Math.min(Math.max(input.count || 1, 1), 9);
  const batchId = createTaskId();

  const params = {
    ...buildImageParams(input),
    providerId: target.providerId,
    ...(target.modelId ? { modelId: target.modelId, model: target.modelId } : {}),
    ...(target.protocolId ? { protocolId: target.protocolId } : {}),
    ...(target.credentialLaneId ? { credentialLaneId: target.credentialLaneId } : {}),
    ...(target.credentialProviderId ? { credentialProviderId: target.credentialProviderId } : {}),
  };

  const submitted = [];
  const deliveryTarget = bridgeDeliveryTarget(ctx);
  const deferredMeta = imageDeferredMeta({ prompt: input.prompt, deliveryTarget });

  for (let i = 0; i < count; i++) {
    const taskId = createTaskId();
    store.add({
      taskId,
      adapterId: adapter.id,
      providerId: target.providerId,
      modelId: target.modelId,
      protocolId: target.protocolId,
      credentialLaneId: target.credentialLaneId,
      batchId,
      type: "image",
      prompt: input.prompt,
      params,
      sessionPath,
      ...(deliveryTarget ? { deliveryTarget } : {}),
      submitState: "submitting",
      adapterTaskId: null,
    });

    // Register deferred notification
    try {
      await ctx.bus.request("deferred:register", {
        taskId,
        sessionPath,
        meta: deferredMeta,
      });
    } catch (err) {
      ctx.log.warn(`deferred:register failed for ${taskId}:`, err);
    }

    // Register in TaskRegistry for visibility and cancellation
    try {
      await ctx.bus.request("task:register", {
        taskId,
        type: "media-generation",
        parentSessionPath: sessionPath,
        meta: deferredMeta,
      });
    } catch {
      // TaskRegistry is best-effort visibility; generation delivery still uses deferred results.
    }

    // Add to poller (handles fake-async detection internally)
    poller.add(taskId);
    submitted.push({ taskId });

    void runSubmitInBackground({
      taskId,
      adapter,
      params,
      submitCtx,
      store,
      poller,
      ctx,
    });
  }

  const text = `已提交 ${submitted.length} 张图片生成，完成后会自动显示在下方卡片中。`;

  return {
    content: [{ type: "text", text }],
    details: {
      mediaGeneration: {
        kind: "image",
        batchId,
        prompt: input.prompt,
        tasks: submitted,
      },
    },
  };
}
