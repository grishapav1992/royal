# Flooded Temple audio

Cascade package 0.9.0 adds seven material mixes: three landing groups, two stone fractures, a relic/free-spin seal and the return to the saved base grid. Rebuild them with `node scripts/design/temple-cascade-audio.mjs`. `games/flooded-temple/cascadeSounds.json` records the main transient measured inside each cue's selected accent window, durations, peaks and RMS. All layers reuse the CC0 recordings already in the source manifest. The new seven-second `cascade-foley-preview.wav` contains these Foley cues only, without the composer's score. The existing full music master and credit remain unchanged.

Current version 0.4.0 uses licensed recordings and a cinematic score. The procedural oscillator sketches from version 0.3.0 are replaced. Rebuild the twelve stereo PCM16, 48000 Hz effect mixes with `node scripts/design/temple-audio.mjs`. Used recording excerpts and full provenance are in `games/flooded-temple/assets/audio-source/`; `sources.json` records authors, primary source pages, licenses and original input SHA-256. `sounds.json` records mix durations, designed accent offsets, peaks and RMS.

Music: 'Memories Of Stone' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au

Source and full MP3 master: https://www.scottbuckley.com.au/library/memories-of-stone/ . License: https://creativecommons.org/licenses/by/4.0/ . The master is unchanged, streamed as part of the game scene through the common output; in-game credits appear in the rules. Do not upload it to music platforms, Content ID or an independent soundtrack preview.

Effects: Kenney (Impact Sounds and RPG Audio), Joseph SARDIN (rope, splash, chimes), DenisChardonnet (chain), JaggedStone (cave ambience) and bonebrah (stone door), all CC0. The recordings are edited, layered and mixed for this game. Sources and licenses are identified in the source manifest. The 16-second reference-sound-preview contains CC0 effect mixes only, without the composer's music.

Files: `scrape`, `stone`, `step`, `chest`, `lever`, `rope`, `relic`, `neutral`, `return`, `win`, `big`, `ambience`, all `.wav`. `neutral` covers zero payouts and partial returns. `return`, `win` and `big` refer to the complete original paid stake, including free continuation. The audio owner never performs wallet operations.

The owner uses the common host AudioContext and output. It caps its live/releasing sources plus the music stream at ten, ducks its music and water for major events, fades canceled effect voices over 12 ms and stops them after 13 ms. Those timings are engineering choices. Music preserves its position across moves and mute/pause. Suspended contexts release effects immediately. Decode failures remain silent and retry on a later gesture; past cues are not queued.

The source waveforms have soft boundaries. Source peaks range from 0.04 to 0.30. Signal metrics and waveform checks do not assess subjective listening quality. Physical phone speakers, headphones and Bluetooth require a separate listening review.
