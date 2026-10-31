# Local character video review

## Revision 1.10: three short episodes with a standing interval

The user's feedback rejected the continuous revival and requested three three-second videos distributed over time, with a standing pose between them. The user explicitly chose three new reference generations. Three independent Kling 3.0 sources provide a small nod (`look`), a glance toward the board (`focus`), and a crystal gesture (`magic`). The final files each contain 72 frames at 24 fps, exactly three seconds and no audio. Automatic media looping and reverse playback are removed.

The attached reference is the actual game elf, flattened over black and padded to 720 by 1280 without resizing or redrawing. A pixel comparison verifies the visible reference colors in the original 640 by 768 region. Native three-second Kling 3 requests were rejected and Kling 4 had no available merchant. These rejected requests returned no task and left the usage counter unchanged. Three new five-second sources were then accepted, using the previously working format. Their complete forward gestures are timed to three seconds at 5/3 speed. This is not native three-second generation. Prompts, hashes, conversion and timing are recorded in [video-v3-assets.json](video-v3-assets.json).

The read-only token counter increased from 1,392,000 to 2,436,000 quota units. At A6API's reported 500,000 units per USD, the three new sources cost USD 2.088 and the total recorded token usage is USD 4.872. This is a token usage counter, not the full account balance or an independently audited invoice. Exactly three new accepted tasks were used; there are no automatic retries.

The runtime plays one episode, returns to the original portrait over 240 ms, and then holds a six-second standing interval before the next episode. The body has no continuous idle deformation during the interval. The normal eye blink and forest effects remain. The already playing decorative clip can finish alongside the accepted field animation, without restarting for every character pose. A new clip starts only from idle or confirmed channeling. Result, choice, flower and bonus poses are not scheduled for delayed replay. Controls and settlement do not wait for the video.

Pause, rules, hidden pages, reduced motion and close stop playback. Resume starts with a standing interval rather than catching up. File duration and frame count are checked separately from browser active-time measurements. The selected timings are artistic hypotheses for review, not human-perception thresholds. The latest package references only `video-v3`; the earlier `kling-v1` media remain in Git history.

The full-host verification checks the three clips in order, paused decoders and visible original artwork between clips, at least six seconds of active standing time, the existing accepted board animation, desktop/mobile chat, user motion preferences, failed media, complete-round recovery and unchanged accepted amounts. Full local preview recording is enabled with `FOREST_CAPTURE_VIDEO=1`. The alpha extraction preserves enclosed dark costume shadows using the original reference alpha; the final composite still needs the user's visual judgement.

| Event | Current video behavior | Interruption |
| --- | --- | --- |
| Visible idle or confirmed channel | Play the next three-second episode once, then hold the original portrait for six seconds | No per-pose restart or delayed result video |
| Accepted field while an episode is playing | The episode completes alongside the existing board animation | Controls and settlement do not wait |
| Choice, collection, bonus or settled result | Existing authored poses and feedback; no new episode starts | Already accepted financial rules remain authoritative |
| Rules, pause, hidden page or reduced motion | Stop decoders and show original artwork | Resume starts with a standing interval |
| Failed media or close | Original artwork remains available; close releases owned resources | No request to the generation service |

Final full-host checks passed on package `1.10.0-0b164ff9cb40`: all three new clips in order, accepted board animation, standing intervals, rules, reduced motion, close, mobile layout and unavailable-media fallback. Measured active episode durations were 2979.9, 2999.8 and 2999.9 ms; gaps between episode end and next start were 6283.1 and 6299.8 ms, including the portrait fade. All three decoders were paused at media time 3.0 in the final standing state. Earlier complete-round and lost-response checks passed with the same financial rules.

[Recorded full-host cycle](video-v3-preview.mp4), [desktop](video-v3-desktop.webp), [mobile](video-v3-mobile.webp), [active-time measurements](video-v3-timeline.json).

## Earlier generation and verification record

The requested experiment combines the existing adult elf and game presentation with short generated character clips, initially using Kling. The later direction requests Seedance with the exact existing elf image as reference and movement instructions only. No production publication is authorized by this local preview.

## References and generation

The original game image is `public/assets/forest-heart/v3/elf-idle.webp`, 640 by 768 pixels, SHA-256 `180c90f9c6850bada1ce9a6a346dea4dcf4881f4325b394240f0d3defedb601b`.

Four five-second Kling 3.0 submissions completed through A6API in revision 1.9. The first two JSON requests did not retain the image identity and were excluded from the package. Two corrected multipart `input_reference` requests retained the approved face, costume and crystal. Their reference was the original image on a blue matte, centered in a 720 by 1280 frame for extraction. The 1.9 package contained those two reviewed clips. Full movement prompts, source and final media hashes are in `kling-v1-assets.json`.

After the user's clarification, exactly one Seedance Fast trial was submitted with the unmodified original WebP bytes as `input_reference`, a movement-only prompt, four seconds and explicit 480p/no audio. A6API returned HTTP 400, `upstream_unavailable`, parameter `seconds`, without a task identifier. No automatic retry or additional generation was submitted. This does not prove that Seedance is generally unavailable or that the image format is the cause. The Seedance result is not represented as a successful generation.

At the subsequent read-only usage check the token reported 1,392,000 used quota units. A6API's public status reports 500,000 units per USD, giving USD 2.784 recorded token usage. The amount matches the four Kling clips at the observed USD 0.1392 per second. This is the token counter, not the user's full account balance or an independent invoice audit. The key and environment file are never copied into the worktree, module or Git.

## Historical 1.9 event specification

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
