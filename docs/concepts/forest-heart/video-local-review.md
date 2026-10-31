# Local character video review, 31 October 2026

The requested experiment combines the existing adult elf and game presentation with short generated character clips, initially using Kling. The later direction requests Seedance with the exact existing elf image as reference and movement instructions only. No production publication is authorized by this local preview.

## References and generation

The original game image is `public/assets/forest-heart/v3/elf-idle.webp`, 640 by 768 pixels, SHA-256 `180c90f9c6850bada1ce9a6a346dea4dcf4881f4325b394240f0d3defedb601b`.

Four five-second Kling 3.0 submissions completed through A6API. The first two JSON requests did not retain the image identity and are excluded from the package. Two corrected multipart `input_reference` requests retained the approved face, costume and crystal. Their reference is the original image on a blue matte, centered in a 720 by 1280 frame for extraction. The final package contains only these two reviewed clips. Full movement prompts, source and final media hashes are in `kling-v1-assets.json`.

After the user's clarification, exactly one Seedance Fast trial was submitted with the unmodified original WebP bytes as `input_reference`, a movement-only prompt, four seconds and explicit 480p/no audio. A6API returned HTTP 400, `upstream_unavailable`, parameter `seconds`, without a task identifier. No automatic retry or additional generation was submitted. This does not prove that Seedance is generally unavailable or that the image format is the cause. The Seedance result is not represented as a successful generation.

At the subsequent read-only usage check the token reported 1,392,000 used quota units. A6API's public status reports 500,000 units per USD, giving USD 2.784 recorded token usage. The amount matches the four Kling clips at the observed USD 0.1392 per second. This is the token counter, not the user's full account balance or an independent invoice audit. The key and environment file are never copied into the worktree, module or Git.

## Event specification

| Event | Video and existing presentation | Interruption |
| --- | --- | --- |
| Visible idle | Quiet loop under the existing aura and caption | Fade to the original portrait while loading or on failure |
| Fresh accepted field and flow | Crystal gesture begins on the existing accepted character pose; board and shared sound clocks stay authoritative | A newer pose can interrupt the clip; no extra game operation |
| Choice, collection, bonus or settled outcome | Existing authored pose, gesture, particles and sound | Restored sessions do not repeat a transient video |
| Rules, pause, hidden page | Playback pauses and the existing portrait is shown | Resume begins idle, without delayed result signals |
| Reduced motion | Static existing artwork, no video playback | Existing user preference remains authoritative |
| Close | Remove sources, stop decoders and release video graphics resources | Reopen loads the current module normally |

The final MP4s have 480 by 576 color and a matching alpha half in a 960 by 576 frame, 24 fps, with no audio. Idle is about 4.96 seconds; channel is five seconds. Existing board timing and result tiers are unchanged. The original mesh remains the fallback. The 180 ms transition is an artistic hypothesis.

## Verification

- Verified the production Forest Heart active pointer before work: `1.8.1-6a53ddc4805f`, manifest hash `52b7b83d7a7488aed4b7e569465ab0b1b643d68c00d22a0f48efed8f6c1908f9`. No catalogue or launch changes are part of this task.
- TypeScript and independent module build passed. RTP gate passed with 26 qualified profiles and 114 unchanged legacy modules. Three artwork and graph tests passed.
- The real Royal host with connected chat verified decoded idle and flow video, silent playback, pause/resume, the in-game reduced-motion setting, failed-media fallback, close, desktop and 390 by 844 layouts.
- Existing complete-round choice/bonus/reopen, lost-response recovery and character lifecycle scenarios passed with the same accepted amounts and no duplicate charge. The lost-response test now waits for the retry button to be enabled, so it checks the accepted response rather than racing the in-flight request.
- Runtime changes to OS reduced-motion emulation did not propagate reliably to the already-created blank iframe in the automated browser. The real in-game preference and initial reduced-motion scenarios were checked; physical devices and user preference remain unmeasured.
- Technical correctness and screenshot review do not establish subjective animation quality. Final visual preference belongs to the user.

The local preview uses its own disposable PostgreSQL cluster. It does not load the production environment or issue real player stakes. The temporary worktree and current preview build remain only while this review session is active; remove them after source and required assets are verified on GitHub and the user finishes the preview.
