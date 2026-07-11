/**
 * 종합점검보고서_0620.pdf 템플릿 필드 좌표 (pdf.js 추출 기준, A4 794×1123pt)
 * yPdf: PDF 좌하단 원점, 위로 증가
 */
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const BLOCKS_PER_PAGE = 4;

/** 표지 (page 1, index 0) — 하단 아파트명·동호수·입주자 성함 (전체 줄 덮기) */
const COVER = {
  complexLine: { x: 18.5, y: 185.8, wipeW: 340, wipeH: 22, size: 14 },
  donghoLine: { x: 18.5, y: 157.1, wipeW: 220, wipeH: 22, size: 14 },
  nameLine: { x: 18.1, y: 129.1, wipeW: 200, wipeH: 22, size: 14 },
};

/** 육안 점검 page 2 — 블록별 y 앵커(위치 행 baseline) */
const VISUAL_BLOCKS = [
  { location: { x: 437.2, y: 927.5 }, trade: { x: 213.6, y: 767.4 }, content: { x: 553, y: 767.4 }, note: { x: 425.3, y: 739.5 },
    photoNear: { x: 180, y: 780, w: 109, h: 130 }, photoFar: { x: 520, y: 780, w: 109, h: 130 } },
  { location: { x: 435.7, y: 688.8 }, trade: { x: 212, y: 528.7 }, content: { x: 551.4, y: 528.7 }, note: { x: 423.7, y: 500.8 },
    photoNear: { x: 180, y: 540, w: 109, h: 130 }, photoFar: { x: 520, y: 540, w: 109, h: 130 } },
  { location: { x: 434.1, y: 450.1 }, trade: { x: 210.4, y: 290 }, content: { x: 549.8, y: 290 }, note: { x: 422.1, y: 262.2 },
    photoNear: { x: 180, y: 302, w: 109, h: 130 }, photoFar: { x: 520, y: 302, w: 109, h: 130 } },
  { location: { x: 432.5, y: 211.4 }, trade: { x: 208.9, y: 51.3 }, content: { x: 548.3, y: 51.3 }, note: { x: 420.6, y: 23.5 },
    photoNear: { x: 180, y: 63, w: 109, h: 130 }, photoFar: { x: 520, y: 63, w: 109, h: 130 } },
];

/** 열화상 page 3 */
const THERMAL_BLOCKS = [
  { location: { x: 423, y: 914.5 }, locationNo: { x: 447, y: 914.5 }, trade: { x: 183.2, y: 754.7 }, result: { x: 541.9, y: 754.7 },
    photoNear: { x: 64, y: 770, w: 160, h: 120 }, photoFar: { x: 400, y: 770, w: 160, h: 120 } },
  { location: { x: 423, y: 694.2 }, locationNo: { x: 447, y: 694.2 }, trade: { x: 183.2, y: 534.5 }, result: { x: 541.9, y: 534.5 },
    photoNear: { x: 64, y: 550, w: 160, h: 120 }, photoFar: { x: 400, y: 550, w: 160, h: 120 } },
  { location: { x: 423, y: 474 }, locationNo: { x: 447, y: 474 }, trade: { x: 183.2, y: 314.2 }, result: { x: 541.9, y: 314.2 },
    photoNear: { x: 64, y: 330, w: 160, h: 120 }, photoFar: { x: 400, y: 330, w: 160, h: 120 } },
  { location: { x: 423, y: 256.5 }, locationNo: { x: 447, y: 256.5 }, trade: { x: 183.2, y: 96.8 }, result: { x: 541.9, y: 96.8 },
    photoNear: { x: 64, y: 112, w: 160, h: 120 }, photoFar: { x: 400, y: 112, w: 160, h: 120 } },
];

