const azureVisionService = require('./azureVisionService');
const localVisionService = require('./localVisionService');
const aiDetectionSettingsService = require('./aiDetectionSettingsService');
const huggingFaceVisionService = require('./huggingFaceVisionService');
const { isFeatureAvailable } = require('../utils/errorHandler');

class AiDetectionService {
  /**
   * 하이브리드 분석 실행
   */
  async analyze({ imageBase64, photoType = 'near' }) {
    const settings = await aiDetectionSettingsService.getSettings();
    const provider = settings.provider || (settings.mode === 'huggingface' ? 'huggingface' : 'azure');
    const azureAvailable = isFeatureAvailable('azure-ai');
    const huggingfaceAvailable = !!process.env.HUGGINGFACE_API_TOKEN;

    // 설정된 규칙을 로컬 서비스에 적용
    if (settings.rules) {
      localVisionService.setRules(settings.rules);
    } else {
      localVisionService.setRules();
    }

    const responses = [];
    let localResult = null;

    if (settings.localEnabled) {
      try {
        localResult = await localVisionService.analyze(imageBase64, {
          baseConfidence: settings.localBaseConfidence
        });
        // source는 localResult의 'local-rule'보다 뒤에 두어 최종 선택 로직과 일치시킴
        responses.push({
          ...localResult,
          source: 'local',
          success: true
        });
      } catch (error) {
        responses.push({
          source: 'local',
          success: false,
          error: error.message
        });
      }
    }

    if (provider === 'azure') {
      const shouldCallAzure =
        settings.azureEnabled &&
        (settings.mode === 'azure' ||
          (settings.mode === 'hybrid' &&
            (!localResult || localResult.confidence < settings.azureFallbackThreshold)));

      if (shouldCallAzure) {
        if (!azureAvailable) {
          responses.push({
            source: 'azure',
            success: false,
            skipped: true,
            error: 'Azure OpenAI 환경 변수가 설정되어 있지 않습니다'
          });
        } else {
          try {
            const azureAnalysis = await azureVisionService.analyzeDefect(imageBase64, photoType);

            responses.push({
              source: 'azure',
              success: true,
              analysis: azureAnalysis
            });
          } catch (error) {
            responses.push({
              source: 'azure',
              success: false,
              error: error.message
            });
          }
        }
      }
    } else if (provider === 'huggingface') {
      const shouldCallHuggingFace =
        settings.huggingfaceEnabled &&
        (settings.mode === 'huggingface' ||
          (settings.mode === 'hybrid' &&
            (!localResult || localResult.confidence < settings.azureFallbackThreshold)));

      if (shouldCallHuggingFace) {
        if (!huggingfaceAvailable) {
          responses.push({
            source: 'huggingface',
            success: false,
            skipped: true,
            error: 'HUGGINGFACE_API_TOKEN 환경 변수가 설정되어 있지 않습니다'
          });
        } else {
          try {
            const hfAnalysis = await huggingFaceVisionService.analyzeDefect(
              imageBase64,
              settings.huggingfaceModel,
              {
                task: settings.huggingfaceTask,
                prompt: settings.huggingfacePrompt,
                maxDetections: settings.maxDetections
              }
            );

            responses.push({
              source: 'huggingface',
              success: true,
              analysis: hfAnalysis
            });
          } catch (error) {
            responses.push({
              source: 'huggingface',
              success: false,
              error: error.message
            });
          }
        }
      }
    }

    return {
      mode: settings.mode,
      provider,
      responses,
      finalDetection: this._selectFinalDetection(responses, settings),
      settings
    };
  }

  /**
   * 최종 판정 선택 로직
   */
  _selectFinalDetection(responses, settings) {
    const azureResponse = responses.find((res) => res.source === 'azure' && res.success);
    const localResponse = responses.find(
      (res) => (res.source === 'local' || res.source === 'local-rule') && res.success
    );
    const hfResponse = responses.find((res) => res.source === 'huggingface' && res.success);

    if (settings.mode === 'azure' && azureResponse) {
      return { source: 'azure', ...azureResponse };
    }

    if (settings.mode === 'huggingface' && hfResponse) {
      return { source: 'huggingface', ...hfResponse };
    }

    if (settings.mode === 'local' && localResponse) {
      return { source: 'local', ...localResponse };
    }

    if (settings.mode === 'hybrid') {
      if (hfResponse && hfResponse.analysis?.detectedDefects?.length) {
        return { source: 'huggingface', ...hfResponse };
      }
      if (azureResponse && azureResponse.analysis?.detectedDefects?.length) {
        return { source: 'azure', ...azureResponse };
      }
      if (localResponse) {
        return { source: 'local', ...localResponse };
      }
      // 클라우드는 성공했지만 하자가 없으면 그 결과를 사용
      if (hfResponse) {
        return { source: 'huggingface', ...hfResponse };
      }
      if (azureResponse) {
        return { source: 'azure', ...azureResponse };
      }
    }

    // 클라우드 전용 모드라도 실패 시 로컬 결과로 폴백
    if (localResponse) {
      return { source: 'local', ...localResponse };
    }

    return {
      source: null,
      success: false,
      message: '사용 가능한 AI 분석 결과가 없습니다.'
    };
  }
}

module.exports = new AiDetectionService();
