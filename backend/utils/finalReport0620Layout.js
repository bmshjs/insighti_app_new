/**
 * 종합점검보고서_0711.pdf 템플릿 필드 좌표 (A4 794×1123pt)
 * y: PDF 좌하단 원점 기준 (사각형 bottom-left)
 *
 * 사진: 육안·열화상만. 좌/우 2칸(각 10×3.3cm), 시작 x좌표는 열화상 기준으로 통일.
 */
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const BLOCKS_PER_PAGE = 4;

const CM_TO_PT = 72 / 2.54;
/** 필드 좌측에서 3cm 들여쓰기 */
const INDENT_3CM = Math.round(3 * CM_TO_PT * 10) / 10; // 85.0

function leftIndentField(colLeft, y) {
  return { x: colLeft + INDENT_3CM, y, align: 'left' };
}
/** 슬롯 1개: 10cm × 3.3cm */
const PHOTO_SLOT_W = Math.round(10 * CM_TO_PT * 10) / 10; // 283.5
const PHOTO_SLOT_H = Math.round(3.3 * CM_TO_PT * 10) / 10; // 93.5
/** 전체 사진 영역: 20cm × 6.7cm */
const PHOTO_AREA_W = PHOTO_SLOT_W * 2; // 567
const PHOTO_AREA_H = Math.round(6.7 * CM_TO_PT * 10) / 10; // 189.9

// 육안·열화상 사진 시작 x좌표 동일 (열화상 기준)
const VISUAL_PHOTO_LEFT_X = 64.2;
const THERMAL_PHOTO_LEFT_X = 64.2;

function cmToPt(cm) {
  return Math.round(cm * CM_TO_PT * 10) / 10;
}

function dualPhotoSlots(leftX, bottomY) {
  return {
    photoNear: { x: leftX, y: bottomY, w: PHOTO_SLOT_W, h: PHOTO_SLOT_H },
    photoFar: { x: leftX + PHOTO_SLOT_W, y: bottomY, w: PHOTO_SLOT_W, h: PHOTO_SLOT_H },
  };
}

/** 육안점검 사진: 기준 대비 1번 +1cm, 2번 +4.6cm 우측 (v4.4.14 대비) */
function visualDualPhotoSlots(leftX, bottomY) {
  return {
    photoNear: { x: leftX - cmToPt(0.5) + cmToPt(1), y: bottomY, w: PHOTO_SLOT_W, h: PHOTO_SLOT_H },
    photoFar: { x: leftX + PHOTO_SLOT_W - cmToPt(2.3) + cmToPt(4.6), y: bottomY, w: PHOTO_SLOT_W, h: PHOTO_SLOT_H },
  };
}

/** 열화상점검 사진: 2번 +2cm 우측 */
function thermalDualPhotoSlots(leftX, bottomY) {
  return {
    photoNear: { x: leftX, y: bottomY, w: PHOTO_SLOT_W, h: PHOTO_SLOT_H },
    photoFar: { x: leftX + PHOTO_SLOT_W + cmToPt(2), y: bottomY, w: PHOTO_SLOT_W, h: PHOTO_SLOT_H },
  };
}

/** 표지 (page 1) */
const COVER = {
  complexLine: { x: 18.5, y: 185.8, wipeW: 340, wipeH: 22 },
  donghoLine: { x: 18.5, y: 157.1, wipeW: 220, wipeH: 22 },
  nameLine: { x: 18.1, y: 129.1, wipeW: 200, wipeH: 22 },
};

/** 육안 점검 page 2 — content(하자내용)·note(특이사항) 3cm 들여 좌측정렬, trade(공종) 라벨열 기준 3cm 들여 좌측정렬 */
const VISUAL_BLOCKS = [
  {
    location: { x: 437.2, y: 927.5 }, trade: leftIndentField(95.2, 767.4),
    content: leftIndentField(329, 767.4), note: leftIndentField(83, 739.5),
    ...visualDualPhotoSlots(VISUAL_PHOTO_LEFT_X, 806),
  },
  {
    location: { x: 435.7, y: 688.8 }, trade: leftIndentField(93.6, 528.7),
    content: leftIndentField(328, 528.7), note: leftIndentField(82, 500.8),
    ...visualDualPhotoSlots(VISUAL_PHOTO_LEFT_X, 567),
  },
  {
    location: { x: 434.1, y: 450.1 }, trade: leftIndentField(92, 290),
    content: leftIndentField(326, 290), note: leftIndentField(80, 262.2),
    ...visualDualPhotoSlots(VISUAL_PHOTO_LEFT_X, 328),
  },
  {
    location: { x: 432.5, y: 211.4 }, trade: leftIndentField(90.5, 51.3),
    content: leftIndentField(325, 51.3), note: leftIndentField(78, 23.5),
    ...visualDualPhotoSlots(VISUAL_PHOTO_LEFT_X, 89),
  },
];

/** 열화상 page 3 — result(점검내용)·trade(공종) 라벨열 기준 3cm 들여 좌측정렬 */
const THERMAL_BLOCKS = [
  {
    location: { x: 423, y: 914.5 }, locationNo: { x: 447, y: 914.5 }, trade: leftIndentField(84.1, 754.7),
    result: leftIndentField(317, 754.7),
    ...thermalDualPhotoSlots(THERMAL_PHOTO_LEFT_X, 792),
  },
  {
    location: { x: 423, y: 694.2 }, locationNo: { x: 447, y: 694.2 }, trade: leftIndentField(84.1, 534.5),
    result: leftIndentField(317, 534.5),
    ...thermalDualPhotoSlots(THERMAL_PHOTO_LEFT_X, 572),
  },
  {
    location: { x: 423, y: 474 }, locationNo: { x: 447, y: 474 }, trade: leftIndentField(84.1, 314.2),
    result: leftIndentField(317, 314.2),
    ...thermalDualPhotoSlots(THERMAL_PHOTO_LEFT_X, 352),
  },
  {
    location: { x: 423, y: 256.5 }, locationNo: { x: 447, y: 256.5 }, trade: leftIndentField(84.1, 96.8),
    result: leftIndentField(317, 96.8),
    ...thermalDualPhotoSlots(THERMAL_PHOTO_LEFT_X, 105),
  },
];