/** 공기질 page 4 */
const AIR_BLOCKS = [
  { location: { x: 141.3, y: 873.4 }, locationNo: { x: 165, y: 873.4 }, result: { x: 141.3, y: 843.6 },
    tvoc: { x: 539.8, y: 865.4 }, hcho: { x: 539.8, y: 829.9 }, radon: { x: 549.1, y: 794.5 },
    photo: { x: 64, y: 800, w: 120, h: 100 } },
  { location: { x: 140.4, y: 713.1 }, locationNo: { x: 164, y: 713.1 }, result: { x: 140.4, y: 683.6 },
    tvoc: { x: 539, y: 705 }, hcho: { x: 539, y: 669.5 }, radon: { x: 548.2, y: 634.1 },
    photo: { x: 64, y: 640, w: 120, h: 100 } },
  { location: { x: 139.6, y: 556.1 }, locationNo: { x: 163, y: 556.1 }, result: { x: 139.6, y: 526.7 },
    tvoc: { x: 538.1, y: 544.6 }, hcho: { x: 538.1, y: 509.2 }, radon: { x: 547.4, y: 473.7 },
    photo: { x: 64, y: 480, w: 120, h: 100 } },
  { location: { x: 138.7, y: 392.2 }, locationNo: { x: 162, y: 392.2 }, result: { x: 138.7, y: 362.7 },
    tvoc: { x: 537.3, y: 383.1 }, hcho: { x: 537.3, y: 347.6 }, radon: { x: 546.5, y: 312.2 },
    photo: { x: 64, y: 318, w: 120, h: 100 } },
  // 5th block on template (partial)
  { location: { x: 137.9, y: 228.2 }, locationNo: { x: 161, y: 228.2 }, result: { x: 137.9, y: 198.8 },
    tvoc: { x: 536.4, y: 219.3 }, hcho: { x: 536.4, y: 183.8 }, radon: { x: 545.6, y: 148.4 },
    photo: { x: 64, y: 154, w: 120, h: 100 } },
];

/** 레벨기 page 5 */
const LEVEL_BLOCKS = [
  { location: { x: 129.1, y: 892.2 }, result: { x: 129.1, y: 862.8 },
    p1: { x: 655.8, y: 891.3 }, p2: { x: 655.8, y: 861.9 }, p3: { x: 655.8, y: 833.7 }, p4: { x: 655.8, y: 805.5 },
    photo: { x: 55, y: 810, w: 120, h: 100 } },
  { location: { x: 129.1, y: 707.7 }, result: { x: 129.1, y: 678.3 },
    p1: { x: 655.8, y: 706.8 }, p2: { x: 655.8, y: 677.4 }, p3: { x: 655.8, y: 649.2 }, p4: { x: 655.8, y: 621 },
    photo: { x: 55, y: 625, w: 120, h: 100 } },
  { location: { x: 129.1, y: 523.2 }, result: { x: 129.1, y: 493.8 },
    p1: { x: 655.8, y: 522.3 }, p2: { x: 655.8, y: 492.9 }, p3: { x: 655.8, y: 464.7 }, p4: { x: 655.8, y: 436.5 },
    photo: { x: 55, y: 440, w: 120, h: 100 } },
  { location: { x: 129.1, y: 335.7 }, result: { x: 129.1, y: 306.3 },
    p1: { x: 655.8, y: 334.8 }, p2: { x: 655.8, y: 305.4 }, p3: { x: 655.8, y: 277.2 }, p4: { x: 655.8, y: 249 },
    photo: { x: 55, y: 253, w: 120, h: 100 } },
  { location: { x: 129.1, y: 148.2 }, result: { x: 129.1, y: 118.8 },
    p1: { x: 655.8, y: 147.3 }, p2: { x: 655.8, y: 117.8 }, p3: { x: 655.8, y: 89.7 }, p4: { x: 655.8, y: 61.5 },
    photo: { x: 55, y: 65, w: 120, h: 100 } },
];

const FIELD = {
  fontSize: 11,
  coverFontSize: 14,
  wipePad: 2,
  wipeColor: { r: 1, g: 1, b: 1 },
};

module.exports = {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  BLOCKS_PER_PAGE,
  COVER,
  VISUAL_BLOCKS,
  THERMAL_BLOCKS,
  AIR_BLOCKS,
  LEVEL_BLOCKS,
  FIELD,
  PAGE_INDEX: { cover: 0, visual: 1, thermal: 2, air: 3, level: 4, contact: 5 },
};
