# Reference presentation pass

The approved concept in `docs/concepts/caribbean-treasures/concept.png` is the art direction. This pass replaces the simple vector game symbols with dimensional illustrated props, adds a wooden rope-and-brass frame, makes the captain prominent at the side of the board and gives the controls a central red-and-gold spin button. The six existing symbol identities, 6×4 field, accepted lines, prices, payouts and saved rules remain unchanged.

Raster masters: six separate transparent ImageGen assets and one transparent board frame. Exported WebP assets are included in the existing immutable module inventory. Ordinary and giant symbols use the same high-resolution master. A mobile captain portrait, compact controls and the connected chat remain readable. Runtime-image budget for the reference pass: 3 MiB; masters remain in source control and are not shipped as module media.

## Feedback changes

| Event | Picture | Audio | Confirmation and interruption |
| --- | --- | --- | --- |
| Waiting for a spin | Six masked decorative reel strips move over the previous field | Gentle mechanical wood movement under music | Decorative symbols never create an outcome. Nothing is credited by the animation |
| Confirmed column stop | Strip hides and the actual server column lands with a short bounce | Low wood clack with a restrained metal accent | The shared output timestamp, 70 ms audio lookahead and 24 ms paint allowance remain the synchronization basis |
| Confirmed giant | One uninterrupted illustration opens into the exact occupied cells | Plucked low strings and a brass accent | No repeated celebration on recovery |
| Confirmed cannon | Exact old-to-new block growth, brief warm muzzle accent and fading smoke | Low cannon body, filtered air and metal resonance | One accent, no repeating screen flash. Cancel removes particles and audio tails |
| Winning combination | Winning cells outside the giant and the giant outline are emphasized; the accumulated amount counts to the confirmed total | Soft treasure-metal notes | Intermediate money remains labelled as a round total |
| Complete paid round | Neutral loss/partial/return, or a short positive flourish using W against full accepted B | Separate neutral and positive cadences | Skip shows the exact confirmed total without a request or another credit |

The revised score uses a maritime 6/8 phrase, plucked strings, bass, flute and restrained percussion. Wood, filtered air and resonant metal provide the effect palette. An owned music bus ducks under important confirmed events. Owned reverb and voices are disconnected on pause/close so old tails cannot return after resume. All output continues through the host AudioContext, master volume and mute. The music preference remains independent.

Movement amounts, sound levels, phrase tempo and a <= 50 ms scheduling target are engineering/design choices for this game. Signal measurements and scheduling tests are technical evidence. Listening comfort and physical phone/headphone/Bluetooth output must be recorded separately.

Verification uses the saved deterministic scenarios and the real host with chat. Cover reduced motion, controls at each legal preset, exact final fields, retry/reopen, skip during playback, mute, volume zero and source cleanup. Compare the resulting desktop/mobile screenshots directly with the approved reference and retain a short audio preview.