/** 공기질 page 4 — radon은 tvoc와 동일 x좌표 */
const AIR_BLOCKS = [
  {
    location: { x: 141.3, y: 873.4 }, locationNo: { x: 165, y: 873.4 }, result: { x: 141.3, y: 843.6 },
    type: { x: 141.3, y: 815 }, memo: { x: 141.3, y: 786.8 },
    tvoc: { x: 539.8, y: 865.4 }, hcho: { x: 539.8, y: 829.9 }, radon: { x: 539.8, y: 794.5 },
  },
  {
    location: { x: 140.4, y: 713.1 }, locationNo: { x: 164, y: 713.1 }, result: { x: 140.4, y: 683.6 },
    type: { x: 140.4, y: 655.5 }, memo: { x: 140.4, y: 627.3 },
    tvoc: { x: 539, y: 705 }, hcho: { x: 539, y: 669.5 }, radon: { x: 539, y: 634.1 },
  },
  {
    location: { x: 139.6, y: 556.1 }, locationNo: { x: 163, y: 556.1 }, result: { x: 139.6, y: 526.7 },
    type: { x: 139.6, y: 498.5 }, memo: { x: 139.6, y: 470.3 },
    tvoc: { x: 538.1, y: 544.6 }, hcho: { x: 538.1, y: 509.2 }, radon: { x: 538.1, y: 473.7 },
  },
  {
    location: { x: 138.7, y: 392.2 }, locationNo: { x: 162, y: 392.2 }, result: { x: 138.7, y: 362.7 },
    type: { x: 138.7, y: 334.5 }, memo: { x: 138.7, y: 306.4 },
    tvoc: { x: 537.3, y: 383.1 }, hcho: { x: 537.3, y: 347.6 }, radon: { x: 537.3, y: 312.2 },
  },
  {
    location: { x: 137.9, y: 228.2 }, locationNo: { x: 161, y: 228.2 }, result: { x: 137.9, y: 198.8 },
    type: { x: 137.9, y: 170.6 }, memo: { x: 137.9, y: 142.4 },
    tvoc: { x: 536.4, y: 219.3 }, hcho: { x: 536.4, y: 183.8 }, radon: { x: 536.4, y: 148.4 },
  },
];

/** 레벨기 page 5 — 사진 없음 */
const LEVEL_BLOCKS = [
  {
    location: { x: 129.1, y: 892.2 }, result: { x: 129.1, y: 862.8 },
    type: { x: 129.1, y: 834.6 }, memo: { x: 129.1, y: 806.4 },
    p1: { x: 655.8, y: 891.3 }, p2: { x: 655.8, y: 861.9 }, p3: { x: 655.8, y: 833.7 }, p4: { x: 655.8, y: 805.5 },
  },
  {
    location: { x: 129.1, y: 707.7 }, result: { x: 129.1, y: 678.3 },
    type: { x: 129.1, y: 650.1 }, memo: { x: 129.1, y: 621.9 },
    p1: { x: 655.8, y: 706.8 }, p2: { x: 655.8, y: 677.4 }, p3: { x: 655.8, y: 649.2 }, p4: { x: 655.8, y: 621 },
  },
  {
    location: { x: 129.1, y: 523.2 }, result: { x: 129.1, y: 493.8 },
    type: { x: 129.1, y: 465.6 }, memo: { x: 129.1, y: 437.4 },
    p1: { x: 655.8, y: 522.3 }, p2: { x: 655.8, y: 492.9 }, p3: { x: 655.8, y: 464.7 }, p4: { x: 655.8, y: 436.5 },
  },
  {
    location: { x: 129.1, y: 335.7 }, result: { x: 129.1, y: 306.3 },
    type: { x: 129.1, y: 278.1 }, memo: { x: 129.1, y: 249.9 },
    p1: { x: 655.8, y: 334.8 }, p2: { x: 655.8, y: 305.4 }, p3: { x: 655.8, y: 277.2 }, p4: { x: 655.8, y: 249 },
  },
  {
    location: { x: 129.1, y: 148.2 }, result: { x: 129.1, y: 118.8 },
    type: { x: 129.1, y: 90.6 }, memo: { x: 129.1, y: 62.4 },
    p1: { x: 655.8, y: 147.3 }, p2: { x: 655.8, y: 117.8 }, p3: { x: 655.8, y: 89.7 }, p4: { x: 655.8, y: 61.5 },
  },
];

const FIELD = {
  fontSize: 11,
  textColor: { r: 0, g: 0, b: 0 },
};

module.exports = {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  BLOCKS_PER_PAGE,
  PHOTO_SLOT_W,
  PHOTO_SLOT_H,
  PHOTO_AREA_W,
  PHOTO_AREA_H,
  COVER,
  VISUAL_BLOCKS,
  THERMAL_BLOCKS,
  AIR_BLOCKS,
  LEVEL_BLOCKS,
  FIELD,
  PAGE_INDEX: { cover: 0, visual: 1, thermal: 2, air: 3, level: 4, contact: 5 },
};
