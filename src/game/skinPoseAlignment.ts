/** Alignment is measured on a 32x48 thumbnail of each complete generated pose. */
export type SkinPoseAlignment = { pose: number; scale: number; x: number; y: number; mirrored: boolean };
const W = 32, H = 48, SHEET_W = W * 4;
const identity = (pose: number): SkinPoseAlignment => ({ pose, scale: 1, x: 0, y: 0, mirrored: false });

export function alignSkinWalkingPoses(pixels: Uint8ClampedArray): SkinPoseAlignment[] {
  if (pixels.length !== SHEET_W * H * 4 * 4) throw new Error('Invalid skin alignment thumbnail');
  const result = Array.from({ length: 16 }, (_, i) => identity(i % 4));
  for (let row = 0; row < 4; row++) {
    const cell = (pose: number) => {
      const data = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y++) {
        const start = ((row * H + y) * SHEET_W + pose * W) * 4;
        data.set(pixels.subarray(start, start + W * 4), y * W * 4);
      }
      return data;
    };
    const bounds = (data: Uint8ClampedArray) => {
      let left = W, top = H, right = -1, bottom = -1, count = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] >= 64) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
      }
      return { left, top, right, bottom, count };
    };
    const reference = cell(0), ref = bounds(reference);
    // Solid placeholders and incomplete downloads keep the original rendering contract.
    if (ref.count < 40 || ref.left < 1 || ref.top < 1 || ref.right >= W - 1 || ref.bottom >= H - 1) continue;
    const headBottom = Math.ceil(ref.top + (ref.bottom - ref.top) * .55);
    for (const pose of [1, 2]) {
      const candidate = cell(pose), box = bounds(candidate);
      if (box.count < 40) { result[row * 4 + pose] = identity(0); continue; }
      let best = { ...identity(pose), error: Infinity };
      for (const mirrored of [false, true]) for (const scale of [.88, .92, .96, 1, 1.04, 1.08, 1.12]) {
        const offsetY = ref.bottom - box.bottom * scale;
        for (let offsetX = -4; offsetX <= 4; offsetX += .5) {
          const left = mirrored ? W - 1 - box.right : box.left, right = mirrored ? W - 1 - box.left : box.right;
          if (16 + (left - 16) * scale + offsetX < 0 || 16 + (right - 16) * scale + offsetX >= W
            || box.top * scale + offsetY < 0) continue;
          let error = 0, count = 0;
          for (let y = Math.max(0, ref.top - 1); y <= headBottom; y++) for (let x = Math.max(0, ref.left - 2); x <= Math.min(W - 1, ref.right + 2); x++) {
            let sx = Math.round((x - 16 - offsetX) / scale + 16);
            if (mirrored) sx = W - 1 - sx;
            const sy = Math.round((y - offsetY) / scale), at = (y * W + x) * 4;
            const source = sx >= 0 && sx < W && sy >= 0 && sy < H ? (sy * W + sx) * 4 : -1;
            const alpha = reference[at + 3], otherAlpha = source < 0 ? 0 : candidate[source + 3];
            error += Math.abs(alpha - otherAlpha) * 2;
            if (source >= 0) for (let c = 0; c < 3; c++) error += Math.min(alpha, otherAlpha) / 255 * Math.abs(reference[at + c] - candidate[source + c]) / 3;
            count++;
          }
          // Prefer the unmodified drawing when differences are only raster rounding.
          error = error / (count * 765) + Math.abs(1 - scale) * .008 + Math.abs(offsetX) * .0002 + (mirrored ? .003 : 0);
          if (error < best.error) best = { pose, scale, x: offsetX, y: offsetY, mirrored, error };
        }
      }
      // A different face or view cannot be repaired by alignment. Keep a complete
      // standing figure in that slot instead of turning around or slicing the body.
      result[row * 4 + pose] = best.error <= .16 ? best : identity(0);
    }
  }
  return result;
}
