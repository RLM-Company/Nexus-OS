# Image editing with references

The existing provider route was checked with a synthetic PNG: `/images/edits` returned HTTP 200 and image bytes. Editing is activated separately with `KOSMORA_MEDIA_EDIT_ENABLED=true`; missing activation or an adapter without editing support remains unavailable.

Studio accepts up to two PNG/JPEG references. The existing image preparation path checks/decode bounds and prepares each reference to the chat attachment limit of 1 MB. The server independently validates references. A Generate/Edit click sends one request; failures never retry or fall back to generating an unrelated image.

The output is an authenticated, owner-scoped PNG. Source references remain in bounded transient service memory and are not added to media-job metadata. Ordinary chat attachments retain their existing persistence and privacy behavior. Media reservations, canonical provider counters, unknown charges, cancellation and owner deletion fences use the existing shared pipeline.

Users can prepare a completed Studio result for another edit. The image action in a chat opens Studio with the selected owned source. Both actions only prepare a reference; the next paid operation requires another explicit click. Chat editing accepts attached images with explicit instructions such as `Измени изображение: сделай фон серым`. Questions about images and instructions to change code based on a screenshot remain normal chat requests.

The current output remains PNG, square 1024×1024, low quality. Editing allows up to 120 seconds for the provider; cancellation and shutdown abort the request without claiming a refund for an unknown outcome. Restart never replays a media job.

Verification includes multipart source bytes and usage parsing, disabled activation, independent reference validation, owner-scoped assets, no stored reference payload in media metadata, failure without retry/fallback, explicit image intent, actual background chat dispatch and browser upload/reuse/deep-link flows. Browser fixtures use decodable PNGs; the initial deep-link fixture was rejected correctly by the image decoder and was replaced with a real canvas-generated PNG.

API specification consulted: https://developers.openai.com/api/reference/resources/images/methods/edit . The existing provider alias is controlled by the reseller and was verified separately; this change does not change the working model identifier or assume availability from the upstream documentation.
