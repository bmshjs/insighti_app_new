/**
 * 종합점검보고서_0719.pdf 템플릿 생성 테스트
 */
const path = require('path');
const { generateFinalReport0620 } = require('../utils/finalReportPdf0620Generator');

const sample = {
  complex: '테스트아파트',
  dong: '101',
  ho: '1001',
  name: '홍길동',
  phone: '010-1234-5678',
  defects: [
    {
      location: '현관',
      trade: '벽체',
      content: '벽지파손',
      memo: '흡짐오염',
      photos: [],
    },
  ],
  visual_inspections: [
    {
      location: '거실',
      trade: '천장',
      note: '균열',
      result_text: '보수필요',
      photos: [],
    },
  ],
  thermal_inspections: [
    { location: '침실1', trade: '좌측벽 하부', result_text: '이상없음', photos: [] },
  ],
  air_measurements: [
    {
      location: '침실1',
      trade: '바닥',
      result_text: '정상',
      process_type: 'flush_out',
      process_type_label: 'Flush-out',
      note: '공기질 양호',
      tvoc: 1.176,
      hcho: 0.121,
      photos: [],
    },
  ],
  radon_measurements: [{ location: '침실1', radon: 134, photos: [] }],
  level_measurements: [
    {
      location: '침실1',
      trade: '바닥',
      result_text: '정상',
      note: '수평 양호',
      point1_left_mm: 141,
      point2_left_mm: 140,
      point3_left_mm: 142,
      point4_left_mm: 143,
      photos: [],
    },
  ],
};

(async () => {
  const out = await generateFinalReport0620(sample, { filename: '_test_0719_report.pdf' });
  console.log('OK', out.path, out.size);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
