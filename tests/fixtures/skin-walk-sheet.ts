import sharp from 'sharp';

/** Complete connected figures, with deliberately shifted, resized and reversed steps. */
export async function misalignedSkinSheet() {
  const cells = Array.from({ length: 16 }, (_, cell) => {
    const pose = cell % 4, scale = pose === 2 ? 1.08 : 1, shift = pose === 1 ? 28 : pose === 2 ? -24 : 0;
    const mirror = pose === 2 ? 'translate(256 0) scale(-1 1)' : '';
    return `<g transform="translate(${pose * 256} ${Math.floor(cell / 4) * 384})"><g transform="translate(${shift} ${352 * (1 - scale)}) scale(${scale})"><g transform="${mirror}">
      <circle cx="128" cy="100" r="64" fill="#eab398"/><path d="M128 36a64 64 0 0 0 0 128z" fill="#332438"/>
      <rect x="89" y="155" width="78" height="145" fill="#6752a3"/>
      <rect x="70" y="172" width="30" height="110" fill="#6752a3"/><rect x="156" y="172" width="30" height="110" fill="#6752a3"/>
      <rect x="70" y="${[234, 190, 250, 234][pose]}" width="23" height="24" fill="#ff33aa"/>
      <rect x="${[89, 83, 95, 89][pose]}" y="278" width="35" height="74" fill="#334466"/><rect x="132" y="278" width="35" height="74" fill="#334466"/>
      <rect x="136" y="80" width="23" height="20" fill="#ffee00"/>
    </g></g></g>`;
  }).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536">${cells}</svg>`)).png().toBuffer();
}
