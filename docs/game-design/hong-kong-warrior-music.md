# Location music

The three locations use full instrumental recordings by Kevin MacLeod, selected to evoke different parts of older Hong Kong action cinema. This stylistic fit is a game-specific design judgement based on the composer's descriptions, not a claim that the tracks appeared in those films.

| Location | Recording | Intended character |
| --- | --- | --- |
| Tea house | [Shenyang](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600066) | Erhu, pipa and yangqin with light percussion |
| Old harbor | [Hot Pursuit](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1700084) | Guitar, percussion and strings for an action chase |
| Night market | [Eighties Action](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100243) | Driving synthesizer action in an eighties style |

The author offers these recordings under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The rules dialog supplies the track titles, author, source links, license link and modification notice. `games/jackie-chan/music-sources.json` records download URLs and source/output hashes. The complete recordings are level-normalized and encoded at 128 kbit/s. Public media files are ordinary downloadable MP3s, with no added restrictions on their licensed use.

| Event | Presentation and sound | Interruption and verification |
| --- | --- | --- |
| Open the game | The selected location starts after an allowed user gesture, using the host AudioContext and master output. Artwork and wallet loading never wait for music. | No context is created by the module. Autoplay failure can recover on a later gesture. |
| Change location | Load the selected recording and fade from the preceding track. At most two owned streams overlap during the short transition. | Rapid choices discard stale loads. No wallet operation or game restart. |
| Begin a fight | Music gain changes from 0.26 to 0.11 before the host master gain, leaving space for existing contact sounds. The song's playback rate stays at one even in fast mode. | This mixing choice and the 400 ms transition are design hypotheses, not measured perceptual thresholds. |
| Music or effects switch | Independent saved device preferences. Music can stay on with effects off and vice versa. | Global mute and zero volume pause music as well as suppressing effects. |
| Hide, suspend, close or change account | Pause on hidden/suspended context, preserving current track position for resume. Dispose streams and timers on close or account replacement. | Late play promises cannot resurrect an old location or a closed owner. Audio failure does not submit or retry a paid request. |

Acceptance uses temporary accounts and PostgreSQL in the real host with connected chat, three different tracks, master mute/zero volume/context suspension, hidden-page recovery, rapid switches, independent saved toggles, close/reopen, fight ducking and phone controls. Existing wallet/recovery, motion and impact-audio cases remain relevant. Technical playback, decoded signal measurements and subjective listening quality are separate claims. Physical phone speakers, headphones, Bluetooth and audience listening assessments are not claimed as verified by automated tests.
