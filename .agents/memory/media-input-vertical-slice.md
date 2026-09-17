---
name: Media input vertical slice
description: The first mobile media flow processes voice and receipt media once, returns a compact reviewable result, and only then composes a secretary message.
---

Voice and receipt media must be processed once into editable text or structured receipt data before entering the secretary conversation. Receipt fields are reviewed independently before the app rebuilds the secretary draft. Raw media is not appended to conversation history, and the user still explicitly submits the resulting draft.

**Why:** This keeps follow-up turns small and preserves the existing approval boundary while provider selection, storage, hashing, and benchmark coverage are still being finalized.

**How to apply:** Keep new media integrations behind the input-asset processing boundary; do not let image/audio bytes flow through `/turns` or persistent conversation messages. Any short-lived processed-result cache must hash the full input and include tenant and user scope in its key, and concurrent requests for one key must share one provider flight.