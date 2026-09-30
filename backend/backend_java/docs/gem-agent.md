# GEM Agent

- Adds `gem-3.8-flash` to the canvas Agent selector; the existing Agent remains the default.
- Image-generation model choices are unchanged. Product-video tasks have their own planning-model selector, independent of the chat Agent and media-generation models.
- Dedicated server environment: `GEM_AGENT_API_KEY`, `GEM_AGENT_BASE_URL` (default `https://api.lk888.ai`), `GEM_AGENT_TIMEOUT_SECONDS` (120), `GEM_AGENT_MAX_TOKENS` (8000).
- The Windows launcher refreshes these variables from the user environment. No fallback to video or other model credentials.
- `GET /api/ai/canvas-agent/models` returns labels and configuration availability only. `agentModel` is separate from the existing image `model` field on chat, planning and prompt-enhancement requests. Omitted `agentModel` preserves legacy behavior.
- Uses native Gemini `generateContent` with `contents`, `systemInstruction` and `generationConfig`. Chat/planning/JSON repair request JSON; prompt enhancement requests plain text. Existing Agent history remains included in the conversation prompt.
- Images are passed as `inlineData`, not OpenAI image URL parts. Public images and base64 images are supported; private network URLs are rejected. Original references support up to 8 images, 20MB each, matching the existing upload limit.
- Only oversized analysis payloads are compressed: inline images remain bounded to 8MB each and 12MB combined. Small references remain byte-for-byte unchanged. Larger references use temporary local analysis copies, preserving the original canvas/upload URL and stored image. They keep aspect ratio and orientation, use a white background for transparency, and reduce JPEG quality/dimensions only as needed. Analysis copies have a longest edge of at most 3072px; oversized sources above 64 million pixels are rejected before decoding.
- Large-image processing uses the existing `YOUMI_FFMPEG` / `YOUMI_FFPROBE` binaries (or tools on PATH), with local-file-only protocols, input-format restrictions, bounded process time, and temporary-file cleanup. No extra model request or automatic generation retry is introduced.
- Reads visible candidate text, excludes thought parts, and reports blocked, empty, truncated and HTTP error responses. No automatic network retry or fallback to another model.
- Model selections persist per canvas. Unconfigured GEM is visible but cannot be submitted. No new local chat pricing is introduced.
- This integrates the existing synchronous Agent workflow, not streaming output, internet-search tools, or arbitrary tool execution.

## Product-video Planning

- `/api/product-videos/capabilities` exposes `planningModels` with labels and configuration status. Each task saves `planningModel` (`default` or `gem-3.8-flash`). Legacy tasks without the field keep the original planner.
- The model applies to reference-video analysis, product analysis, storyboard/15-second/30-second planning, detail batches, and single-shot refinement. Planning calls use their own token and timeout budgets without changing normal Agent requests.
- Async planning persists the selected model in the saved request. Retrying a failed task continues with that original request and its checkpoints, rather than switching to the currently selected model. A new plan uses the current selection.
- GEM errors are preserved, and missing credentials or unknown models do not silently fall back to the default planner.

Protocol reference: https://ai.google.dev/api/generate-content

Validation uses local mocked upstream responses and isolated browser data. Live validation still requires a dedicated GEM key; no paid request is made by these tests.
