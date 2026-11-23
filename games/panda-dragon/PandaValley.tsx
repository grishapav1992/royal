import { useId } from 'react';

interface PandaValleyProps {
  paused: boolean;
  reducedMotion: boolean;
}

const sceneUrl = '/assets/panda-dragon/valley-bg.webp';

export function PandaValley({ paused, reducedMotion }: PandaValleyProps) {
  const id = useId();
  const ref = (name: string) => `url(#${id}-${name})`;

  return (
    <div className="panda-valley" data-paused={paused || undefined} aria-hidden="true">
      {!reducedMotion && <svg className="panda-valley-motion" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <clipPath id={`${id}-falls`}>
            <path d="M611 274 631 278 639 291 646 312 665 322 668 345 672 377 669 408 677 444 678 494 652 490 646 461 645 435 632 417 635 387 632 351 625 327 624 299Z" />
            <path d="M848 499 861 506 870 518 874 540 882 561 868 558 865 539 858 526 856 512Z" />
            <path d="M1357 453 1354 472 1344 494 1337 519 1331 546 1317 541 1326 519 1330 492 1339 467Z" />
          </clipPath>
          <linearGradient id={`${id}-stream`} x2="0" y2="1" gradientUnits="objectBoundingBox">
            <stop stopColor="#fff6d9" stopOpacity="0" />
            <stop offset=".65" stopColor="#fff6d9" stopOpacity=".62" />
            <stop offset="1" stopColor="#fff6d9" stopOpacity="0" />
          </linearGradient>
          <pattern id={`${id}-water`} width="16" height="72" patternUnits="userSpaceOnUse">
            <rect x="2" y="6" width="2.5" height="52" fill={ref('stream')} />
            <rect x="8" y="29" width="3" height="31" fill={ref('stream')} />
            <rect x="13" y="43" width="1.5" height="25" fill={ref('stream')} />
          </pattern>
          <radialGradient id={`${id}-mist`}>
            <stop stopColor="#ffe3c0" stopOpacity=".56" />
            <stop offset="1" stopColor="#ffe3c0" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-branch-fade`}>
            <stop offset=".3" stopColor="white" />
            <stop offset="1" stopColor="black" />
          </radialGradient>
          <mask id={`${id}-canopy`}>
            <ellipse cx="225" cy="464" rx="151" ry="76" fill={ref('branch-fade')} />
            <ellipse cx="1469" cy="609" rx="110" ry="93" fill={ref('branch-fade')} />
          </mask>
          <path id={`${id}-petal`} d="M-5 0Q-4-4 3-3Q6-2 5 1Q1 6-5 0Z" />
          <path id={`${id}-leaf`} d="M-6 0Q0-6 6-2Q4 4-6 0Z" />
        </defs>
        <g mask={ref('canopy')}>
          <image className="panda-valley-canopy" href={sceneUrl} width="1600" height="900" />
        </g>
        <g clipPath={ref('falls')}>
          <rect className="panda-valley-water" x="604" y="195" width="765" height="380" fill={ref('water')} />
        </g>
        <g className="panda-valley-mist" fill={ref('mist')}>
          <ellipse cx="649" cy="501" rx="64" ry="22" />
          <ellipse cx="1329" cy="552" rx="69" ry="27" />
          <ellipse cx="389" cy="623" rx="108" ry="25" opacity=".55" />
          <ellipse cx="1045" cy="766" rx="175" ry="27" opacity=".45" />
        </g>
        <g className="panda-valley-petals">
          <use href={`#${id}-petal`} x="126" y="112" fill="#e99294" />
          <use href={`#${id}-leaf`} x="244" y="196" fill="#bd9159" />
          <use href={`#${id}-petal`} x="355" y="305" fill="#f3a9a7" />
          <use href={`#${id}-petal`} x="492" y="389" fill="#d97082" />
          <use href={`#${id}-petal`} x="1188" y="192" fill="#e99294" />
          <use href={`#${id}-leaf`} x="1324" y="301" fill="#c89e67" />
          <use href={`#${id}-petal`} x="1422" y="420" fill="#f3a9a7" />
          <use href={`#${id}-petal`} x="1510" y="537" fill="#d97082" />
        </g>
      </svg>}
    </div>
  );
}
