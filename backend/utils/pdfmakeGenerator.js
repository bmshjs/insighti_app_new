/**
 * PDF generation using pdfmake with Korean font support
 * pdfmake는 한글 폰트를 직접 임베드할 수 있어 한글 깨짐 문제를 완전히 해결합니다.
 */

// pdfmake 0.2.12는 src/printer.js를 main으로 사용
const PdfPrinter = require('pdfmake/src/printer').default || require('pdfmake/src/printer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class PDFMakeGenerator {
  constructor() {
    this.outputDir = path.join(__dirname, '..', 'reports');
    this.fontsDir = path.join(__dirname, '..', 'fonts');
    this.ensureDirectories();
    this.initFonts();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    if (!fs.existsSync(this.fontsDir)) {
      fs.mkdirSync(this.fontsDir, { recursive: true });
    }
  }

  initFonts() {
    // Roboto 폰트 경로 (pdfmake 기본 포함)
    const robotoPath = path.join(__dirname, '..', 'node_modules', 'pdfmake', 'build', 'fonts', 'Roboto');
    
    this.fonts = {
      Roboto: {
        normal: path.join(robotoPath, 'Roboto-Regular.ttf'),
        bold: path.join(robotoPath, 'Roboto-Medium.ttf'),
        italics: path.join(robotoPath, 'Roboto-Italic.ttf'),
        bolditalics: path.join(robotoPath, 'Roboto-MediumItalic.ttf')
      }
    };
    
    // Noto Sans KR 폰트 파일 확인
    const notoSansKRRegular = path.join(this.fontsDir, 'NotoSansKR-Regular.ttf');
    const notoSansKRBold = path.join(this.fontsDir, 'NotoSansKR-Bold.ttf');
    const notoSansKRMedium = path.join(this.fontsDir, 'NotoSansKR-Medium.ttf');

    if (fs.existsSync(notoSansKRRegular)) {
      // 한글 폰트가 있으면 추가 (pdfmake는 normal/bold/italics/bolditalics 4종 필요)
      const boldPath = fs.existsSync(notoSansKRBold) ? notoSansKRBold : notoSansKRRegular;
      this.fonts.NotoSansKR = {
        normal: notoSansKRRegular,
        bold: boldPath,
        italics: notoSansKRRegular,
        bolditalics: boldPath
      };
      this.defaultFont = 'NotoSansKR';
      console.log('✅ Noto Sans KR 폰트를 사용합니다.');
    } else {
      // 폰트 파일이 없으면 Roboto 사용 (한글 깨짐 가능)
      console.warn('⚠️ Noto Sans KR 폰트 파일이 없습니다. Roboto 폰트를 사용합니다.');
      console.warn('   한글을 제대로 표시하려면 fonts/ 디렉토리에 NotoSansKR-Regular.ttf 파일을 추가하세요.');
      this.defaultFont = 'Roboto';
    }

    this.printer = new PdfPrinter(this.fonts);
  }

  formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  buildDocumentDefinition(data) {
    const content = [];

    // 헤더 - PowerPoint 템플릿 형식
    content.push({
      text: `CM형 ${data.type || '사전점검'} 종합 보고서`,
      style: 'header',
      alignment: 'center',
      margin: [0, 0, 0, 10]
    });

    // 연락처 정보 (PowerPoint 템플릿에서 가져옴)
    content.push({
      text: [
        { text: 'Tel. ', style: 'contactText' },
        { text: '1668-5343', style: 'contactText' },
        { text: '  |  Email: ', style: 'contactText' },
        { text: 'insighteye01@naver.com', style: 'contactText' }
      ],
      style: 'subtitle',
      alignment: 'center',
      margin: [0, 0, 0, 30]
    });

    // 인사말 (PowerPoint 템플릿에서 가져옴)
    content.push({
      text: '입주자님 귀하',
      style: 'greeting',
      alignment: 'left',
      margin: [0, 0, 0, 20]
    });

    // 점검 정보 테이블 (PowerPoint 템플릿 형식)
    const metaTable = {
      table: {
        widths: ['auto', '*', 'auto', '*'],
        body: [
          [
            { text: '입 주 자 성 함', style: 'tableHeader', border: [true, true, true, true] },
            { text: `: ${data.name || ''}`, style: 'metaText', border: [false, true, true, true] },
            { text: '점검일짜', style: 'tableHeader', border: [true, true, true, true] },
            { text: `: ${this.formatDate(data.created_at)}`, style: 'metaText', border: [false, true, true, true] }
          ],
          [
            { text: '아파트명', style: 'tableHeader', border: [true, true, true, true] },
            { text: `: ${data.complex || ''}`, style: 'metaText', border: [false, true, true, true] },
            { text: '동호수', style: 'tableHeader', border: [true, true, true, true] },
            { text: `: ${data.dong || ''}동 ${data.ho || ''}호`, style: 'metaText', border: [false, true, true, true] }
          ]
        ]
      },
      margin: [0, 0, 0, 30]
    };
    content.push(metaTable);

    this._buildInspectionContent(data, content);
    this._buildCompanyAndFooter(content);
    return this._getDocumentDefinition(content);
  }

  _buildInspectionContent(data, content) {
    content.push({
      text: '점검 요약',
      style: 'sectionHeader',
      margin: [0, 0, 0, 10]
    });

    const summaryTable = {
      table: {
        widths: ['*', '*', '*', '*', '*'],
        body: [
          [
            { text: `총 하자 건수: ${data.total_defects || 0}건`, style: 'summaryText' },
            { text: `열화상 점검: ${data.total_thermal || 0}건`, style: 'summaryText' },
            { text: `공기질 측정: ${data.total_air || 0}건`, style: 'summaryText' },
            { text: `라돈 측정: ${data.total_radon || 0}건`, style: 'summaryText' },
            { text: `레벨기 측정: ${data.total_level || 0}건`, style: 'summaryText' }
          ]
        ]
      },
      margin: [0, 0, 0, 20]
    };
    content.push(summaryTable);

    // 점검 상세내용 (수치 포함)
    content.push({
      text: '점검 상세내용',
      style: 'sectionHeader',
      margin: [0, 10, 0, 10]
    });
    content.push({
      text: '아래는 하자 목록 및 장비 점검 측정값(수치) 상세입니다.',
      style: 'defectText',
      margin: [0, 0, 0, 15]
    });

    // 하자 목록 (상세)
    if (data.defects && data.defects.length > 0) {
      content.push({
        text: '하자 목록 (상세)',
        style: 'sectionHeader',
        margin: [0, 15, 0, 10]
      });

      data.defects.forEach((defect, index) => {
        content.push({
          text: `하자 #${defect.index || index + 1}`,
          style: 'defectHeader',
          margin: [0, 10, 0, 5]
        });

        const defectInfo = [
          { text: `위치: ${defect.location || ''}`, style: 'defectText' },
          { text: `공종: ${defect.trade || ''}`, style: 'defectText' },
          { text: `내용: ${defect.content || ''}`, style: 'defectText' }
        ];

        if (defect.memo) {
          defectInfo.push({ text: `메모: ${defect.memo}`, style: 'defectText' });
        }

        content.push({
          ul: defectInfo,
          margin: [20, 0, 0, 10]
        });

        // 하자 사진 추가
        if (defect.photos && defect.photos.length > 0) {
          defect.photos.forEach((photo) => {
            try {
              const urlPath = photo.url.replace(/^\//, '');
              const photoPath = path.join(__dirname, '..', urlPath);
              if (fs.existsSync(photoPath)) {
                content.push({
                  image: photoPath,
                  width: 150,
                  margin: [20, 5, 0, 5],
                  alignment: 'left'
                });
                const photoKindText = photo.kind === 'near' ? '근접 사진' : photo.kind === 'far' ? '원거리 사진' : '사진';
                content.push({ text: `[${photoKindText}]`, style: 'photoCaption', margin: [20, 0, 0, 10] });
              } else {
                console.warn(`⚠️ 사진 파일을 찾을 수 없습니다: ${photoPath}`);
              }
            } catch (error) {
              console.error(`❌ 사진 처리 오류 (하자 #${defect.index || index + 1}):`, error.message);
            }
          });
        }

        // 하자별 점검내용 (해당 하자에 등록된 inspection_item)
        const insp = defect.inspections;
        if (insp) {
          const air = insp.air || [];
          const radon = insp.radon || [];
          const level = insp.level || [];
          const thermal = insp.thermal || [];
          const hasAny = air.length || radon.length || level.length || thermal.length;
          if (hasAny) {
            content.push({ text: '점검내용 (본 하자)', style: 'defectHeader', margin: [20, 12, 0, 5] });
            if (air.length > 0) {
              air.forEach((item) => {
                const processLabel = item.process_type === 'flush_out' ? ' Flush-out' : item.process_type === 'bake_out' ? ' Bake-out' : '';
                content.push({
                  text: `공기질: ${item.location || '-'} / ${item.trade || '-'}${processLabel} — TVOC ${item.tvoc ?? '-'} ${item.unit_tvoc || ''} / HCHO ${item.hcho ?? '-'} / CO2 ${item.co2 ?? '-'} (${item.result_text || item.result || '-'})`,
                  style: 'defectText',
                  margin: [20, 0, 0, 2],
                  fontSize: 8
                });
              });
            }
            if (radon.length > 0) {
              radon.forEach((item) => {
                content.push({
                  text: `라돈: ${item.location || '-'} — ${item.radon ?? '-'} ${item.unit || ''} (${item.result_text || item.result || '-'})`,
                  style: 'defectText',
                  margin: [20, 0, 0, 2],
                  fontSize: 8
                });
              });
            }
            if (level.length > 0) {
              level.forEach((item) => {
                const has4 = item.point1_left_mm != null || item.point1_right_mm != null || item.point2_left_mm != null || item.point2_right_mm != null || item.point3_left_mm != null || item.point3_right_mm != null || item.point4_left_mm != null || item.point4_right_mm != null;
                const refMm = item.reference_mm != null ? item.reference_mm : 150;
                const levelStr = has4
                  ? `1번 좌 ${item.point1_left_mm ?? '-'}/우 ${item.point1_right_mm ?? '-'}  2번 좌 ${item.point2_left_mm ?? '-'}/우 ${item.point2_right_mm ?? '-'}  3번 좌 ${item.point3_left_mm ?? '-'}/우 ${item.point3_right_mm ?? '-'}  4번 좌 ${item.point4_left_mm ?? '-'}/우 ${item.point4_right_mm ?? '-'}  (기준 ${refMm}mm)`
                  : `좌 ${item.left_mm ?? '-'}mm / 우 ${item.right_mm ?? '-'}mm`;
                content.push({
                  text: `레벨기: ${item.location || '-'} — ${levelStr} (${item.result_text || item.result || '-'})`,
                  style: 'defectText',
                  margin: [20, 0, 0, 2],
                  fontSize: 8
                });
              });
            }
            if (thermal.length > 0) {
              thermal.forEach((item) => {
                content.push({
                  text: `열화상: ${item.location || '-'} / ${item.trade || '-'} — ${item.note || '-'} (${item.result_text || item.result || '-'})`,
                  style: 'defectText',
                  margin: [20, 0, 0, 2],
                  fontSize: 8
                });
              });
            }
            content.push({ text: '', margin: [0, 4, 0, 0] });
          }
        }
      });
    } else {
      content.push({
        text: '등록된 하자가 없습니다.',
        style: 'noDataText',
        margin: [0, 20, 0, 20]
      });
    }

    // 장비 점검 데이터 (점검 상세내용 - 수치 포함)
    if (data.has_equipment_data) {
      // 측정 수치 요약 테이블 (한눈에 보는 수치)
      const summaryRows = [
        [
          { text: '구분', style: 'tableHeader', border: [true, true, true, true] },
          { text: '위치', style: 'tableHeader', border: [true, true, true, true] },
          { text: '공종', style: 'tableHeader', border: [true, true, true, true] },
          { text: '측정 수치', style: 'tableHeader', border: [true, true, true, true] },
          { text: '결과', style: 'tableHeader', border: [true, true, true, true] }
        ]
      ];
      (data.air_measurements || []).forEach((item) => {
        const processLabel = item.process_type === 'flush_out' ? ' Flush-out' : item.process_type === 'bake_out' ? ' Bake-out' : '';
        summaryRows.push([
          { text: '공기질', style: 'metaText', border: [true, true, true, true] },
          { text: item.location || '-', style: 'metaText', border: [true, true, true, true] },
          { text: (item.trade || '-') + processLabel, style: 'metaText', border: [true, true, true, true] },
          { text: `TVOC ${item.tvoc ?? '-'} ${item.unit_tvoc || ''} / HCHO ${item.hcho ?? '-'} ${item.unit_hcho || ''} / CO2 ${item.co2 ?? '-'}`, style: 'metaText', border: [true, true, true, true], fontSize: 8 },
          { text: item.result_text || item.result || '-', style: 'metaText', border: [true, true, true, true] }
        ]);
      });
      (data.radon_measurements || []).forEach((item) => {
        summaryRows.push([
          { text: '라돈', style: 'metaText', border: [true, true, true, true] },
          { text: item.location || '-', style: 'metaText', border: [true, true, true, true] },
          { text: item.trade || '-', style: 'metaText', border: [true, true, true, true] },
          { text: `${item.radon ?? '-'} ${item.unit || ''}`, style: 'metaText', border: [true, true, true, true] },
          { text: item.result_text || item.result || '-', style: 'metaText', border: [true, true, true, true] }
        ]);
      });
      (data.level_measurements || []).forEach((item) => {
        const has4 = item.point1_left_mm != null || item.point1_right_mm != null || item.point2_left_mm != null || item.point2_right_mm != null || item.point3_left_mm != null || item.point3_right_mm != null || item.point4_left_mm != null || item.point4_right_mm != null;
        const refMm = item.reference_mm != null ? item.reference_mm : 150;
        const levelStr = has4
          ? `1번 좌${item.point1_left_mm ?? '-'}/우${item.point1_right_mm ?? '-'} 2번 좌${item.point2_left_mm ?? '-'}/우${item.point2_right_mm ?? '-'} 3번 좌${item.point3_left_mm ?? '-'}/우${item.point3_right_mm ?? '-'} 4번 좌${item.point4_left_mm ?? '-'}/우${item.point4_right_mm ?? '-'} (기준${refMm}mm)`
          : `좌 ${item.left_mm ?? '-'}mm / 우 ${item.right_mm ?? '-'}mm`;
        summaryRows.push([
          { text: '레벨기', style: 'metaText', border: [true, true, true, true] },
          { text: item.location || '-', style: 'metaText', border: [true, true, true, true] },
          { text: item.trade || '-', style: 'metaText', border: [true, true, true, true] },
          { text: levelStr, style: 'metaText', border: [true, true, true, true], fontSize: 8 },
          { text: item.result_text || item.result || '-', style: 'metaText', border: [true, true, true, true] }
        ]);
      });
      (data.thermal_inspections || []).forEach((item) => {
        summaryRows.push([
          { text: '열화상', style: 'metaText', border: [true, true, true, true] },
          { text: item.location || '-', style: 'metaText', border: [true, true, true, true] },
          { text: item.trade || '-', style: 'metaText', border: [true, true, true, true] },
          { text: item.note || '-', style: 'metaText', border: [true, true, true, true] },
          { text: item.result_text || item.result || '-', style: 'metaText', border: [true, true, true, true] }
        ]);
      });
      if (summaryRows.length > 1) {
        content.push({
          text: '측정 수치 요약',
          style: 'defectHeader',
          margin: [0, 15, 0, 8]
        });
        content.push({
          table: { widths: ['auto', '*', 'auto', '*', 'auto'], body: summaryRows },
          margin: [0, 0, 0, 15]
        });
      }

      // 공기질 측정 (상세)
      if (data.air_measurements && data.air_measurements.length > 0) {
        content.push({
          text: '공기질 측정 (상세)',
          style: 'sectionHeader',
          margin: [0, 20, 0, 10]
        });

        data.air_measurements.forEach((item, index) => {
          const title = item.serial_no ? `측정 #${index + 1} (일련번호: ${item.serial_no})` : `측정 #${index + 1}`;
          content.push({
            text: title,
            style: 'defectHeader',
            margin: [0, 10, 0, 5]
          });

          const processLabel = item.process_type === 'flush_out' ? 'Flush-out' : item.process_type === 'bake_out' ? 'Bake-out' : '-';
          const airBullets = [
            { text: `위치: ${item.location || ''}`, style: 'defectText' },
            { text: `공종: ${item.trade || ''}`, style: 'defectText' },
            { text: `공정 유형: ${processLabel}`, style: 'defectText' },
            { text: `TVOC: ${item.tvoc ?? '-'} ${item.unit_tvoc || ''}`, style: 'defectText' },
            { text: `HCHO: ${item.hcho ?? '-'} ${item.unit_hcho || ''}`, style: 'defectText' },
            { text: `CO2: ${item.co2 ?? '-'}`, style: 'defectText' },
            { text: `결과: ${item.result_text || item.result || ''}`, style: 'defectText' }
          ];
          content.push({
            ul: airBullets,
            margin: [20, 0, 0, 10]
          });
          
          // 공기질 측정 사진 추가
          if (item.photos && item.photos.length > 0) {
            item.photos.forEach((photo) => {
              try {
                const urlPath = photo.file_url.replace(/^\//, '');
                const photoPath = path.join(__dirname, '..', urlPath);
                
                if (fs.existsSync(photoPath)) {
                  content.push({
                    image: photoPath,
                    width: 150,
                    margin: [20, 5, 0, 5],
                    alignment: 'left'
                  });
                  
                  if (photo.caption) {
                    content.push({
                      text: `[${photo.caption}]`,
                      style: 'photoCaption',
                      margin: [20, 0, 0, 10]
                    });
                  }
                } else {
                  console.warn(`⚠️ 사진 파일을 찾을 수 없습니다: ${photoPath}`);
                }
              } catch (error) {
                console.error(`❌ 사진 처리 오류 (공기질 측정 #${index + 1}):`, error.message);
              }
            });
          }
        });
      }

      // 라돈 측정 (상세)
      if (data.radon_measurements && data.radon_measurements.length > 0) {
        content.push({
          text: '라돈 측정 (상세)',
          style: 'sectionHeader',
          margin: [0, 20, 0, 10]
        });

        data.radon_measurements.forEach((item, index) => {
          content.push({
            text: `측정 #${index + 1}`,
            style: 'defectHeader',
            margin: [0, 10, 0, 5]
          });

          content.push({
            ul: [
              { text: `위치: ${item.location || ''}`, style: 'defectText' },
              { text: `공종: ${item.trade || ''}`, style: 'defectText' },
              { text: `라돈: ${item.radon ?? '-'} ${item.unit || ''}`, style: 'defectText' },
              { text: `결과: ${item.result_text || item.result || ''}`, style: 'defectText' }
            ],
            margin: [20, 0, 0, 10]
          });
          
          // 라돈 측정 사진 추가
          if (item.photos && item.photos.length > 0) {
            item.photos.forEach((photo) => {
              try {
                const urlPath = photo.file_url.replace(/^\//, '');
                const photoPath = path.join(__dirname, '..', urlPath);
                
                if (fs.existsSync(photoPath)) {
                  content.push({
                    image: photoPath,
                    width: 150,
                    margin: [20, 5, 0, 5],
                    alignment: 'left'
                  });
                  
                  if (photo.caption) {
                    content.push({
                      text: `[${photo.caption}]`,
                      style: 'photoCaption',
                      margin: [20, 0, 0, 10]
                    });
                  }
                } else {
                  console.warn(`⚠️ 사진 파일을 찾을 수 없습니다: ${photoPath}`);
                }
              } catch (error) {
                console.error(`❌ 사진 처리 오류 (라돈 측정 #${index + 1}):`, error.message);
              }
            });
          }
        });
      }

      // 레벨기 측정 (상세)
      if (data.level_measurements && data.level_measurements.length > 0) {
        content.push({
          text: '레벨기 측정 (상세)',
          style: 'sectionHeader',
          margin: [0, 20, 0, 10]
        });

        data.level_measurements.forEach((item, index) => {
          const title = item.serial_no ? `측정 #${index + 1} (일련번호: ${item.serial_no})` : `측정 #${index + 1}`;
          content.push({
            text: title,
            style: 'defectHeader',
            margin: [0, 10, 0, 5]
          });

          const has4 = item.point1_left_mm != null || item.point1_right_mm != null || item.point2_left_mm != null || item.point2_right_mm != null || item.point3_left_mm != null || item.point3_right_mm != null || item.point4_left_mm != null || item.point4_right_mm != null;
          const refMm = item.reference_mm != null ? item.reference_mm : 150;
          const levelBullets = [
            { text: `위치: ${item.location || ''}`, style: 'defectText' },
            { text: `공종: ${item.trade || ''}`, style: 'defectText' },
            { text: `기준: ${refMm}mm`, style: 'defectText' }
          ];
          if (has4) {
            levelBullets.push({ text: `1번: 좌 ${item.point1_left_mm ?? '-'}mm / 우 ${item.point1_right_mm ?? '-'}mm`, style: 'defectText' });
            levelBullets.push({ text: `2번: 좌 ${item.point2_left_mm ?? '-'}mm / 우 ${item.point2_right_mm ?? '-'}mm`, style: 'defectText' });
            levelBullets.push({ text: `3번: 좌 ${item.point3_left_mm ?? '-'}mm / 우 ${item.point3_right_mm ?? '-'}mm`, style: 'defectText' });
            levelBullets.push({ text: `4번: 좌 ${item.point4_left_mm ?? '-'}mm / 우 ${item.point4_right_mm ?? '-'}mm`, style: 'defectText' });
          } else {
            levelBullets.push({ text: `좌측: ${item.left_mm ?? '-'}mm`, style: 'defectText' });
            levelBullets.push({ text: `우측: ${item.right_mm ?? '-'}mm`, style: 'defectText' });
          }
          levelBullets.push({ text: `결과: ${item.result_text || item.result || ''}`, style: 'defectText' });
          content.push({
            ul: levelBullets,
            margin: [20, 0, 0, 10]
          });
          
          // 레벨기 측정 사진 추가
          if (item.photos && item.photos.length > 0) {
            item.photos.forEach((photo) => {
              try {
                const urlPath = photo.file_url.replace(/^\//, '');
                const photoPath = path.join(__dirname, '..', urlPath);
                
                if (fs.existsSync(photoPath)) {
                  content.push({
                    image: photoPath,
                    width: 150,
                    margin: [20, 5, 0, 5],
                    alignment: 'left'
                  });
                  
                  if (photo.caption) {
                    content.push({
                      text: `[${photo.caption}]`,
                      style: 'photoCaption',
                      margin: [20, 0, 0, 10]
                    });
                  }
                } else {
                  console.warn(`⚠️ 사진 파일을 찾을 수 없습니다: ${photoPath}`);
                }
              } catch (error) {
                console.error(`❌ 사진 처리 오류 (레벨기 측정 #${index + 1}):`, error.message);
              }
            });
          }
        });
      }

      // 열화상 점검 (상세)
      if (data.thermal_inspections && data.thermal_inspections.length > 0) {
        content.push({
          text: '열화상 점검 (상세)',
          style: 'sectionHeader',
          margin: [0, 20, 0, 10]
        });

        data.thermal_inspections.forEach((item, index) => {
          content.push({
            text: `점검 #${index + 1}`,
            style: 'defectHeader',
            margin: [0, 10, 0, 5]
          });

          const thermalInfo = [
            { text: `위치: ${item.location || ''}`, style: 'defectText' },
            { text: `공종: ${item.trade || ''}`, style: 'defectText' },
            { text: `결과: ${item.result_text || item.result || ''}`, style: 'defectText' }
          ];

          if (item.note) {
            thermalInfo.push({ text: `비고: ${item.note}`, style: 'defectText' });
          }

          content.push({
            ul: thermalInfo,
            margin: [20, 0, 0, 10]
          });
          
          // 열화상 점검 사진 추가
          if (item.photos && item.photos.length > 0) {
            item.photos.forEach((photo) => {
              try {
                const urlPath = photo.file_url.replace(/^\//, '');
                const photoPath = path.join(__dirname, '..', urlPath);
                
                if (fs.existsSync(photoPath)) {
                  content.push({
                    image: photoPath,
                    width: 150,
                    margin: [20, 5, 0, 5],
                    alignment: 'left'
                  });
                  
                  if (photo.caption) {
                    content.push({
                      text: `[${photo.caption}]`,
                      style: 'photoCaption',
                      margin: [20, 0, 0, 10]
                    });
                  } else {
                    content.push({
                      text: '[열화상 사진]',
                      style: 'photoCaption',
                      margin: [20, 0, 0, 10]
                    });
                  }
                } else {
                  console.warn(`⚠️ 사진 파일을 찾을 수 없습니다: ${photoPath}`);
                }
              } catch (error) {
                console.error(`❌ 사진 처리 오류 (열화상 점검 #${index + 1}):`, error.message);
              }
            });
          }
        });
      }
    }
  }

  _buildCompanyAndFooter(content) {
    content.push({
      text: [
        { text: '인싸이트아이는 ', style: 'companyText' },
        { text: '사전점검', style: 'companyText', bold: true },
        { text: ', ', style: 'companyText' },
        { text: '시공사 하자등록', style: 'companyText', bold: true },
        { text: ', ', style: 'companyText' },
        { text: '사후점검', style: 'companyText', bold: true },
        { text: ' 단계에 이르기까지 입주자를 대신하여 최대한의 만족도 창출해 드리고 있는 ', style: 'companyText' },
        { text: 'CM형 사전점검 (Construction Management)', style: 'companyText', bold: true },
        { text: ' 전문회사입니다.', style: 'companyText' }
      ],
      style: 'companyInfo',
      alignment: 'left',
      margin: [0, 30, 0, 10]
    });
    content.push({
      text: '고객과 함께 미래를 만드는 데 중심적인 역할을 하는 기업이 되겠습니다.',
      style: 'companyVision',
      alignment: 'left',
      margin: [0, 0, 0, 10]
    });
    content.push({
      text: '고객과 함께 성장합니다 - Innovative Partner',
      style: 'companyTagline',
      alignment: 'left',
      margin: [0, 0, 0, 30]
    });
    content.push({
      text: '인싸이트아이',
      style: 'footerText',
      alignment: 'center',
      margin: [0, 30, 0, 10]
    });
  }

  _getDocumentDefinition(content) {
    return {
      content,
      defaultStyle: {
        font: this.defaultFont,
        fontSize: 10,
        lineHeight: 1.4
      },
      styles: {
        header: {
          fontSize: 24,
          bold: true,
          color: '#1a73e8'
        },
        subtitle: {
          fontSize: 10,
          color: '#666'
        },
        contactText: {
          fontSize: 9,
          color: '#666'
        },
        greeting: {
          fontSize: 14,
          bold: true,
          margin: [0, 20, 0, 10]
        },
        tableHeader: {
          fontSize: 10,
          bold: true,
          fillColor: '#f0f0f0'
        },
        sectionHeader: {
          fontSize: 16,
          bold: true,
          color: '#1a73e8'
        },
        metaText: {
          fontSize: 10
        },
        summaryText: {
          fontSize: 10
        },
        defectHeader: {
          fontSize: 12,
          bold: true
        },
        defectText: {
          fontSize: 10
        },
        noDataText: {
          fontSize: 12,
          color: '#666',
          italics: true,
          alignment: 'center'
        },
        photoCaption: {
          fontSize: 8,
          color: '#666',
          italics: true
        },
        companyText: {
          fontSize: 10,
          lineHeight: 1.6
        },
        companyInfo: {
          fontSize: 10,
          lineHeight: 1.6
        },
        companyVision: {
          fontSize: 11,
          bold: true,
          color: '#1a73e8',
          lineHeight: 1.6
        },
        companyTagline: {
          fontSize: 10,
          color: '#666',
          italics: true
        },
        footerText: {
          fontSize: 10,
          color: '#888'
        }
      },
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 60]
    };
  }

  /**
   * 점검결과 양식 PDF (인사이트아이_점검결과양식.pdf 구조)
   * 1p: 세대주 내용(빨간 점선박스), 2p~: 하자별 육안/열화상/공기질/레벨기 (각 영역 빨간 점선박스, 내용은 페이지 넘김 가능)
   */
  _redBox(content) {
    return {
      table: {
        widths: ['*'],
        body: [[
          {
            stack: Array.isArray(content) ? content : [content],
            fillColor: '#ffebee',
            border: [true, true, true, true],
            margin: [8, 8]
          }
        ]]
      },
      layout: 'noBorders',
      margin: [0, 4, 0, 8]
    };
  }

  /** 사진 URL(/uploads/xxx, uploads/xxx, http(s)://host/uploads/xxx) → 서버 내 절대 경로. 없으면 null */
  _resolvePhotoPath(url) {
    if (!url || typeof url !== 'string') return null;
    let rel = url.trim();
    const m = rel.match(/^https?:\/\/[^/]+(\/.+)$/i);
    if (m) rel = m[1];
    rel = rel.replace(/^\//, '');
    if (!rel) return null;
    const full = path.join(__dirname, '..', rel);
    if (fs.existsSync(full)) return full;
    const baseName = path.basename(rel);
    const alt = path.join(__dirname, '..', 'uploads', baseName);
    if (baseName && fs.existsSync(alt)) return alt;
    return null;
  }

  /**
   * 육안점검 블록의 왼쪽 사진 컬럼 stack 생성: 세대주 등록 사진 + 점검원 등록 사진을 한 컬럼에 모두 출력
   * @param {Array} defectPhotos - 세대주(입주자)가 등록한 사진 (photo 테이블)
   * @param {Array} inspectorVisualItems - 점검원 육안 점검 항목 배열 (각 item.photos 사용)
   */
  _buildVisualPhotoColumn(defectPhotos, inspectorVisualItems) {
    const col = [];
    // 세대주(입주자) 등록 사진
    (defectPhotos || []).forEach((photo) => {
      const photoPath = this._resolvePhotoPath(photo.url || photo.file_url || photo.thumb_url);
      if (photoPath) {
        const kindLabel = photo.kind === 'near' ? '근접' : photo.kind === 'far' ? '원거리' : '사진';
        col.push({ image: photoPath, width: 140, margin: [0, 0, 0, 2] });
        col.push({ text: `[세대주] ${kindLabel}`, fontSize: 8, color: '#666', margin: [0, 0, 0, 6] });
      }
    });
    // 점검원 등록 사진
    (inspectorVisualItems || []).forEach((v) => {
      (v.photos || []).forEach((photo, pi) => {
        const photoPath = this._resolvePhotoPath(photo.file_url || photo.url || photo.thumb_url);
        if (photoPath) {
          col.push({ image: photoPath, width: 140, margin: [0, 0, 0, 2] });
          col.push({ text: `[점검원] ${photo.caption || `사진 ${pi + 1}`}`, fontSize: 8, color: '#1565c0', margin: [0, 0, 0, 6] });
        }
      });
    });
    return col.length ? col : [{ text: '(사진 없음)', fontSize: 9, color: '#999' }];
  }

  /**
   * 점검원 육안점검 항목들을 각각 별도 블록(왼쪽 점검원 사진 + 오른쪽 점검의견)으로 content에 추가
   * @param {Array} content - pdfmake content 배열
   * @param {Array} visualItems - 점검원 육안 점검 항목 배열
   * @param {string|null} sectionTitle - 섹션 제목(있으면 헤더 출력)
   */
  _pushInspectorVisualBlocks(content, visualItems, sectionTitle) {
    const items = (visualItems || []);
    if (items.length === 0) return;
    if (sectionTitle) {
      content.push({ text: sectionTitle, style: 'defectHeader', margin: [0, 10, 0, 6] });
    }
    items.forEach((v, vi) => {
      const rightStack = [
        { text: `육안점검 (점검원)${items.length > 1 ? ` #${vi + 1}` : ''}`, fontSize: 11, bold: true, margin: [0, 0, 0, 6] },
        { text: `위치: ${v.location || '-'}`, fontSize: 10, margin: [0, 0, 0, 2] },
        { text: `공종: ${v.trade || '-'}`, fontSize: 10, margin: [0, 0, 0, 2] },
        { text: `점검의견: ${v.note || '-'}`, fontSize: 10, margin: [0, 0, 0, 2] },
        { text: `결과: ${v.result_text || v.result || '-'}`, fontSize: 10 }
      ];
      const leftCol = this._buildVisualPhotoColumn([], [v]);
      content.push(this._buildVisualBlock(leftCol, rightStack));
    });
  }

  /** 육안점검 블록(왼쪽 사진 컬럼 + 오른쪽 빨간 박스) 테이블 노드 생성 */
  _buildVisualBlock(leftCol, rightStack) {
    return {
      table: {
        widths: [160, '*'],
        body: [[
          { stack: leftCol, border: [false, false, false, false] },
          { stack: rightStack, fillColor: '#ffebee', border: [true, true, true, true], margin: [8, 8] }
        ]]
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 12]
    };
  }

  buildInspectionFormDefinition(data) {
    const content = [];
    const createdDate = data.defects && data.defects.length > 0
      ? data.defects[0].case_created_at
      : data.created_at || new Date();

    // 1p: 세대주 내용 (빨간 점선박스)
    content.push({
      text: '점검결과 양식',
      style: 'sectionHeader',
      alignment: 'center',
      margin: [0, 0, 0, 16]
    });
    content.push(this._redBox([
      { text: `세대주(입주자): ${data.name || '-'}`, fontSize: 11, margin: [0, 0, 0, 4] },
      { text: `동호수: ${data.dong || ''}동 ${data.ho || ''}호`, fontSize: 11, margin: [0, 0, 0, 4] },
      { text: `아파트명: ${data.complex || '-'}`, fontSize: 11, margin: [0, 0, 0, 4] },
      { text: `점검일: ${this.formatDate(createdDate)}`, fontSize: 11 }
    ]));

    // 세대 단위(defect_id NULL)로 저장된 점검원 육안점검 — 하자와 1:1로 묶이지 않은 점검결과
    const hh = data.household_inspections || {};
    const householdVisual = (hh.visual || []).filter((v) => !v.defect_id);

    const defects = data.defects || [];
    if (defects.length === 0) {
      // 하자는 없지만 세대 단위 점검원 육안점검이 있으면 점검원 육안점검 블록으로 출력
      if (householdVisual.length > 0) {
        this._pushInspectorVisualBlocks(content, householdVisual, '점검원 육안점검 (세대)');
      } else {
        content.push(this._redBox({ text: '등록된 하자가 없습니다.', alignment: 'center' }));
      }
      return this._getDocumentDefinition(content);
    }

    for (let di = 0; di < defects.length; di++) {
      const defect = defects[di];
      const insp = defect.inspections || {};
      const air = insp.air || [];
      const radon = insp.radon || [];
      const level = insp.level || [];
      const thermal = insp.thermal || [];
      const visualItems = insp.visual || [];

      content.push({
        text: `하자 #${di + 1}  ${defect.location || ''} / ${defect.trade || ''}`,
        style: 'defectHeader',
        margin: [0, 16, 0, 8]
      });

      // 육안점검 — 세대주 사진과 점검원 사진을 서로 다른 블록으로 분리 출력
      // 1) 세대주 육안점검 블록: 왼쪽 세대주 사진, 오른쪽 빨간박스(세대주 하자 정보)
      const ownerVisualContent = [
        { text: '육안점검 (세대주)', fontSize: 11, bold: true, margin: [0, 0, 0, 6] },
        { text: `위치: ${defect.location || '-'}`, fontSize: 10, margin: [0, 0, 0, 2] },
        { text: `공종: ${defect.trade || '-'}`, fontSize: 10, margin: [0, 0, 0, 2] },
        { text: `내용: ${defect.content || '-'}`, fontSize: 10, margin: [0, 0, 0, 2] },
        { text: `특이사항(메모): ${defect.memo || '-'}`, fontSize: 10 }
      ];
      content.push(this._buildVisualBlock(this._buildVisualPhotoColumn(defect.photos, []), ownerVisualContent));

      // 2) 점검원 육안점검 블록: 왼쪽 점검원 사진, 오른쪽 빨간박스(점검의견)
      //    세대 단위(defect_id NULL) 점검원 육안점검은 특정 하자에 묶이지 않으므로 첫 하자 다음에 함께 출력
      this._pushInspectorVisualBlocks(content, visualItems, null);
      if (di === 0 && householdVisual.length > 0) {
        this._pushInspectorVisualBlocks(content, householdVisual, null);
      }

      // 3p 스타일: 열화상점검 — 왼쪽 사진, 오른쪽 빨간박스
      const thermalPhotos = [];
      thermal.forEach((t) => {
        (t.photos || []).forEach((p) => {
          if (p && p.file_url) {
            const u = (p.file_url || '').replace(/^\//, '');
            const fp = path.join(__dirname, '..', u);
            if (fs.existsSync(fp)) thermalPhotos.push(fp);
          }
        });
      });
      const thermalTexts = thermal.map((t) => {
        const ser = t.serial_no ? ` [일련: ${t.serial_no}]` : '';
        return `위치 ${t.location || '-'} / ${t.trade || '-'}${ser} — ${t.note || '-'} (${t.result_text || t.result || '-'})`;
      }).join('\n');
      if (thermalPhotos.length > 0 || thermal.length > 0) {
        content.push({ text: '열화상점검', style: 'defectHeader', margin: [0, 10, 0, 6] });
        const leftThermal = thermalPhotos.slice(0, 3).map((fp) => ({ image: fp, width: 140, margin: [0, 0, 0, 4] }));
        const rightThermalStack = thermal.length > 0
          ? [{ text: thermalTexts, fontSize: 10 }]
          : [{ text: '열화상 점검 내용 없음', fontSize: 10, color: '#666' }];
        content.push({
          table: {
            widths: [160, '*'],
            body: [[
              { stack: leftThermal.length ? leftThermal : [{ text: '(사진 없음)', fontSize: 9, color: '#999' }], border: [false, false, false, false] },
              { stack: rightThermalStack, fillColor: '#ffebee', border: [true, true, true, true], margin: [8, 8] }
            ]]
          },
          layout: 'noBorders',
          margin: [0, 0, 0, 12]
        });
      }

      // 4~5p 스타일: 공기질측정 — 빨간박스에 측정값·점검내용 (양식: TVOC/HCHO/Radon mg/m³, Bq/m³, Flush-out/Bake-out)
      if (air.length > 0 || radon.length > 0) {
        content.push({ text: '공기질측정', style: 'defectHeader', margin: [0, 10, 0, 6] });
        air.forEach((item) => {
          const processLabel = item.process_type === 'flush_out' ? 'Flush-out' : item.process_type === 'bake_out' ? 'Bake-out' : '-';
          const ut = item.unit_tvoc || 'mg/m³';
          const uh = item.unit_hcho || 'mg/m³';
          const ser = item.serial_no ? `  [일련: ${item.serial_no}]` : '';
          content.push(this._redBox([
            { text: `위치: ${item.location || '-'}  /  공종: ${item.trade || '-'}  (${processLabel})${ser}`, fontSize: 10, margin: [0, 0, 0, 4] },
            { text: `TVOC (${ut}): ${item.tvoc ?? '-'}  /  HCHO (${uh}): ${item.hcho ?? '-'}  /  CO2 (ppm): ${item.co2 ?? '-'}`, fontSize: 10, margin: [0, 0, 0, 2] },
            { text: `메모: ${item.note || '-'}  /  결과: ${item.result_text || item.result || '-'}`, fontSize: 10 }
          ]));
        });
        radon.forEach((item) => {
          const ur = item.unit || 'Bq/m³';
          const ser = item.serial_no ? `  [일련: ${item.serial_no}]` : '';
          content.push(this._redBox([
            { text: `위치: ${item.location || '-'}  /  공종: ${item.trade || '-'}${ser}`, fontSize: 10, margin: [0, 0, 0, 4] },
            { text: `Radon (${ur}): ${item.radon ?? '-'}`, fontSize: 10, margin: [0, 0, 0, 2] },
            { text: `메모: ${item.note || '-'}  /  결과: ${item.result_text || item.result || '-'}`, fontSize: 10 }
          ]));
        });
      }

      // 6p 스타일: 레벨기 점검 — 빨간박스에 측정값·점검내용 (양식: 4 point ±10mm, mm 단위)
      if (level.length > 0) {
        content.push({ text: '레벨기 점검', style: 'defectHeader', margin: [0, 10, 0, 6] });
        level.forEach((item) => {
          const refMm = item.level_reference_mm != null ? item.level_reference_mm : (item.reference_mm != null ? item.reference_mm : 150);
          const has4 = item.point1_left_mm != null || item.point1_right_mm != null || item.point2_left_mm != null || item.point2_right_mm != null;
          const ser = item.serial_no ? `  [일련: ${item.serial_no}]` : '';
          const line1 = has4
            ? `4 point ±10mm  —  1번: ${item.point1_left_mm ?? '-'}mm / ${item.point1_right_mm ?? '-'}mm  2번: ${item.point2_left_mm ?? '-'}mm / ${item.point2_right_mm ?? '-'}mm  3번: ${item.point3_left_mm ?? '-'}mm / ${item.point3_right_mm ?? '-'}mm  4번: ${item.point4_left_mm ?? '-'}mm / ${item.point4_right_mm ?? '-'}mm  (참조 ${refMm}mm)`
            : `좌 ${item.left_mm ?? '-'}mm / 우 ${item.right_mm ?? '-'}mm`;
          content.push(this._redBox([
            { text: `위치: ${item.location || '-'}  /  공종: ${item.trade || '-'}${ser}`, fontSize: 10, margin: [0, 0, 0, 4] },
            { text: line1, fontSize: 10, margin: [0, 0, 0, 2] },
            { text: `메모: ${item.note || '-'}  /  결과: ${item.result_text || item.result || '-'}`, fontSize: 10 }
          ]));
        });
      }
    }

    return this._getDocumentDefinition(content);
  }

  async generateInspectionFormPDF(data, options = {}) {
    const filename = options.filename || `점검결과양식-${uuidv4()}.pdf`;
    const docDefinition = this.buildInspectionFormDefinition(data);
    return new Promise((resolve, reject) => {
      try {
        const pdfDoc = this.printer.createPdfKitDocument(docDefinition);
        const outputPath = path.join(this.outputDir, filename);
        const writeStream = fs.createWriteStream(outputPath);
        pdfDoc.pipe(writeStream);
        pdfDoc.end();
        writeStream.on('finish', () => {
          const size = fs.statSync(outputPath).size;
          resolve({ filename, path: outputPath, url: `/reports/${filename}`, size });
        });
        writeStream.on('error', (err) => reject(err));
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 수기보고서: 세대별 하자 리스트 (하자위치 | 공종 | 내용 | 특이사항 | 사진파일)
   */
  buildSummaryReportDefinition(data) {
    const content = [];
    content.push({
      text: '수기보고서 (점검결과 요약)',
      style: 'sectionHeader',
      alignment: 'center',
      margin: [0, 0, 0, 10]
    });
    content.push({
      text: [
        { text: '세대: ', bold: true },
        { text: `${data.dong || ''}동 ${data.ho || ''}호` },
        { text: '  |  입주자: ', bold: true },
        { text: data.name || '-' }
      ],
      fontSize: 10,
      margin: [0, 0, 0, 15]
    });
    const defects = data.defects || [];
    const headerRow = [
      { text: '하자 위치', style: 'tableHeader', fillColor: '#e5e7eb', border: [true, true, true, true] },
      { text: '공종', style: 'tableHeader', fillColor: '#374151', color: '#fff', border: [true, true, true, true] },
      { text: '내용', style: 'tableHeader', fillColor: '#374151', color: '#fff', border: [true, true, true, true] },
      { text: '특이사항', style: 'tableHeader', fillColor: '#374151', color: '#fff', border: [true, true, true, true] },
      { text: '사진파일', style: 'tableHeader', fillColor: '#374151', color: '#ef4444', border: [true, true, true, true] }
    ];
    const bodyRows = defects.map((d, idx) => {
      const photoLabels = (d.photos || []).map((p, i) => {
        const a = String(idx).padStart(4, '0');
        const b = String(i + 1).padStart(4, '0');
        return `${a},${b}`;
      });
      return [
        { text: d.location || '-', border: [true, true, true, true] },
        { text: d.trade || '-', border: [true, true, true, true] },
        { text: d.content || '-', border: [true, true, true, true] },
        { text: d.memo || '-', border: [true, true, true, true] },
        { text: photoLabels.length ? photoLabels.join(', ') : '-', color: '#ef4444', border: [true, true, true, true] }
      ];
    });
    if (bodyRows.length === 0) {
      bodyRows.push([
        { text: '등록된 하자가 없습니다.', colSpan: 5, alignment: 'center', border: [true, true, true, true] },
        {}, {}, {}, {}
      ]);
    }
    content.push({
      table: {
        widths: [60, 80, '*', 80, 70],
        body: [headerRow, ...bodyRows]
      }
    });
    content.push({ text: '\n' });
    return this._getDocumentDefinition(content);
  }

  async generateSummaryReportPDF(data, options = {}) {
    const filename = options.filename || `summary-report-${uuidv4()}.pdf`;
    const docDefinition = this.buildSummaryReportDefinition(data);
    return new Promise((resolve, reject) => {
      try {
        const pdfDoc = this.printer.createPdfKitDocument(docDefinition);
        const outputPath = path.join(this.outputDir, filename);
        const writeStream = fs.createWriteStream(outputPath);
        pdfDoc.pipe(writeStream);
        pdfDoc.end();
        writeStream.on('finish', () => {
          const size = fs.statSync(outputPath).size;
          resolve({ filename, path: outputPath, url: `/reports/${filename}`, size });
        });
        writeStream.on('error', (err) => reject(err));
      } catch (error) {
        reject(error);
      }
    });
  }

  buildInspectionResultsOnlyDefinition(data) {
    const content = [];
    content.push({
      text: '점검결과',
      style: 'sectionHeader',
      margin: [0, 0, 0, 15]
    });
    const metaTable = {
      table: {
        widths: ['auto', '*', 'auto', '*'],
        body: [
          [
            { text: '입 주 자 성 함', style: 'tableHeader', border: [true, true, true, true] },
            { text: `: ${data.name || ''}`, style: 'metaText', border: [false, true, true, true] },
            { text: '점검일짜', style: 'tableHeader', border: [true, true, true, true] },
            { text: `: ${this.formatDate(data.created_at)}`, style: 'metaText', border: [false, true, true, true] }
          ],
          [
            { text: '아파트명', style: 'tableHeader', border: [true, true, true, true] },
            { text: `: ${data.complex || ''}`, style: 'metaText', border: [false, true, true, true] },
            { text: '동호수', style: 'tableHeader', border: [true, true, true, true] },
            { text: `: ${data.dong || ''}동 ${data.ho || ''}호`, style: 'metaText', border: [false, true, true, true] }
          ]
        ]
      },
      margin: [0, 0, 0, 20]
    };
    content.push(metaTable);
    this._buildInspectionContent(data, content);
    return this._getDocumentDefinition(content);
  }

  async generateInspectionResultsPDF(data, options = {}) {
    const filename = options.filename || `inspection-results-${uuidv4()}.pdf`;
    const docDefinition = this.buildInspectionResultsOnlyDefinition(data);
    return new Promise((resolve, reject) => {
      try {
        const pdfDoc = this.printer.createPdfKitDocument(docDefinition);
        const outputPath = path.join(this.outputDir, filename);
        const writeStream = fs.createWriteStream(outputPath);
        pdfDoc.pipe(writeStream);
        pdfDoc.end();
        writeStream.on('finish', () => {
          resolve({ filename, path: outputPath });
        });
        writeStream.on('error', (err) => reject(err));
      } catch (error) {
        reject(error);
      }
    });
  }

  async generatePDF(templateName, data, options = {}) {
    const {
      filename = `report-${uuidv4()}.pdf`
    } = options;

    return new Promise((resolve, reject) => {
      try {
        // pdfmake 문서 정의 생성
        const docDefinition = this.buildDocumentDefinition(data);

        // PDF 생성
        const pdfDoc = this.printer.createPdfKitDocument(docDefinition);

        // 파일로 저장
        const outputPath = path.join(this.outputDir, filename);
        const writeStream = fs.createWriteStream(outputPath);
        
        pdfDoc.pipe(writeStream);
        pdfDoc.end();

        writeStream.on('finish', () => {
          const stats = fs.statSync(outputPath);
          resolve({
            filename,
            path: outputPath,
            url: `/reports/${filename}`,
            size: stats.size
          });
        });

        writeStream.on('error', (error) => {
          reject(new Error(`Failed to save PDF file: ${error.message}`));
        });

      } catch (error) {
        console.error('PDF generation error:', error);
        reject(new Error(`PDF generation failed: ${error.message}`));
      }
    });
  }

  getReportPath(filename) {
    return path.join(this.outputDir, filename);
  }

  getReportUrl(filename) {
    return `/reports/${filename}`;
  }

  async generateSimpleReportPDF(caseData, defects, options = {}) {
    const data = {
      complex: caseData.complex,
      dong: caseData.dong,
      ho: caseData.ho,
      name: caseData.name,
      created_at: caseData.created_at,
      defects: defects.map((defect, index) => ({
        ...defect,
        index: index + 1
      })),
      generated_at: new Date().toISOString(),
      total_defects: defects.length,
      total_thermal: 0,
      total_air: 0,
      total_radon: 0,
      total_level: 0,
      has_equipment_data: false
    };

    return await this.generatePDF('simple-report', data, options);
  }
}

module.exports = new PDFMakeGenerator();

