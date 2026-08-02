const pool = require('../database');

const HF_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
const defaultProvider = HF_TOKEN ? 'huggingface' : 'azure';

const DEFAULT_SETTINGS = {
  mode: 'hybrid', // hybrid | azure | local | huggingface
  provider: defaultProvider, // azure | huggingface
  localEnabled: true,
  azureEnabled: defaultProvider !== 'huggingface',
  azureFallbackThreshold: 0.8,
  localBaseConfidence: 0.65,
  maxDetections: 3,
  huggingfaceEnabled: defaultProvider === 'huggingface',
  huggingfaceModel: 'microsoft/resnet-50',
  huggingfaceTask: 'image-classification', // image-classification | object-detection | image-to-text | visual-question-answering
  huggingfacePrompt:
    'Describe any visible building defects such as cracks, water leaks, mold, or safety issues in this photo.',
  updatedAt: null,
  rules: null
};

class AiDetectionSettingsService {
  constructor() {
    this.cache = null;
    this.cacheTimestamp = 0;
    this.cacheTTL = 60 * 1000; // 1분
  }

  async getSettings(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cache && now - this.cacheTimestamp < this.cacheTTL) {
      return this.cache;
    }

    // 테이블이 없으면 먼저 생성
    try {
      await this.ensureTable();
    } catch (error) {
      console.error('❌ ai_detection_settings 테이블 생성 실패:', error);
      throw new Error(`테이블 생성 실패: ${error.message}`);
    }

    let result;
    try {
      result = await pool.query(
        `SELECT mode,
                provider,
                azure_enabled AS "azureEnabled",
                local_enabled AS "localEnabled",
                azure_fallback_threshold AS "azureFallbackThreshold",
                local_base_confidence AS "localBaseConfidence",
                max_detections AS "maxDetections",
                huggingface_enabled AS "huggingfaceEnabled",
                huggingface_model AS "huggingfaceModel",
                huggingface_task AS "huggingfaceTask",
                huggingface_prompt AS "huggingfacePrompt",
                rules,
                updated_at AS "updatedAt"
         FROM ai_detection_settings
         ORDER BY id DESC
         LIMIT 1`
      );
    } catch (error) {
      console.error('❌ AI 설정 조회 쿼리 실패:', {
        code: error.code,
        message: error.message,
        constraint: error.constraint
      });
      throw error;
    }

    let settings;

    if (result.rows.length === 0) {
      settings = await this.upsertSettings(DEFAULT_SETTINGS);
    } else {
      settings = { ...DEFAULT_SETTINGS, ...result.rows[0] };

      if (
        HF_TOKEN &&
        (settings.provider !== 'huggingface' || !settings.huggingfaceEnabled)
      ) {
        settings = await this.upsertSettings({
          ...settings,
          provider: 'huggingface',
          huggingfaceEnabled: true,
          huggingfaceModel: settings.huggingfaceModel || DEFAULT_SETTINGS.huggingfaceModel,
          azureEnabled: false,
          mode: settings.mode === 'azure' ? 'hybrid' : settings.mode
        });
      }
    }

