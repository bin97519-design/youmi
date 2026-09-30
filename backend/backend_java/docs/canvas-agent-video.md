# Agent Video Drafts

Canvas Agent chat can return `generationType: "video"` with `draftPrompts`
and `durationSeconds`. Missing generation type remains `image` for legacy
responses. The chat endpoint only calls a language model; it never starts a
paid image or video task. Textual confirmation is not generation consent.

One video script, including its internal shot timeline, is one draft item.
Only explicitly requested alternative videos become separate items. Video
scripts are limited to 2500 characters and 4-30 seconds; unsupported durations
are blocked by the selected model's existing capability checks.

The frontend snapshots video settings separately from image settings. Each
video draft exposes model, ratio, resolution, duration, supported reference
mode, audio settings and estimated Mi cost. The language model cannot select
a different paid video model. Reference images must have been submitted in
that Agent turn and are kept with the draft.

Only the draft's confirmation button calls the existing `/api/video-tasks`
endpoint. Accepted tasks lock their draft immediately and keep their task ID
and submitted settings. Later polling failures do not reopen submission.
Uncertain submission results remain locked for manual reconciliation rather
than being retried. Reloading never creates a task automatically.

Video progress and results stay in the originating Agent conversation, with
the resulting video also added to the canvas. Existing image confirmation,
direct video chat, models, providers and billing paths remain in place.

Agent video results have a paused first-frame preview independent of the
canvas media visibility toggle, with no playback controls. Their submitted
scripts and settings are included in subsequent conversation history.
The explicit adjustment action selects one completed result, restores its
original reference images into the editable composer and carries its settings
into the next draft. Selecting it never starts a video task. This is generation
record context, not automatic frame-by-frame video analysis.

Agent image results use the same persistent preview surface. The image adjustment
action attaches the generated result first, followed by its original references,
and restores the recorded model, ratio and resolution with a single-image count.
It keeps unsent text intact. The selected result and submitted prompt are carried
in Agent history; images are only submitted after the existing confirmation action.
Cancelling the association removes only references added by that action.

Verification uses mocked model responses and mocked video tasks; it does not
submit paid provider requests.
