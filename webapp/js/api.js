// API client for backend integration
function resolveApiBaseUrl() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const isLocalDev =
    protocol === 'file:' ||
    !hostname ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1';

  if (isLocalDev) {
    return 'http://localhost:3000/api';
  }

  return 'https://insighti-app-new.onrender.com/api';
}

class APIClient {
  constructor() {
    this.baseURL = resolveApiBaseUrl();
    this.token = localStorage.getItem('insighti_token');
    console.log('API Base URL:', this.baseURL);
  }

  // Set authentication token
  setToken(token) {
    this.token = token;
    localStorage.setItem('insighti_token', token);
  }

  // Clear authentication token
  clearToken() {
    this.token = null;
    localStorage.removeItem('insighti_token');
  }

  // Make HTTP request
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    // Add authorization header if token exists
    if (this.token) {
      config.headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Render Free Tier Cold Start를 위해 타임아웃 증가
    const timeoutMs = options.timeoutMs || 60000; // 60초 (Cold Start 대응)
    const retries = options.retries ?? 5; // 재시도 5회

    const doFetch = async (attempt) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(url, { ...config, signal: controller.signal });
        clearTimeout(id);
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          let errorData;
          try {
            errorData = JSON.parse(text);
          } catch {
            errorData = { message: text || `HTTP ${resp.status}` };
          }
          const serverMessage = errorData.message || errorData.error || '';

          // 401/403: 서버가 준 메시지를 그대로 사용 (토큰 만료 vs 점검원 권한 등 구분)
          if (resp.status === 401 || resp.status === 403) {
            const msg = serverMessage || (resp.status === 401 ? '토큰이 만료되었습니다. 다시 로그인해주세요.' : '권한이 없습니다.');
            console.warn('⚠️', msg);
            this.clearToken();
            const isInspectorPage = /inspector\.html$/i.test(window.location.pathname || '');
            if (window.route && !isInspectorPage) {
              window.route('login');
            }
            const err = new Error(msg);
            err.status = resp.status;
            throw err;
          }

          const err = new Error(serverMessage || `HTTP ${resp.status}`);
          err.status = resp.status;
          err.details = errorData.details ?? errorData.detail;
          err.error = errorData.error;
          err.code = errorData.code;
          err.responseText = text;
          throw err;
        }
        return await resp.json();
      } catch (err) {
        clearTimeout(id);
        
        // 401/403 에러는 재시도하지 않음
        if (err.status === 401 || err.status === 403) {
          throw err;
        }
        
        const isRetryable = (!err.status || err.status >= 500) && attempt < retries;
        if (isRetryable) {
          const backoff = 500 * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, backoff));
          return doFetch(attempt + 1);
        }
        throw err;
      }
    };

    return doFetch(0);
  }

  // Authentication
  async login(complex, dong, ho, name, phone) {
    const response = await this.request('/auth/session', {
      method: 'POST',
      body: JSON.stringify({ complex, dong, ho, name, phone })
    });
    
    if (response && response.token) {
      this.setToken(response.token);
    }
    return response;
  }

  // Cases
  async getCases() {
    return await this.request('/cases');
  }

  async createCase(caseData) {
    return await this.request('/cases', {
      method: 'POST',
      body: JSON.stringify(caseData)
    });
  }

  // Defects
  async getDefects(caseId) {
    return await this.request(`/defects?case_id=${caseId}`);
  }

  /** 점검원용: 하자가 등록된 사용자(세대) 목록 */
  async getUsersWithDefects() {
    return await this.request('/defects/users');
  }

  /** 점검원용: 특정 사용자(세대)의 하자 목록 */
  async getDefectsByHousehold(householdId) {
    return await this.request(`/defects/by-household/${householdId}`);
  }

  async createDefect(defectData) {
    return await this.request('/defects', {
      method: 'POST',
      body: JSON.stringify(defectData)
    });
  }

  async updateDefect(defectId, defectData) {
    return await this.request(`/defects/${defectId}`, {
      method: 'PUT',
      body: JSON.stringify(defectData)
    });
  }

  async getDefect(defectId) {
    return await this.request(`/defects/${defectId}`);
  }

  // File upload
  async uploadPhoto(file, type = 'near', options = {}) {
    const { skipCompress = false } = options;
    let uploadFile = file;

    if (!skipCompress) {
      const compressImage = (file, maxSize = 1400, quality = 0.8) => new Promise((resolve, reject) => {
        try {
          const img = new Image();
          const url = URL.createObjectURL(file);
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
            canvas.width = Math.round(img.width * ratio);
            canvas.height = Math.round(img.height * ratio);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
              URL.revokeObjectURL(url);
              if (!blob) return reject(new Error('이미지 압축 실패'));
              const compressed = new File([blob], file.name.replace(/\.(png|jpg|jpeg|webp)$/i, '.jpg'), { type: 'image/jpeg' });
              resolve(compressed);
            }, 'image/jpeg', quality);
          };
          img.onerror = reject;
          img.src = url;
        } catch (e) { reject(e); }
      });

      uploadFile = await compressImage(file);
    }

    const formData = new FormData();
    formData.append('photo', uploadFile);

    const response = await fetch(`${this.baseURL}/upload/photo`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  }

  // Alias for uploadPhoto — 이미 클라이언트에서 압축한 파일은 재압축 생략
  async uploadImage(file, options = {}) {
    return await this.uploadPhoto(file, 'near', { skipCompress: true, ...options });
  }

  // Reports
  async getReportPreview(householdId, caseId) {
    const params = new URLSearchParams();
    if (householdId != null) params.set('household_id', householdId);
    if (caseId != null) params.set('case_id', caseId);
    const q = params.toString() ? `?${params.toString()}` : '';
    return await this.request(`/reports/preview${q}`);
  }

  async generateReport(caseId, householdId, options = {}) {
    const body = { case_id: caseId, ...options };
    if (householdId != null) body.household_id = householdId;
    return await this.request('/reports/generate', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async sendReport(caseId, phoneNumber = null, householdId = null) {
    const body = { case_id: caseId, phone_number: phoneNumber };
    if (householdId != null) body.household_id = householdId;
    return await this.request('/reports/send', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async previewReport(filename) {
    // PDF 미리보기: Blob으로 받아서 새 창에서 열기
    const url = `${this.baseURL}/reports/preview-pdf/${filename}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
      throw new Error(error.message || error.error || `HTTP ${response.status}`);
    }

    // Blob으로 변환
    const blob = await response.blob();
    
    // Blob URL 생성
    const blobUrl = window.URL.createObjectURL(blob);
    
    // 새 창에서 PDF 미리보기
    const previewWindow = window.open(blobUrl, '_blank', 'width=1000,height=800,scrollbars=yes');
    
    if (!previewWindow) {
      window.URL.revokeObjectURL(blobUrl);
      throw new Error('팝업이 차단되었습니다. 팝업 차단을 해제해주세요.');
    }
    
    // 창이 닫히면 Blob URL 해제
    const checkClosed = setInterval(() => {
      if (previewWindow.closed) {
        window.URL.revokeObjectURL(blobUrl);
        clearInterval(checkClosed);
      }
    }, 1000);
    
    return { success: true, filename };
  }

  async downloadReport(filename) {
    // PDF 다운로드는 blob으로 받아야 함
    const url = `${this.baseURL}/reports/download/${filename}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
      throw new Error(error.message || error.error || `HTTP ${response.status}`);
    }

    // Blob으로 변환
    const blob = await response.blob();
    
    // 다운로드 링크 생성
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);

    return { success: true, filename };
  }

  /** 점검원용: 점검결과 내보내기 (엑셀 + 사진 ZIP) — blob 다운로드 */
  async getInspectionExport(householdId, fallbackFilename) {
    const url = `${this.baseURL}/reports/inspection-export?household_id=${encodeURIComponent(householdId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || err.error || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    let filename = this._parseDownloadFilename(response);
    if (!filename || /^inspection-result\.zip$/i.test(filename) || filename === '점검결과.zip') {
      filename = fallbackFilename || '점검결과.zip';
    }
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    return { success: true, filename };
  }

  /** Content-Disposition / X-Filename 에서 다운로드 파일명 추출 */
  _parseDownloadFilename(response) {
    const xName = response.headers.get('X-Filename') || response.headers.get('X-Report-Filename');
    if (xName) {
      try {
        return decodeURIComponent(xName.trim());
      } catch (_) {
        return xName.trim();
      }
    }
    const disposition = response.headers.get('Content-Disposition');
    if (!disposition) return null;
    const star = disposition.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i);
    if (star) {
      try {
        return decodeURIComponent(star[1].replace(/^["']|["']$/g, '').trim());
      } catch (_) {
        return star[1].replace(/^["']|["']$/g, '').trim();
      }
    }
    const plain = disposition.match(/(?:^|;)\s*filename\s*=\s*([^;]+)/i);
    if (plain && !/filename\*/i.test(plain[0])) {
      return plain[1].replace(/^["']|["']$/g, '').trim();
    }
    return null;
  }

  // SMS
  async sendSMS(to, message) {
    return await this.request('/sms/send', {
      method: 'POST',
      body: JSON.stringify({ to, message })
    });
  }

  async getSMSStatus() {
    return await this.request('/sms/status');
  }

  async validatePhone(phone) {
    return await this.request('/sms/validate', {
      method: 'POST',
      body: JSON.stringify({ phone })
    });
  }

  // Push Notifications
  async sendPushNotification(type, data = {}) {
    const endpoint = `/push/${type}`;
    return await this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async sendTestNotification(title, body, icon) {
    return await this.request('/push/test', {
      method: 'POST',
      body: JSON.stringify({ title, body, icon })
    });
  }

  // YouTube 실시간 검색 API 메서드들
  
  // YouTube 동영상 검색
  async searchYouTubeVideos(query, maxResults = 5) {
    try {
      const response = await this.request(`/youtube/search/${encodeURIComponent(query)}?maxResults=${maxResults}`);
      return response;
    } catch (error) {
      // 에러 응답에서 상세 정보 추출
      const errorResponse = {
        success: false,
        error: error.message || 'YouTube 검색 실패',
        details: error.details || '',
        status: error.status || 500
      };
      
      // 에러를 다시 throw하여 호출자가 처리할 수 있도록 함
      const enhancedError = new Error(errorResponse.error);
      enhancedError.details = errorResponse.details;
      enhancedError.status = errorResponse.status;
      throw enhancedError;
    }
  }

  // YouTube 동영상 상세 정보 조회
  async getYouTubeVideoDetails(videoId) {
    return await this.request(`/youtube/video/${videoId}`);
  }

  // 하자 카테고리 관련 API 메서드들
  
  // 모든 하자 카테고리 목록 조회
  async getDefectCategories() {
    return await this.request('/defect-categories');
  }

  // 카테고리별 하자 목록 조회
  async getDefectCategoriesByCategory(category) {
    return await this.request(`/defect-categories/category/${category}`);
  }

  // 특정 하자 카테고리 상세 정보 조회 (동영상 포함)
  async getDefectCategoryDetail(id) {
    return await this.request(`/defect-categories/${id}`);
  }

  // 하자 카테고리 검색
  async searchDefectCategories(keyword) {
    return await this.request(`/defect-categories/search/${keyword}`);
  }

  // 하자 카테고리별 동영상 목록 조회
  async getDefectVideos(categoryId) {
    return await this.request(`/defect-categories/${categoryId}/videos`);
  }

  // AI 학습 관련 API 메서드들
  
  // AI 예측 결과 저장
  async saveAIPrediction(imagePath, predictions, photoType) {
    return await this.request('/ai-learning/predict', {
      method: 'POST',
      body: JSON.stringify({
        imagePath,
        predictions,
        photoType
      })
    });
  }

  // 사용자 피드백 전송
  async sendAIFeedback(feedbacks) {
    return await this.request('/ai-learning/feedback', {
      method: 'POST',
      body: JSON.stringify({ feedbacks })
    });
  }

  // AI 성능 통계 조회
  async getAIPerformance() {
    return await this.request('/ai-learning/performance');
  }

  // 하자별 AI 성능 분석
  async getAIPerformanceByDefect() {
    return await this.request('/ai-learning/performance-by-defect');
  }

  // 학습 데이터 조회
  async getTrainingData(limit = 100, offset = 0) {
    return await this.request(`/ai-learning/training-data?limit=${limit}&offset=${offset}`);
  }

  // 실시간 AI 감지
  async detectDefectsWithAI(imageBase64, imageType = 'jpeg') {
    return await this.request('/ai-learning/detect', {
      method: 'POST',
      body: JSON.stringify({
        imageBase64,
        imageType
      })
    });
  }

  // Azure OpenAI로 하자 이미지 분석
  async analyzeDefectWithAzureAI(imageBase64, photoType = 'near') {
    return await this.request('/azure-ai/analyze-defect', {
      method: 'POST',
      body: JSON.stringify({
        imageBase64,
        photoType
      })
    });
  }

  // Azure OpenAI 하자 상담
  async consultDefect(question, defectType = null, context = null) {
    return await this.request('/azure-ai/consult', {
      method: 'POST',
      body: JSON.stringify({
        question,
        defectType,
        context
      })
    });
  }

  // Azure OpenAI 연결 상태 확인
  async checkAzureAIStatus() {
    return await this.request('/azure-ai/status');
  }

  // 하이브리드 AI 감지 (로컬 + Azure)
  async analyzeDefectHybrid(imageBase64, photoType = 'near') {
    return await this.request('/ai-detection/detect', {
      method: 'POST',
      body: JSON.stringify({
        imageBase64,
        photoType
      })
    });
  }

  // AI 판정 설정 조회 (관리자)
  async getAIDetectionSettings() {
    return await this.request('/ai-detection/settings');
  }

  // AI 판정 설정 업데이트 (관리자)
  async updateAIDetectionSettings(settings) {
    return await this.request('/ai-detection/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  }

  // 장비점검 관련 API 메서드들 (Phase 2)
  
  // 열화상 점검 항목 생성
  async createThermalInspection(caseId, defectId, location, trade, note, result = 'normal') {
    return await this.request('/inspections/thermal', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        defectId,
        location,
        trade,
        note,
        result
      })
    });
  }
  
  async createThermalInspectionForDefect(caseId, defectId, location, trade, note, result = 'normal') {
    return await this.createThermalInspection(caseId, defectId, location, trade, note, result);
  }

  // 육안점검 항목 저장 (점검원 점검의견)
  async createVisualInspectionForDefect(caseId, defectId, note, location = '육안', trade = null) {
    return await this.request('/inspections/visual', {
      method: 'POST',
      body: JSON.stringify({ caseId, defectId, note, location, trade })
    });
  }

  // 열화상 사진 업로드 (thermal_photo 테이블, 기존 호환)
  async uploadThermalPhoto(itemId, fileUrl, caption) {
    return await this.request(`/inspections/thermal/${itemId}/photos`, {
      method: 'POST',
      body: JSON.stringify({
        file_url: fileUrl,
        caption
      })
    });
  }

  // 점검 항목 공통 사진 추가 (inspection_photo, 최대 2장, 모든 점검 타입)
  async addInspectionPhoto(itemId, fileUrl, caption, sortOrder = 0) {
    return await this.request(`/inspections/items/${itemId}/photos`, {
      method: 'POST',
      body: JSON.stringify({
        file_url: fileUrl,
        caption: caption || '',
        sort_order: sortOrder
      })
    });
  }

  // 점검 항목 사진 삭제 (교체 시 기존 사진 제거)
  async deleteInspectionPhoto(itemId, photoId) {
    return await this.request(`/inspections/items/${itemId}/photos/${photoId}`, {
      method: 'DELETE'
    });
  }

  // 공기질 측정 등록
  async createAirMeasurement(caseId, location, trade, tvoc, hcho, co2, note, result = 'normal') {
    return await this.request('/inspections/air', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        location,
        trade,
        tvoc,
        hcho,
        co2,
        note,
        result
      })
    });
  }

  // 라돈 측정 등록
  async createRadonMeasurement(caseId, location, trade, radon, unitRadon = 'Bq/m³', note, result = 'normal') {
    return await this.request('/inspections/radon', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        location,
        trade,
        radon,
        unit_radon: unitRadon,
        note,
        result
      })
    });
  }

  // 공기질 측정 등록 (하자별, processType: flush_out | bake_out)
  async createAirMeasurementForDefect(caseId, defectId, location, trade, tvoc, hcho, co2, note, result = 'normal', processType = null) {
    const body = { caseId, defectId, location, trade, tvoc, hcho, co2, note, result };
    if (processType) body.process_type = processType;
    return await this.request('/inspections/air', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async createRadonMeasurementForDefect(caseId, defectId, location, trade, radon, unitRadon = 'Bq/m³', note, result = 'normal') {
    return await this.request('/inspections/radon', {
      method: 'POST',
      body: JSON.stringify({ caseId, defectId, location, trade, radon, unit_radon: unitRadon, note, result })
    });
  }

  async createLevelMeasurementForDefect(caseId, defectId, location, trade, levelPoints, note, result = 'normal') {
    const body = { caseId, defectId, location, trade, note, result };
    if (levelPoints.reference_mm != null) body.reference_mm = levelPoints.reference_mm;
    body.point1_left_mm = levelPoints.p1_left;
    body.point1_right_mm = levelPoints.p1_right;
    body.point2_left_mm = levelPoints.p2_left;
    body.point2_right_mm = levelPoints.p2_right;
    body.point3_left_mm = levelPoints.p3_left;
    body.point3_right_mm = levelPoints.p3_right;
    body.point4_left_mm = levelPoints.p4_left;
    body.point4_right_mm = levelPoints.p4_right;
    return await this.request('/inspections/level', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async getDefectInspections(defectId) {
    return await this.request(`/inspections/defects/${defectId}`);
  }

  // 세대(household)별 점검결과 조회 — 타입별 N건
  async getInspectionsByHousehold(householdId) {
    return await this.request(`/inspections/by-household/${householdId}`);
  }

  // 세대(household)용 케이스 ID 조회 또는 생성
  async getCaseForHousehold(householdId) {
    return await this.request(`/inspections/case-for-household/${householdId}`);
  }

  async createLevelMeasurement(caseId, location, trade, leftMm, rightMm, note, result = 'normal') {
    return await this.request('/inspections/level', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        location,
        trade,
        left_mm: leftMm,
        right_mm: rightMm,
        note,
        result
      })
    });
  }

  // 케이스별 점검 항목 조회
  async getInspectionsByCase(caseId) {
    return await this.request(`/inspections/${caseId}`);
  }

  // 점검 항목 삭제
  async deleteInspection(itemId) {
    return await this.request(`/inspections/${itemId}`, {
      method: 'DELETE'
    });
  }

  // 세대별 점검결과 전체 삭제
  async deleteHouseholdInspections(householdId) {
    return await this.request(`/inspections/by-household/${householdId}`, {
      method: 'DELETE'
    });
  }

  // 점검 항목 수정 (타입별 body: location, trade, note, result + air: process_type, tvoc, hcho, co2 / radon: radon, unit_radon / level: point1_left_mm, ...)
  async updateInspectionItem(itemId, body) {
    return await this.request(`/inspections/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }
}

// Global API client instance
const api = new APIClient();
