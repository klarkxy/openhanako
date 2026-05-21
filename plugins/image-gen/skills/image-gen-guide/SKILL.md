---
name: image-gen-guide
description: Required reading when using image/video generation tools. Covers tool parameters, non-blocking workflow, and task routing.
---

# Media Generation Tool Guide

## Non-Blocking Workflow

Generation is asynchronous. After submitting, the tool immediately returns a card. You **do not need to wait** and **do not need to call stage_files**. The image/video files are registered as SessionFile by the image-gen plugin when complete in the background. The card only shows task status and result references; file lifecycle is managed by StageFile.

1. Call the tool with prompt and parameters
2. **Tell the user it's generating and will appear in the card when done**
3. **Continue the conversation** — do not wait
4. When receiving `<hana-background-result>`, naturally inform the user

## Tool Parameters

### image-gen_generate-image

- `prompt` (required): Image description, Chinese or English
- `count`: Batch generation count (1-9); use when user says "generate more"
- `image`: Reference image path (for image-to-image, editing, style transfer)
- `ratio`: Aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9)
- `resolution`: Resolution (2k, 4k)
- `quality`: Image quality (low, medium, high)
- `provider`: Specify image generation provider (optional, auto-selects by default). Available providers come from Hana Provider Registry's `media.imageGeneration` capability, not inferred from chat model list.

### image-gen_generate-video

- `prompt` (required): Video description, Chinese or English
- `image`: Reference image path (image-to-video)
- `duration`: Video duration in seconds
- `ratio`: Aspect ratio
- `provider`: Specify provider (optional)

## Task Routing

| User Intent | Example | Tool | Notes |
|------------|---------|------|-------|
| Generate image from scratch | "Draw a cat" | generate-image | prompt describes the scene |
| Edit/modify image | "Remove the hat" | generate-image + image param | prompt writes edit instructions |
| Reference image to new image | "Use this style to make an icon set" | generate-image + image param | prompt explains what to reference and generate |
| Generate video | "Make a short cat video" | generate-video | prompt describes scene and motion |
| Image to video | "Make this image move" | generate-video + image param | prompt describes motion and change |
| Not a generation request | "What's in this picture?" | Don't call | Just viewing/chatting |

## Notes

- Generation consumes provider quota. Warn the user before large batches.
- Different providers support different parameters; the tool handles them based on provider media capabilities and adapters.
- Providers may come from built-in providers, plugin contributions, or CLI wrappers. Don't assume it's always a chat provider.
- Video generation is typically slower than images (tens of seconds to minutes), but likewise non-blocking.
- When text needs to appear in images, wrap the text content in **double quotes**.