    this.cache = settings;
    this.cacheTimestamp = now;
    return settings;
  }

  async upsertSettings(newSettings = {}) {
    await this.ensureTable();
    const cleaned = Object.fromEntries(
      Object.entries(newSettings).filter(([, value]) => value !== undefined)
    );
    const settings = { ...DEFAULT_SETTINGS, ...cleaned };

    await pool.query(
      `INSERT INTO ai_detection_settings
        (id, mode, provider, azure_enabled, local_enabled, azure_fallback_threshold, local_base_confidence, max_detections, huggingface_enabled, huggingface_model, huggingface_task, huggingface_prompt, rules, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (id) DO UPDATE SET
         mode = EXCLUDED.mode,
         provider = EXCLUDED.provider,
         azure_enabled = EXCLUDED.azure_enabled,
         local_enabled = EXCLUDED.local_enabled,
         azure_fallback_threshold = EXCLUDED.azure_fallback_threshold,
         local_base_confidence = EXCLUDED.local_base_confidence,
         max_detections = EXCLUDED.max_detections,
         huggingface_enabled = EXCLUDED.huggingface_enabled,
         huggingface_model = EXCLUDED.huggingface_model,
         huggingface_task = EXCLUDED.huggingface_task,
         huggingface_prompt = EXCLUDED.huggingface_prompt,
         rules = EXCLUDED.rules,
         updated_at = NOW()`,
      [
        settings.mode,
        settings.provider,
        settings.azureEnabled,
        settings.localEnabled,
        settings.azureFallbackThreshold,
        settings.localBaseConfidence,
        settings.maxDetections,
        settings.huggingfaceEnabled,
        settings.huggingfaceModel,
        settings.huggingfaceTask,
        settings.huggingfacePrompt,
        settings.rules
      ]
    );

    this.cache = settings;
    this.cacheTimestamp = Date.now();
    return this.cache;
  }

  async ensureTable() {
    try {
      // 테이블 생성
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_detection_settings (
          id INTEGER PRIMARY KEY DEFAULT 1,
          mode TEXT NOT NULL DEFAULT 'hybrid',
          provider TEXT NOT NULL DEFAULT 'azure',
          azure_enabled BOOLEAN NOT NULL DEFAULT true,
          local_enabled BOOLEAN NOT NULL DEFAULT true,
          azure_fallback_threshold REAL NOT NULL DEFAULT 0.8,
          local_base_confidence REAL NOT NULL DEFAULT 0.65,
          max_detections INTEGER NOT NULL DEFAULT 3,
          huggingface_enabled BOOLEAN NOT NULL DEFAULT false,
          huggingface_model TEXT DEFAULT 'microsoft/resnet-50',
          huggingface_task TEXT DEFAULT 'image-classification',
          huggingface_prompt TEXT,
          rules JSONB,
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);
    } catch (error) {
      console.error('❌ ai_detection_settings 테이블 생성 실패:', error);
      throw error;
    }

    // 컬럼 추가 (안전하게 처리)
    const columnsToAdd = [
      { name: 'mode', def: `TEXT NOT NULL DEFAULT 'hybrid'` },
      { name: 'provider', def: `TEXT NOT NULL DEFAULT 'azure'` },
      { name: 'azure_enabled', def: `BOOLEAN NOT NULL DEFAULT true` },
      { name: 'local_enabled', def: `BOOLEAN NOT NULL DEFAULT true` },
      { name: 'azure_fallback_threshold', def: `REAL NOT NULL DEFAULT 0.8` },
      { name: 'local_base_confidence', def: `REAL NOT NULL DEFAULT 0.65` },
      { name: 'max_detections', def: `INTEGER NOT NULL DEFAULT 3` },
      { name: 'huggingface_enabled', def: `BOOLEAN NOT NULL DEFAULT false` },
      { name: 'huggingface_model', def: `TEXT DEFAULT 'microsoft/resnet-50'` },
      { name: 'huggingface_task', def: `TEXT DEFAULT 'image-classification'` },
      { name: 'huggingface_prompt', def: `TEXT` },
      { name: 'rules', def: `JSONB` },
      { name: 'updated_at', def: `TIMESTAMP DEFAULT NOW()` }
    ];

    for (const col of columnsToAdd) {
      try {
        // 컬럼 존재 여부 확인
        const checkResult = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'ai_detection_settings' 
          AND column_name = $1
        `, [col.name]);

        if (checkResult.rows.length === 0) {
          console.log(`➕ 컬럼 추가: ${col.name}`);
          await pool.query(`ALTER TABLE ai_detection_settings ADD COLUMN ${col.name} ${col.def};`);
        }
      } catch (error) {
        // 컬럼이 이미 존재하거나 다른 이유로 실패한 경우 무시
        if (error.code !== '42701' && !error.message.includes('already exists')) {
          console.warn(`⚠️ 컬럼 ${col.name} 추가 중 경고:`, error.message);
        }
      }
    }

    // 기본 레코드 삽입
    try {
      await pool.query(`
        INSERT INTO ai_detection_settings (id)
        VALUES (1)
        ON CONFLICT (id) DO NOTHING;
      `);
    } catch (error) {
      // 이미 존재하는 경우 무시
      if (error.code !== '23505') {
        console.warn('⚠️ 기본 레코드 삽입 경고:', error.message);
      }
    }
  }
}

module.exports = new AiDetectionSettingsService();

