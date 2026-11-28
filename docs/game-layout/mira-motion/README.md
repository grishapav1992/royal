# Mira in the room: painted frames for stage 2

The 28 frames of `public/assets/royal-bar/v3/mira-extra-28.png` were painted by a6api `gpt-image-2.6-flare` as edits of existing game frames, so the style of the work and reaction sheets holds. `generation-extra.json` in this folder lists every frame.

- `cell.mjs` cuts one cell of a source sheet, enlarges it three times and centres it on a transparent 1024 square.
- `jobs.mjs` holds the requests: in-betweens get two neighbouring frames, new poses get one frame and a change limited to the face, hand or head. It calls the local gateway (`npm run a6api -- serve`) four at a time, never retries, and saves link answers for download.
- `process.mjs` removes painted backgrounds and checkerboards, matches colour to the source cell, and places the figure by the belt line and hair top so it does not jump against its neighbours.
- `assemble.mjs` packs the processed frames into 7 by 4 cells of 310 by 318 pixels (`COLS=7`).

The scripts expect the source sheets one folder above them, as in the working folder where the frames were made. The raw answers are not kept in Git.
