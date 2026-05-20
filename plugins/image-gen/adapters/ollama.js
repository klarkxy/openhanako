import fs from "fs";
import path from "path";
import { saveImage } from "../lib/download.js";

const FORMAT_TO_MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const RATIO_TO_SIZE = {
  "1:1": "1024x1024",
  "4:3": "1536x1024",
  "3:4": "1024x1536",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

async function responseToBuffer(imageEntry) {
  if (typeof imageEntry?.b64_json === "string" && imageEntry.b64_json) {
    return Buffer.from(imageEntry.b64_json, "base64");
  }
  if (typeof imageEntry?.url === "string" && imageEntry.url) {
    const res = await fetch(imageEntry.url);
    if (!res.ok) throw new Error(`image download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error("API returned unsupported image payload");
}

export const ollamaImageAdapter = {
  id: "ollama",
  name: "Ollama Image",
  types: ["image"],
  capabilities: {
    ratios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"],
    resolutions: [],
  },

  async checkAuth(ctx) {
    try {
      const creds = await ctx.bus.request("provider:credentials", { providerId: "ollama" });
      if (creds.error || !creds.baseUrl) {
        return { ok: false, message: creds.error || "本地 provider 未配置" };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  },

  async submit(params, ctx) {
    const creds = await ctx.bus.request("provider:credentials", { providerId: "ollama" });
    if (creds.error || !creds.baseUrl) {
      throw new Error("Provider \"ollama\" 未就绪。请检查本地服务地址与模型运行状态。");
    }

    const allDefaults = ctx.config?.get?.("providerDefaults") || {};
    const providerDefaults = allDefaults["ollama"] || {};

    const outputFormat = params.format || providerDefaults?.format || "png";
    const effectiveRatio = params.aspect_ratio || params.aspectRatio || params.ratio || providerDefaults?.aspect_ratio;
    const body = {
      model: params.model || ctx.config?.get?.("defaultImageModel")?.id || providerDefaults?.model || "local-image",
      prompt: params.prompt,
      n: 1,
      output_format: outputFormat,
    };

    if (params.size) {
      body.size = params.size;
    } else if (effectiveRatio && RATIO_TO_SIZE[effectiveRatio]) {
      body.size = RATIO_TO_SIZE[effectiveRatio];
    } else if (providerDefaults?.size) {
      body.size = providerDefaults.size;
    }

    const quality = params.quality || providerDefaults?.quality;
    if (quality) body.quality = quality;

    if (providerDefaults?.background) body.background = providerDefaults.background;

    if (params.image) {
      const images = Array.isArray(params.image) ? params.image : [params.image];
      body.image = images.map((img) => {
        if (path.isAbsolute(img) && fs.existsSync(img)) {
          const buf = fs.readFileSync(img);
          const ext = path.extname(img).slice(1).toLowerCase();
          const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext] || "image/png";
          return `data:${mime};base64,${buf.toString("base64")}`;
        }
        return img;
      });
    }

    const base = creds.baseUrl.replace(/\/+$/, "");
    const endpoint = body.image ? `${base}/images/edits` : `${base}/images/generations`;
    const headers = {
      "Content-Type": "application/json",
      ...(creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {}),
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try {
        const err = await res.json();
        if (err.error?.message) msg = `${msg}: ${err.error.message}`;
      } catch {}
      throw new Error(msg);
    }

    const data = await res.json();
    const responseImages = data.data || [];
    if (responseImages.length === 0) {
      throw new Error("API returned no images");
    }

    const mimeType = FORMAT_TO_MIME[outputFormat] || "image/png";
    const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const files = [];

    for (let i = 0; i < responseImages.length; i++) {
      const buffer = await responseToBuffer(responseImages[i]);
      const customName = params.filename
        ? (responseImages.length > 1 ? `${params.filename}-${i + 1}` : params.filename)
        : null;
      const { filename } = await saveImage(buffer, mimeType, ctx.dataDir, customName);
      files.push(filename);
    }

    return { taskId, files };
  },
};
