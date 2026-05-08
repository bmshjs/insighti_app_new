
// Enhanced SPA with backend API integration
const $ = (q)=>document.querySelector(q);
const $$ = (q)=>document.querySelectorAll(q);

// Debug logging (환경변수로 제어 - 프로덕션에서 로그 최소화)
const DEBUG = window.location.hostname === 'localhost' || localStorage.getItem('DEBUG_MODE') === 'true';
const debugLog = (...args) => DEBUG && console.log(...args);
const debugError = (...args) => {
  if (DEBUG) console.error(...args);
  else console.error('[Error]', args[0]); // 프로덕션: 최소 정보만
};
const debugWarn = (...args) => DEBUG && console.warn(...args);

// XSS 방지 - HTML escape
function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 중앙화된 API 에러 핸들러
function handleAPIError(error, context = '') {
  debugError(`API Error (${context}):`, error);
  
  // 네트워크 에러
  if (error.name === 'AbortError' || error.message?.includes('timeout')) {
    toast('⏱️ 서버 응답 시간 초과. 다시 시도해 주세요.', 'error');
    return;
  }
  
  if (!navigator.onLine) {
    toast('🌐 인터넷 연결을 확인해 주세요.', 'error');
    return;
  }
  
  // HTTP 상태 코드별 처리
  if (error.status === 401 || error.status === 403) {
    toast('🔐 로그인이 만료되었습니다. 다시 로그인해 주세요.', 'warning');
    setTimeout(() => {
      logout();
    }, 1500);
    return;
  }
  
  if (error.status === 404) {
    toast('❌ 요청한 데이터를 찾을 수 없습니다.', 'error');
    return;
  }
  
  if (error.status === 500) {
    toast('⚠️ 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    return;
  }
  
  if (error.status >= 500) {
    toast('⚠️ 서버가 일시적으로 사용 불가능합니다.', 'error');
    return;
  }
  
  // 기타 에러
  const errorMsg = error.message || '알 수 없는 오류가 발생했습니다.';
  toast(`❌ ${errorMsg}`, 'error');
}

// AppState for global state management
const AppState = {
  _session: null,
  currentCaseId: null,
  photoNearKey: null,
  photoFarKey: null,
  get session() {
    return this._session;
  },
  set session(newSession) {
    this._session = newSession;
    if (newSession && newSession.token) {
      api.setToken(newSession.token);
      localStorage.setItem('insighti_session', JSON.stringify(newSession));
    } else {
      api.clearToken();
      localStorage.removeItem('insighti_session');
    }
  },
  get token() {
    return localStorage.getItem('insighti_token');
  }
};

// Loading state management
let isLoading = false;

function setLoading(loading) {
  isLoading = loading;
  const buttons = $$('.button');
  buttons.forEach(btn => {
    btn.disabled = loading;
    if (loading) {
      btn.style.opacity = '0.6';
    } else {
      btn.style.opacity = '1';
    }
  });
}

function toast(msg, type = 'info') {
  const t = $('.toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

// showError는 handleAPIError로 통합되어 제거됨 (위 참조)

// 네비게이션 히스토리
const navigationHistory = [];

function route(screen){
  // 히스토리 추가
  const currentScreen = Array.from($$('.screen')).find(el => !el.classList.contains('hidden'))?.id;
  
  if (currentScreen && currentScreen !== screen && screen !== 'login') {
    navigationHistory.push(currentScreen);
    // 히스토리 최대 10개까지만 유지
    if (navigationHistory.length > 10) {
      navigationHistory.shift();
    }
  }
  
  $$('.screen').forEach(el=>el.classList.add('hidden'));
  $(`#${screen}`).classList.remove('hidden');
  // tab highlight
  $$('.tabbar button').forEach(b=>b.classList.remove('active'));
  if(screen==='list') $('#tab-list').classList.add('active');
  if(screen==='newdefect') $('#tab-add').classList.add('active');
  
  // 사용자 메뉴 닫기
  closeUserMenu();
  
  // 하자 등록 화면 진입 시 고객 정보 표시 (케이스는 goToNewDefect에서 확보)
  if (screen === 'newdefect') {
    if (AppState.session) {
      const { dong, ho, name } = AppState.session;
      const detailsEl = $('#customer-details');
      if (detailsEl) detailsEl.textContent = `${dong}동 ${ho}호 ${name}`;
    }
    if ($('#defect-category').children.length <= 1) {
      loadDefectCategories();
    }
  }
}

// 사용자 메뉴 토글
function toggleUserMenu() {
  const menu = $('#user-menu');
  if (menu) {
    menu.classList.toggle('hidden');
  }
}

// 사용자 메뉴 닫기
function closeUserMenu() {
  const menu = $('#user-menu');
  if (menu) {
    menu.classList.add('hidden');
  }
}

// 로그아웃
function onLogout() {
  if (confirm('로그아웃 하시겠습니까?')) {
    // 토큰 및 세션 삭제
    api.clearToken();
    AppState.session = null;
    
    // UI 초기화
    $('#badge-user').textContent = '게스트';
    
    // 로그인 화면으로 이동
    route('login');
    
    toast('로그아웃 되었습니다', 'success');
    console.log('✅ 로그아웃 완료');
  }
}

// 내 정보 보기 (모달)
function showMyInfo() {
  closeUserMenu();
  if (!AppState.session) {
    toast('로그인이 필요합니다', 'error');
    return;
  }
  const s = AppState.session;
  const content = $('#my-info-content');
  const modal = $('#my-info-modal');
  if (content && modal) {
    content.innerHTML = `
      <div class="info-row"><span class="info-label">단지</span><span class="info-value">${escapeHTML(s.complex)}</span></div>
      <div class="info-row"><span class="info-label">동·호</span><span class="info-value">${s.dong}동 ${s.ho}호</span></div>
      <div class="info-row"><span class="info-label">성명</span><span class="info-value">${escapeHTML(s.name)}</span></div>
      <div class="info-row"><span class="info-label">전화번호</span><span class="info-value">${escapeHTML(s.phone)}</span></div>
    `;
    modal.classList.remove('hidden');
  }
}

function closeMyInfoModal() {
  const modal = $('#my-info-modal');
  if (modal) modal.classList.add('hidden');
}

// 내 하자 현황 → 목록으로 이동 (목록 상단에 요약 표시)
async function showMyStats() {
  closeUserMenu();
  if (!checkAuth()) return;
  try {
    await loadCases();
    route('list');
  } catch (error) {
    handleAPIError(error, '');
  }
}

// Admin 페이지로 이동
function goToAdmin() {
  closeUserMenu();
  route('admin');
}

// 뒤로가기 기능
function goBack() {
  if (navigationHistory.length > 0) {
    const previousScreen = navigationHistory.pop();
    route(previousScreen);
  } else {
    // 히스토리가 없으면 목록으로
    route('list');
  }
}

async function onLogin(){
  if (isLoading) return;

  const complex = $('#login-complex').value.trim();
  const dong = $('#login-dong').value.trim();
  const ho = $('#login-ho').value.trim();
  const name = $('#login-name').value.trim();
  const phone = $('#login-phone').value.trim();

  // 로그인 키: 아파트/동/호만 필수. 이름·전화는 재로그인 시 생략 가능(최초 로그인 시에만 서버에서 필수)
  if (!complex || !dong || !ho) {
    toast('아파트명, 동, 호수를 입력해 주세요.', 'error');
    return;
  }

  setLoading(true);
  toast('로그인 중... 서버 시작까지 1-2분 소요될 수 있습니다', 'info');

  try {
    const response = await api.login(complex, dong, ho, name, phone);

    const user = response.user || {};
    AppState.session = {
      complex: user.complex ?? complex,
      dong: user.dong ?? dong,
      ho: user.ho ?? ho,
      name: user.name ?? name,
      phone: user.phone ?? phone,
      token: response.token,
      expires_at: response.expires_at
    };

    $('#badge-user').textContent = `${user.dong ?? dong}-${user.ho ?? ho} ${user.name || '(세대주)'}`;
    toast('✅ 로그인 성공', 'success');

    await loadCases();
    route('list');

  } catch (error) {
    if (error.code === 'FIRST_LOGIN_REQUIRED') {
      toast('최초 로그인입니다. 성명과 전화번호를 입력해 주세요.', 'error');
    } else {
      handleAPIError(error, 'login');
    }
  } finally {
    setLoading(false);
  }
}

async function loadCases() {
  if (!AppState.session) return;
  
  try {
    const cases = await api.getCases();
    AppState.cases = cases;
    renderCaseList();
  } catch (error) {
    handleAPIError(error, '');
  }
}

async function onShowList() {
  if (!checkAuth()) return;
  await loadCases();
  route('list');
}

// 세대주용: 케이스 없이 "하자 목록"만 표시 (케이스는 백엔드에서 유지)
function renderDefectList() {
  const wrap = $('#case-list');
  const summaryEl = $('#list-summary');
  if (!wrap) return;
  wrap.innerHTML = '';

  const defects = (AppState.cases || []).flatMap(c => (c.defects || []).map(d => ({ ...d, case_id: c.id })));

  if (summaryEl) {
    if (defects.length > 0) {
      summaryEl.textContent = '하자 총 ' + defects.length + '건';
      summaryEl.classList.remove('hidden');
    } else {
      summaryEl.textContent = '';
      summaryEl.classList.add('hidden');
    }
  }

  if (defects.length === 0) {
    wrap.innerHTML = `
      <div class="card" style="text-align: center; padding: 40px;">
        <div style="color: #666; margin-bottom: 12px;">등록된 하자가 없습니다.</div>
        <div style="font-size: 13px; color: var(--muted);">하자등록 탭에서 첫 하자를 등록해 보세요.</div>
      </div>
    `;
    return;
  }

  defects.forEach(defect => {
    const div = document.createElement('div');
    div.className = 'card';
    const contentSnippet = (defect.content || '').slice(0, 80) + ((defect.content || '').length > 80 ? '…' : '');
    div.innerHTML = `
      <div class="defect-header">
        <strong>${escapeHTML(defect.location)} - ${escapeHTML(defect.trade)}</strong>
        <span class="badge">${formatDate(defect.created_at)}</span>
      </div>
      <div class="defect-content">
        <div class="label">내용:</div>
        <p>${escapeHTML(contentSnippet)}</p>
      </div>
      <div class="hr"></div>
      <div class="button-group">
        <button class="button small success" onclick="editDefect('${String(defect.id).replace(/'/g, "\\'")}')">✏️ 수정</button>
        <button class="button small danger" onclick="deleteDefect('${String(defect.id).replace(/'/g, "\\'")}')">🗑️ 삭제</button>
      </div>
    `;
    wrap.appendChild(div);
  });
}

// 목록 화면에서 사용 (하자 목록 렌더)
function renderCaseList() {
  renderDefectList();
}

async function createNewCase() {
  if (isLoading) return;
  
  setLoading(true);
  
  try {
    const newCase = await api.createCase({
      type: '하자접수'
    });
    
    AppState.cases.unshift(newCase);
    AppState.currentCaseId = newCase.id;
    renderCaseList();
    toast('새 케이스가 생성되었습니다', 'success');
    
  } catch (error) {
    handleAPIError(error, '');
  } finally {
    setLoading(false);
  }
}

// 케이스가 없으면 자동 생성
async function ensureCaseExists() {
  if (!AppState.session) {
    console.warn('⚠️ 세션이 없습니다');
    return;
  }
  
  // 이미 케이스가 있는지 확인
  if (AppState.currentCaseId) {
    return;
  }

  try {
    // 기존 케이스 목록 확인
  if (!AppState.cases || AppState.cases.length === 0) {
      await loadCases();
    }
    
    // 최신 케이스 사용
    if (AppState.cases && AppState.cases.length > 0) {
      AppState.currentCaseId = AppState.cases[0].id;
      console.log('✅ 기존 케이스 사용:', AppState.currentCaseId);
      toast('기존 케이스를 사용합니다', 'info');
    return;
  }
    
    // 케이스가 없으면 새로 생성
    console.log('📝 케이스가 없어서 자동 생성합니다');
    const newCase = await api.createCase({ type: '하자접수' });
    AppState.cases = [newCase];
    AppState.currentCaseId = newCase.id;
    console.log('✅ 새 케이스 생성:', AppState.currentCaseId);
    toast('새 케이스가 생성되었습니다', 'success');
    
  } catch (error) {
    console.error('❌ 케이스 생성 실패:', error);
    toast('케이스 생성 중 오류가 발생했습니다', 'error');
  }
}

// 케이스별 하자 목록 보기
async function viewCaseDefects(caseId) {
  if (!checkAuth()) return;

  setLoading(true);
  try {
    AppState.currentCaseId = caseId;
    const defects = await api.getDefects(caseId);
    
    const container = $('#defect-list-container');
    const titleEl = $('#case-detail-title');
    
    if (titleEl) titleEl.textContent = defects && defects.length > 0 ? `하자 목록 (${defects.length}건)` : '하자 목록';
    
    if (!defects || defects.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 40px;">
          <div style="color: #666;">등록된 하자가 없습니다.</div>
        </div>
      `;
    } else {
      // 각 하자에 대한 측정값 조회 (점검결과 표시용)
      const defectsWithInspections = await Promise.all(
        defects.map(async (defect) => {
          try {
            const inspections = await api.getDefectInspections(defect.id);
            return { ...defect, inspections: inspections.inspections || {} };
          } catch (error) {
            console.warn(`하자 ${defect.id}의 측정값 조회 실패:`, error);
            return { ...defect, inspections: {} };
          }
        })
      );
      
      const uploadBase = (typeof api !== 'undefined' && api.baseURL) ? api.baseURL.replace(/\/api\/?$/, '').replace(/\/$/, '') : 'https://insighti-app-new.onrender.com';
      const toPhotoUrl = (raw) => {
        if (!raw || typeof raw !== 'string') return '';
        const s = String(raw).trim();
        if (!s) return '';
        if (s.startsWith('http://') || s.startsWith('https://')) return s;
        const m = s.match(/^\/?uploads\/(.+)$/);
        if (m && uploadBase) return uploadBase.replace(/\/+$/, '') + '/api/upload/serve/' + encodeURIComponent(m[1]);
        const bare = s.replace(/^\/+/, '');
        if (bare && !bare.includes('/') && !bare.includes('..') && uploadBase) return uploadBase.replace(/\/+$/, '') + '/api/upload/serve/' + encodeURIComponent(bare);
        const p = s.startsWith('/') ? s : '/' + s;
        return uploadBase ? uploadBase.replace(/\/+$/, '') + p : s;
      };
      container.innerHTML = defectsWithInspections.map(defect => {
        const hasInspections = Object.keys(defect.inspections || {}).length > 0;
        const inspectionSummary = hasInspections 
          ? Object.entries(defect.inspections).map(([type, items]) => {
              const typeNames = { air: '공기질', radon: '라돈', level: '레벨기', thermal: '열화상' };
              return `${typeNames[type] || type} ${items.length}건`;
            }).join(', ')
          : '';
        
        return `
          <div class="card">
            <div class="defect-header">
              <strong>${escapeHTML(defect.location)} - ${escapeHTML(defect.trade)}</strong>
              <span class="badge">${formatDate(defect.created_at)}</span>
            </div>
            <div class="defect-content">
              <div class="label">내용:</div>
              <p>${escapeHTML(defect.content)}</p>
              ${defect.memo ? `
                <div class="label" style="margin-top:8px;">메모:</div>
                <p>${escapeHTML(defect.memo)}</p>
              ` : ''}
              ${hasInspections ? `
                <div class="label" style="margin-top:8px;">점검결과:</div>
                <p style="color: #27ae60; font-size: 14px;">${inspectionSummary}</p>
              ` : ''}
              ${defect.photos && defect.photos.length > 0 ? `
                <div class="label" style="margin-top:8px;">사진:</div>
                <div class="gallery" style="display:flex;gap:8px;margin-top:4px;">
                  ${defect.photos.map(photo => {
                    const fullUrl = toPhotoUrl(photo.url || '');
                    return `
                    <div class="thumb has-image" 
                         style="background-image:url('${fullUrl}');cursor:pointer;" 
                         onclick="showImageModal('${fullUrl}')">
                      ${photo.kind === 'near' ? '전체' : '근접'}
                    </div>
                  `;
                  }).join('')}
                </div>
              ` : ''}
            </div>
            <div class="hr"></div>
            <div class="button-group">
              <button class="button small" onclick="editDefect('${defect.id}')">✏️ 수정</button>
              <button class="button small danger" onclick="deleteDefect('${defect.id}')">🗑️ 삭제</button>
            </div>
          </div>
        `;
      }).join('');
    }
    
    route('case-detail');
    
  } catch (error) {
    handleAPIError(error, '');
  } finally {
    setLoading(false);
  }
}

// 세대주: 하자등록 탭 클릭 시 케이스 확보(없으면 생성) 후 바로 하자 등록 화면으로
async function goToNewDefect() {
  if (!checkAuth()) return;
  await ensureCaseExists();
  route('newdefect');
}

// 케이스에 하자 추가 (currentCaseId 설정 후 하자 등록 화면으로) — 목록에서 제거됨, 점검원 등 내부용 유지
function addDefectToCase(caseId) {
  AppState.currentCaseId = caseId;
  route('newdefect');
}

// 점검결과 입력 기능은 inspector.html로 분리됨

// 하자 수정 화면으로 이동
async function editDefect(defectId) {
  if (!checkAuth()) return;
  
  setLoading(true);
  try {
    const defect = await api.getDefect(defectId);
    AppState.editingDefectId = defectId;
    
    // 폼에 기존 데이터 채우기
    $('#edit-location').value = defect.location || '';
    $('#edit-trade').value = defect.trade || '';
    $('#edit-content').value = defect.content || '';
    $('#edit-memo').value = defect.memo || '';
    
    // 사진 표시
    const photoNear = $('#edit-photo-near');
    const photoFar = $('#edit-photo-far');
    
    if (photoNear && photoFar) {
      // 기존 사진 초기화
      photoNear.style.backgroundImage = '';
      photoNear.classList.remove('has-image');
      photoFar.style.backgroundImage = '';
      photoFar.classList.remove('has-image');
      
      // 저장된 사진 표시
      const uploadBase = (typeof api !== 'undefined' && api.baseURL) ? api.baseURL.replace(/\/api\/?$/, '').replace(/\/$/, '') : 'https://insighti-app-new.onrender.com';
      const toPhotoUrl = (raw) => {
        if (!raw || typeof raw !== 'string') return '';
        const s = String(raw).trim();
        if (!s) return '';
        if (s.startsWith('http://') || s.startsWith('https://')) return s;
        const m = s.match(/^\/?uploads\/(.+)$/);
        if (m && uploadBase) return uploadBase.replace(/\/+$/, '') + '/api/upload/serve/' + encodeURIComponent(m[1]);
        const bare = s.replace(/^\/+/, '');
        if (bare && !bare.includes('/') && !bare.includes('..') && uploadBase) return uploadBase.replace(/\/+$/, '') + '/api/upload/serve/' + encodeURIComponent(bare);
        const p = s.startsWith('/') ? s : '/' + s;
        return uploadBase ? uploadBase.replace(/\/+$/, '') + p : s;
      };
      if (defect.photos && defect.photos.length > 0) {
        defect.photos.forEach(photo => {
          const photoUrl = toPhotoUrl(photo.url || '');
          if (photo.kind === 'near' && photoNear) {
            photoNear.style.backgroundImage = `url('${photoUrl}')`;
            photoNear.classList.add('has-image');
            photoNear.setAttribute('data-photo-url', photoUrl);
          } else if (photo.kind === 'far' && photoFar) {
            photoFar.style.backgroundImage = `url('${photoUrl}')`;
            photoFar.classList.add('has-image');
            photoFar.setAttribute('data-photo-url', photoUrl);
          }
        });
      }
    }
    
    route('edit-defect');
    
  } catch (error) {
    handleAPIError(error, '');
  } finally {
    setLoading(false);
  }
}

// 하자 수정 저장
async function saveDefectEdit() {
  if (!checkAuth()) return;
  if (isLoading) return;
  
  const location = $('#edit-location').value.trim();
  const trade = $('#edit-trade').value.trim();
  const content = $('#edit-content').value.trim();
  const memo = $('#edit-memo').value.trim();
  
  if (!location || !trade || !content) {
    toast('위치, 세부공정, 내용은 필수입니다', 'error');
    return;
  }
  
  setLoading(true);
  try {
    // 수정 화면에서 새로 업로드된 사진 확인
    // 사진이 새로 업로드된 경우에만 전송 (기존 사진 유지)
    const photoNearKey = AppState.photoNearKey || null;
    const photoFarKey = AppState.photoFarKey || null;
    
    const defectData = {
      location,
      trade,
      content,
      memo
    };
    
    // 새로 업로드된 사진이 있는 경우에만 포함
    if (photoNearKey) {
      defectData.photo_near_key = photoNearKey;
    }
    if (photoFarKey) {
      defectData.photo_far_key = photoFarKey;
    }
    
    await api.updateDefect(AppState.editingDefectId, defectData);
    toast('하자가 수정되었습니다', 'success');
    
    // 사진 키 초기화
    AppState.photoNearKey = null;
    AppState.photoFarKey = null;
    
    // 하자 목록으로 돌아가기
    await loadCases();
    route('list');
    
  } catch (error) {
    handleAPIError(error, '');
  } finally {
    setLoading(false);
  }
}

// 하자 수정 취소
function cancelEdit() {
  route('list');
}

// 하자 삭제는 현재 클라이언트에서 비활성화(서버 정책 정리 후 활성화 예정)
async function deleteDefect(defectId) {
  toast('하자 삭제 기능은 다음 단계에서 구현됩니다', 'info');
}

async function onSaveDefect(){
  if (isLoading) return;
  
  const categoryId = $('#defect-category').value;
  const location = $('#def-location').value.trim();
  let trade = $('#def-trade').value.trim();
  let content = $('#def-content').value.trim();
  const memo = $('#def-memo').value.trim();
  
  if (categoryId === '__custom__') {
    const customName = ($('#defect-category-custom').value || '').trim().slice(0, 10);
    if (!customName) {
      toast('하자명(직접 입력)을 입력해 주세요', 'error');
      return;
    }
    trade = customName;
    if (!content) content = customName;
  }
  
  if(!location || !trade || !content){
    toast('위치/세부공정/내용을 입력해 주세요', 'error');
    return;
  }

  setLoading(true);
  
  try {
    // 케이스가 없으면 자동 생성 (통합된 헬퍼 함수 사용)
    const caseId = await ensureCase();
    if (!AppState.currentCaseId) {
      toast('케이스가 자동으로 생성되었습니다', 'info');
    }
    
    // Use photo keys from AppState (already uploaded during photo selection)
    const photoNearKey = AppState.photoNearKey || '';
    const photoFarKey = AppState.photoFarKey || '';
    
    // Create defect
    const defectData = {
      case_id: caseId,
      location,
      trade,
      content,
      memo,
      photo_near_key: photoNearKey,
      photo_far_key: photoFarKey
    };
    
    const newDefect = await api.createDefect(defectData);
    
    // 푸시 알림 발송 (하자 등록 완료)
    try {
      await api.sendPushNotification('defect-registered', {
        defectId: newDefect.id,
        location,
        trade,
        content
      });
      console.log('✅ Defect registration notification sent');
    } catch (error) {
      console.warn('⚠️ Failed to send push notification:', error);
      // 푸시 알림 실패는 하자 등록을 방해하지 않음
    }
    
    // Clear form
    $('#def-location').value = '';
    $('#def-trade').value = '';
    $('#def-content').value = '';
    $('#def-memo').value = '';
    $('#defect-category').value = '';
    const customWrap = $('#defect-category-custom-wrap');
    const customInput = $('#defect-category-custom');
    if (customWrap) customWrap.classList.add('hidden');
    if (customInput) customInput.value = '';
    
    // Clear photos
    const photoNear = $('#photo-near');
    const photoFar = $('#photo-far');
    if (photoNear) {
      photoNear.style.backgroundImage = '';
      photoNear.classList.remove('has-image');
    }
    if (photoFar) {
      photoFar.style.backgroundImage = '';
      photoFar.classList.remove('has-image');
    }
    
    // Clear photo inputs
    const inputNearCamera = $('#input-near-camera');
    const inputNearGallery = $('#input-near-gallery');
    const inputFarCamera = $('#input-far-camera');
    const inputFarGallery = $('#input-far-gallery');
    if (inputNearCamera) inputNearCamera.value = '';
    if (inputNearGallery) inputNearGallery.value = '';
    if (inputFarCamera) inputFarCamera.value = '';
    if (inputFarGallery) inputFarGallery.value = '';
    
    // Clear AppState
    AppState.photoNearKey = null;
    AppState.photoFarKey = null;
    
    toast('하자가 저장되었습니다', 'success');
    
    // Reload cases and show list
    await loadCases();
    route('list');
    
  } catch (error) {
    handleAPIError(error, '');
  } finally {
    setLoading(false);
  }
}

// 보고서 기능은 inspector.html로 이동됨

// Utility functions
function formatDate(dateString) {
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

function checkAuth() {
  if (!AppState.token) {
    toast('로그인이 필요합니다', 'error');
    route('login');
  return false;
  }
  return true;
}

function logout() {
  api.clearToken();
  localStorage.removeItem('insighti_session');
  AppState.session = null;
  AppState.cases = [];
  $('#badge-user').textContent = '게스트';
  route('login');
}

// Save session to localStorage
function saveSession() {
  if (AppState.session) {
    localStorage.setItem('insighti_session', JSON.stringify(AppState.session));
  }
}

// 케이스 자동 생성 헬퍼 함수 (중복 제거)
async function ensureCase() {
  if (!AppState.currentCaseId || !AppState.cases || AppState.cases.length === 0) {
    try {
      debugLog('📋 케이스 자동 생성...');
      const newCase = await api.createCase({ type: '하자접수' });
      AppState.currentCaseId = newCase.id;
      await loadCases();
      debugLog('✅ 케이스 생성 완료:', newCase.id);
      return newCase.id;
    } catch (error) {
      debugError('❌ 케이스 생성 실패:', error);
      throw error;
    }
  }
  
  // 케이스가 있으면 첫 번째 케이스 사용
  if (!AppState.currentCaseId && AppState.cases && AppState.cases.length > 0) {
    AppState.currentCaseId = AppState.cases[0].id;
  }
  
  return AppState.currentCaseId;
}

// UI 초기화 (select, event listener 등)
function initializeUI() {
  // populate selects
  const locSel = $('#def-location');
  const tradeSel = $('#def-trade');
  
  if (locSel && Catalog.locations) {
    Catalog.locations.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      locSel.appendChild(opt);
    });
  }
  
  if (tradeSel && Catalog.trades) {
    Catalog.trades.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      tradeSel.appendChild(opt);
    });
  }
  
  // Add logout functionality to user badge
  const userBadge = $('#badge-user');
  if (userBadge) {
    userBadge.addEventListener('click', () => {
    if (AppState.session) {
      if (confirm('로그아웃하시겠습니까?')) {
        logout();
      }
    }
  });
  }
  
  // Session auto-save on change
  let originalSession = AppState.session;
  Object.defineProperty(AppState, 'session', {
    get() {
      return originalSession;
    },
    set(value) {
      originalSession = value;
      saveSession();
    }
  });
}

// 첫 번째 DOMContentLoaded 제거됨 - 두 번째(1432줄)와 통합

// 기획서 요구사항 구현 함수들

// 하자 카테고리 목록 로드
async function loadDefectCategories() {
  try {
    const categories = await api.getDefectCategories();
    const select = $('#defect-category');
    
    // 기존 옵션 제거 (첫 번째 옵션 제외)
    while (select.children.length > 1) {
      select.removeChild(select.lastChild);
    }
    
    // 카테고리별로 그룹화
    const grouped = categories.reduce((acc, category) => {
      if (!acc[category.category]) {
        acc[category.category] = [];
      }
      acc[category.category].push(category);
      return acc;
    }, {});
    
    // 카테고리별로 옵션 추가
    Object.keys(grouped).forEach(categoryName => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = categoryName;
      
      grouped[categoryName].forEach(category => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        optgroup.appendChild(option);
      });
      
      select.appendChild(optgroup);
    });
    // 직접 입력 옵션 추가
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '직접 입력';
    select.appendChild(customOpt);
  } catch (error) {
    console.error('하자 카테고리 로드 실패:', error);
    toast('하자 카테고리를 불러올 수 없습니다', 'error');
  }
}

// 하자명 선택 시 자동 설명 표시 또는 직접입력 영역 (기획서 요구사항)
async function loadDefectDescription() {
  const categoryId = $('#defect-category').value;
  const descriptionArea = $('#defect-description');
  const videoSection = $('#video-section');
  const customWrap = $('#defect-category-custom-wrap');
  const customInput = $('#defect-category-custom');
  
  if (customWrap) customWrap.classList.add('hidden');
  if (customInput) customInput.value = '';
  
  if (!categoryId) {
    if (descriptionArea) descriptionArea.classList.add('hidden');
    if (videoSection) videoSection.classList.add('hidden');
    return;
  }
  
  if (categoryId === '__custom__') {
    if (descriptionArea) descriptionArea.classList.add('hidden');
    if (videoSection) videoSection.classList.add('hidden');
    if (customWrap) customWrap.classList.remove('hidden');
    if (customInput) customInput.focus();
    return;
  }
  
  try {
    setLoading(true);
    const categoryDetail = await api.getDefectCategoryDetail(categoryId);
    
    // 설명 표시
    $('#defect-description-text').textContent = categoryDetail.description;
    $('#defect-solution').textContent = `해결방법: ${categoryDetail.solution}`;
    descriptionArea.classList.remove('hidden');
    
    // 하자 내용 자동 입력
    $('#def-content').value = categoryDetail.description;
    
    // 실시간 YouTube 검색 시도
    console.log(`🔍 YouTube 실시간 검색 시작: "${categoryDetail.name}"`);
    
    try {
      const searchResult = await api.searchYouTubeVideos(categoryDetail.name, 3);
      
      if (searchResult.success && searchResult.videos && searchResult.videos.length > 0) {
        console.log(`✅ YouTube 검색 성공: ${searchResult.videos.length}개 동영상 발견`);
        
        // 첫 번째 동영상을 주요 동영상으로 사용
        const primaryVideo = searchResult.videos[0];
        loadYouTubeVideo(primaryVideo);
        videoSection.classList.remove('hidden');
        
        // 검색 결과를 화면에 표시
        showYouTubeSearchResults(searchResult.videos, categoryDetail.name);
        
      } else {
        console.log('⚠️ YouTube 검색 결과 없음, 기존 동영상 확인');
        
        // 기존 데이터베이스 동영상 확인
        if (categoryDetail.videos && categoryDetail.videos.length > 0) {
          const primaryVideo = categoryDetail.videos.find(v => v.is_primary) || categoryDetail.videos[0];
          loadYouTubeVideo(primaryVideo);
          videoSection.classList.remove('hidden');
        } else {
          videoSection.classList.add('hidden');
        }
      }
      
    } catch (youtubeError) {
      // 상세한 에러 로깅
      const errorMessage = youtubeError.message || '알 수 없는 오류';
      const errorDetails = youtubeError.details || '';
      const errorCode = youtubeError.error || youtubeError.status;
      
      console.warn('⚠️ YouTube 검색 실패:', {
        message: errorMessage,
        details: errorDetails,
        status: youtubeError.status,
        error: errorCode
      });
      
      // 에러 유형별 처리 (사용자 경험을 해치지 않도록 조용히 처리)
      if (errorCode === 'YouTube API key not configured' || errorDetails?.includes('API 키')) {
        // API 키 미설정 - 조용히 실패
        console.warn('⚠️ YouTube API 키가 설정되지 않았습니다. 기존 동영상을 사용합니다.');
      } else if (youtubeError.status === 403) {
        // 할당량 초과 또는 접근 거부 - 조용히 실패
        console.warn('⚠️ YouTube API 접근 제한. 기존 동영상을 사용합니다.');
      } else if (youtubeError.status === 503) {
        // 서비스 불가 - 조용히 실패
        console.warn('⚠️ YouTube 검색 서비스를 사용할 수 없습니다. 기존 동영상을 사용합니다.');
      } else {
        // 기타 에러 - 조용히 실패
        console.warn('⚠️ YouTube 검색 실패, 기존 동영상 사용');
      }
      
      // YouTube 검색 실패 시 기존 동영상 사용 (graceful degradation)
      if (categoryDetail.videos && categoryDetail.videos.length > 0) {
        const primaryVideo = categoryDetail.videos.find(v => v.is_primary) || categoryDetail.videos[0];
        loadYouTubeVideo(primaryVideo);
        videoSection.classList.remove('hidden');
        console.log('✅ 기존 동영상을 사용합니다.');
      } else {
        videoSection.classList.add('hidden');
        console.log('⚠️ 사용 가능한 동영상이 없습니다.');
      }
    }
    
  } catch (error) {
    console.error('하자 설명 로드 실패:', error);
    toast('하자 설명을 불러올 수 없습니다', 'error');
  } finally {
    setLoading(false);
  }
}

// YouTube 검색 결과 표시
function showYouTubeSearchResults(videos, defectName) {
  const videoSection = $('#video-section');
  
  // 검색 결과 정보 표시
  const searchInfo = document.createElement('div');
  searchInfo.className = 'youtube-search-info';
  searchInfo.innerHTML = `
    <div class="search-info-header">
      <span class="search-icon">🔍</span>
      <span class="search-text">"${defectName}" 관련 동영상 ${videos.length}개 발견</span>
      <button class="button small" onclick="refreshYouTubeSearch('${defectName}')">새로고침</button>
    </div>
  `;
  
  // 기존 검색 정보 제거
  const existingInfo = videoSection.querySelector('.youtube-search-info');
  if (existingInfo) {
    existingInfo.remove();
  }
  
  // 검색 정보 추가
  videoSection.insertBefore(searchInfo, videoSection.firstChild);
  
  // 동영상 목록 표시 (선택 가능)
  if (videos.length > 1) {
    const videoList = document.createElement('div');
    videoList.className = 'youtube-video-list';
    videoList.innerHTML = `
      <div class="video-list-header">다른 동영상 보기:</div>
      <div class="video-list-items">
        ${videos.slice(1).map((video, index) => `
          <div class="video-item" onclick="loadYouTubeVideo(${JSON.stringify(video).replace(/"/g, '&quot;')})">
            <img src="${video.thumbnail}" alt="${video.title}" class="video-thumbnail">
            <div class="video-info">
              <div class="video-title">${video.title}</div>
              <div class="video-channel">${video.channel_title}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    
    // 기존 동영상 목록 제거
    const existingList = videoSection.querySelector('.youtube-video-list');
    if (existingList) {
      existingList.remove();
    }
    
    // 동영상 목록 추가
    videoSection.appendChild(videoList);
  }
}

// YouTube 검색 새로고침
async function refreshYouTubeSearch(defectName) {
  try {
    setLoading(true);
    const searchResult = await api.searchYouTubeVideos(defectName, 3);
    
    if (searchResult.success && searchResult.videos && searchResult.videos.length > 0) {
      const primaryVideo = searchResult.videos[0];
      loadYouTubeVideo(primaryVideo);
      showYouTubeSearchResults(searchResult.videos, defectName);
      toast('YouTube 검색이 새로고침되었습니다', 'success');
    } else {
      toast('새로운 동영상을 찾을 수 없습니다', 'warning');
    }
  } catch (error) {
    console.error('YouTube 검색 새로고침 실패:', error);
    toast('YouTube 검색 새로고침에 실패했습니다', 'error');
  } finally {
    setLoading(false);
  }
}

// 동영상에서 하자 위치 마킹 (기획서 요구사항)
function markDefectInVideo() {
  toast('하자 위치 마킹 기능은 향후 구현 예정입니다', 'info');
  // TODO: 동영상 타임스탬프 마킹 기능 구현
}

// 재촬영 기능 (기획서 요구사항)
function retakePhotos() {
  $('#photo-near').style.backgroundImage = '';
  $('#photo-near').classList.remove('has-image');
  $('#photo-far').style.backgroundImage = '';
  $('#photo-far').classList.remove('has-image');
  AppState.photoNearKey = null;
  AppState.photoFarKey = null;
  toast('사진을 다시 촬영해주세요', 'info');
}

// 이미지 모달 관련 함수
function showImageModal(imageUrl) {
  const modal = $('#image-modal');
  const modalImg = $('#modal-image');
  if (modal && modalImg) {
    modalImg.src = imageUrl;
    modal.classList.remove('hidden');
  }
}

function closeImageModal() {
  const modal = $('#image-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}


// AI 기능 통합 함수들

// 사진 옵션 선택 다이얼로그 표시
function showPhotoOptions(type) {
  const photoTypeLabel = type === 'near' ? '전체사진' : '근접사진';
  
  // 커스텀 다이얼로그 생성
  const dialog = document.createElement('div');
  dialog.className = 'photo-options-dialog';
  dialog.innerHTML = `
    <div class="photo-options-overlay" onclick="closePhotoOptions()"></div>
    <div class="photo-options-content">
      <h3>${photoTypeLabel} 선택</h3>
      <button class="photo-option-btn camera" onclick="selectPhotoSource('${type}', 'camera')">
        📷 카메라로 촬영
      </button>
      <button class="photo-option-btn gallery" onclick="selectPhotoSource('${type}', 'gallery')">
        🖼️ 갤러리에서 선택
      </button>
      <button class="photo-option-btn cancel" onclick="closePhotoOptions()">
        취소
      </button>
    </div>
  `;
  
  document.body.appendChild(dialog);
}

// 사진 소스 선택 처리
function selectPhotoSource(type, source) {
  closePhotoOptions();
  
  // 수정 화면인지 확인
  const isEditMode = type.startsWith('edit-');
  const photoType = isEditMode ? type.replace('edit-', '') : type;
  const prefix = isEditMode ? 'edit-' : '';
  
  // 카메라 또는 갤러리 input 트리거
  const inputId = `#input-${prefix}${photoType}-${source}`;
  const inputElement = $(inputId);
  
  if (inputElement) {
    inputElement.click();
  } else {
    console.error('❌ Input 요소를 찾을 수 없습니다:', inputId);
  }
}

// 사진 옵션 다이얼로그 닫기
function closePhotoOptions() {
  const dialog = document.querySelector('.photo-options-dialog');
  if (dialog) {
    dialog.remove();
  }
}

// 사진 입력 트리거 (하위 호환성)
function triggerPhotoInput(type) {
  showPhotoOptions(type);
}

// 사진 업로드 처리 및 AI 감지
async function handlePhotoUpload(type, inputElement) {
  console.log('📸 handlePhotoUpload 호출됨:', type);
  
  const file = inputElement.files[0];
  if (!file) {
    console.warn('⚠️ 파일이 선택되지 않았습니다');
    return;
  }
  
  console.log('✅ 파일 선택됨:', file.name, file.type, file.size, 'bytes');
  
  // 이미지 파일 검증
  if (!file.type.startsWith('image/')) {
    toast('이미지 파일만 업로드 가능합니다', 'error');
    return;
  }
  
  // 파일 크기 검증 (10MB)
  if (file.size > 10 * 1024 * 1024) {
    toast('파일 크기는 10MB 이하여야 합니다', 'error');
    return;
  }
  
  try {
    toast(`${type === 'near' || type === 'edit-near' ? '전체' : '근접'}사진 처리 중...`, 'info');
    
    // 파일 미리보기 설정
    const reader = new FileReader();
    
    reader.onerror = (error) => {
      console.error('❌ FileReader 오류:', error);
      toast('파일 읽기 실패', 'error');
    };
    
    reader.onload = async (e) => {
      console.log('✅ 파일 읽기 완료');
      
      // 수정 화면인지 확인
      const isEditMode = type.startsWith('edit-');
      const photoType = isEditMode ? type.replace('edit-', '') : type;
      const thumbElementId = isEditMode ? `#edit-photo-${photoType}` : `#photo-${type}`;
      const thumbElement = $(thumbElementId);
      
      if (!thumbElement) {
        console.error('❌ 썸네일 요소를 찾을 수 없습니다:', thumbElementId);
        return;
      }
      
      thumbElement.style.backgroundImage = `url(${e.target.result})`;
      thumbElement.classList.add('has-image');
      
      try {
        // 이미지 압축 (HD 수준: 1920x1080, 품질 85%)
        console.log('🗜️ 이미지 압축 시작...');
        const compressedFile = await compressImage(file, 1920, 1080, 0.85);
        console.log('✅ 이미지 압축 완료');
        
        // 서버에 압축된 사진 업로드
        console.log('📤 서버에 사진 업로드 시작:', type);
        const uploadResult = await api.uploadImage(compressedFile);
        console.log('✅ 서버 업로드 완료:', uploadResult);
        
        // AppState에 photo key 저장 (업로드 API는 key 반환, filename은 호환용)
        const photoKey = uploadResult.key || uploadResult.filename;
        const photoType = isEditMode ? type.replace('edit-', '') : type;
        if (photoType === 'near') {
          AppState.photoNearKey = photoKey;
        } else {
          AppState.photoFarKey = photoKey;
        }
        
        toast(`${photoType === 'near' ? '전체' : '근접'}사진 업로드 완료!`, 'success');
        
        // AI 감지 시작 (활성화된 경우에만, 압축된 파일 사용) - 수정 화면에서는 AI 분석 제외
        if (!isEditMode && window.ENABLE_AI_ANALYSIS) {
          try {
            await analyzePhotoWithAI(compressedFile, photoType);
          } catch (aiError) {
            console.error('❌ AI 분석 오류:', aiError);
            // AI 오류는 무시하고 계속 진행
          }
        } else if (!isEditMode) {
          console.log('ℹ️ AI 분석이 비활성화되어 있습니다. 사진만 업로드됩니다.');
        }
      } catch (error) {
        console.error('❌ 사진 처리 실패:', error);
        toast(error.message || '사진 업로드 실패. 다시 시도해주세요.', 'error');
        // 실패 시 썸네일도 제거
        thumbElement.style.backgroundImage = '';
        thumbElement.classList.remove('has-image');
      }
    };
    
    reader.readAsDataURL(file);
    
  } catch (error) {
    console.error('❌ 사진 업로드 실패:', error);
    toast('사진 업로드 중 오류가 발생했습니다', 'error');
  }
}

// AI로 사진 분석
async function analyzePhotoWithAI(file, photoType) {
  try {
    console.log('🔍 사진 분석 시작:', file.name, file.size, 'bytes');
    
    // AI 분석 결과 영역 표시
    const aiResultsDiv = $('#ai-analysis-results');
    aiResultsDiv.innerHTML = `
      <div class="ai-loading">
        <div class="ai-loading-spinner"></div>
        <span>🤖 AI가 사진을 분석 중입니다...</span>
      </div>
    `;
    aiResultsDiv.classList.remove('hidden');
    
    // 하이브리드 디텍터 사용
    if (window.hybridDetector) {
      console.log('🎯 하이브리드 AI 분석 시작...');
      
      const result = await window.hybridDetector.analyze(file, photoType);
      console.log('✅ 하이브리드 분석 완료:', result);
      
      displayAIDetectionResults(result, photoType);
      
      // 학습 데이터 저장
      try {
        await saveLearningData(file.name, result.primary, photoType);
      } catch (error) {
        console.error('학습 데이터 저장 실패:', error);
      }
      
      return;
    }
    
    console.warn('⚠️ 하이브리드 감지기가 준비되지 않았습니다. 모의 결과를 생성합니다.');
    const mockDefects = generateQuickMockDefects();
    displayAIDetectionResults({ source: 'mock', defects: mockDefects, primary: mockDefects[0] }, photoType);
    
  } catch (error) {
    console.error('AI 분석 실패:', error);
    
    const aiResultsDiv = $('#ai-analysis-results');
    aiResultsDiv.innerHTML = `
      <div class="ai-analysis-header">
        <h4>⚠️ AI 분석 실패</h4>
        <button class="button small" onclick="hideAIAnalysis()">닫기</button>
      </div>
      <p>AI 분석 중 오류가 발생했습니다. 수동으로 하자를 등록해주세요.</p>
    `;
  }
}

// 파일을 이미지 요소로 변환
function createImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// 간단한 모의 하자 감지 결과 생성
function generateQuickMockDefects() {
  const allDefects = [
    { type: '벽지찢김', severity: '보통', description: '벽체부위 벽지파손은 위치별 크기별로 다르나 보수로 처리가능한' },
    { type: '벽균열', severity: '심각', description: '벽체에 발생한 균열로 건물의 구조적 문제를 나타낼 수 있음' },
    { type: '마루판들뜸', severity: '보통', description: '바닥 마루판이 들뜨거나 움직이는 현상' },
    { type: '타일균열', severity: '보통', description: '타일 표면 또는 접합부에 발생한 균열' },
    { type: '페인트벗겨짐', severity: '경미', description: '도장 표면이 벗겨지거나 박리되는 현상' },
    { type: '천장누수', severity: '심각', description: '천장에서 물이 스며나오거나 누수 흔적이 보임' },
    { type: '욕실곰팡이', severity: '보통', description: '욕실 벽면이나 천장에 발생한 곰팡이' },
    { type: '문틀변형', severity: '보통', description: '문틀이 변형되어 문이 제대로 닫히지 않음' },
    { type: '콘센트불량', severity: '심각', description: '콘센트가 제대로 작동하지 않거나 느슨함' },
    { type: '창문잠금불량', severity: '보통', description: '창문 잠금장치가 제대로 작동하지 않음' }
  ];
  
  // 랜덤으로 1-2개 선택
  const count = Math.floor(Math.random() * 2) + 1;
  const selected = [];
  
  for (let i = 0; i < count; i++) {
    const randomIndex = Math.floor(Math.random() * allDefects.length);
    const defect = allDefects[randomIndex];
    const confidence = (Math.random() * 0.3 + 0.6).toFixed(2); // 60-90%
    
    selected.push({
      type: defect.type,
      severity: defect.severity,
      description: defect.description,
      confidence: parseFloat(confidence)
    });
  }
  
  return selected;
}

// AI 감지 결과 표시
function displayAIDetectionResults(aiResult, photoType) {
  const aiResultsDiv = $('#ai-analysis-results');
  const detectedListDiv = $('#ai-detected-defects');
  const defects = Array.isArray(aiResult?.defects) ? aiResult.defects : aiResult || [];
  window.currentAIResult = {
    defects,
    source: aiResult?.source || (Array.isArray(aiResult) ? 'local' : 'unknown'),
    raw: aiResult
  };
  
  if (!defects.length) {
    aiResultsDiv.innerHTML = `
      <div class="ai-analysis-header">
        <h4>✅ AI 분석 완료</h4>
        <button class="button small" onclick="hideAIAnalysis()">닫기</button>
      </div>
      <p>이 사진에서는 하자가 감지되지 않았습니다.</p>
    `;
    return;
  }
  
  // 감지된 하자들을 표시
  let defectsHTML = '';
  defects.forEach((defect, index) => {
    defectsHTML += `
      <div class="ai-defect-item" data-defect-index="${index}">
        <div class="ai-defect-header">
          <span class="ai-defect-type">${defect.type}</span>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="ai-severity ${defect.severity}">${defect.severity}</span>
            <span class="ai-confidence">${Math.round(defect.confidence * 100)}%</span>
          </div>
        </div>
        <div class="ai-defect-description">${defect.description || '추가 설명 없음'}</div>
        ${defect.recommendation ? `<div class="ai-defect-recommendation">💡 ${defect.recommendation}</div>` : ''}
        <div class="ai-defect-actions">
          <button class="button success" onclick="useAIDetection(${index}, '${photoType}')">
            ✅ 이 결과 사용
          </button>
          <button class="button" onclick="rejectAIDetection(${index})">
            ❌ 틀렸습니다
          </button>
        </div>
      </div>
    `;
  });
  
  const mode = window.hybridDetector?.settings?.mode || aiResult?.source || 'local';
  const provider = window.hybridDetector?.settings?.provider || (aiResult?.source === 'huggingface' ? 'huggingface' : 'azure');
  let aiModeMessage = '<div class="ai-mode-badge mock">🎯 로컬 규칙 기반 분석</div>';
  if (mode === 'azure' || (provider === 'azure' && aiResult?.source === 'azure')) {
    aiModeMessage = '<div class="ai-mode-badge azure">🌐 Azure OpenAI Vision</div>';
  } else if (mode === 'huggingface' || aiResult?.source === 'huggingface' || provider === 'huggingface') {
    aiModeMessage = '<div class="ai-mode-badge huggingface">🤗 Hugging Face Inference</div>';
  } else if (mode === 'hybrid') {
    aiModeMessage = provider === 'huggingface'
      ? '<div class="ai-mode-badge hybrid">🔄 하이브리드 모드 (로컬 → Hugging Face)</div>'
      : '<div class="ai-mode-badge hybrid">🔄 하이브리드 모드 (로컬 → Azure)</div>';
  }
  
  aiResultsDiv.innerHTML = `
    <div class="ai-analysis-header">
      <h4>🤖 AI 분석 완료 - ${defects.length}개 하자 감지</h4>
      <button class="button small" onclick="hideAIAnalysis()">닫기</button>
    </div>
    ${aiModeMessage}
    <div class="ai-detected-list">
      ${defectsHTML}
    </div>
  `;
}

// AI 감지 결과 사용
function useAIDetection(defectIndex, photoType) {
  // AI 감지 결과를 현재 하자 등록 폼에 적용
  const aiResultsDiv = $('#ai-analysis-results');
  const defectItem = aiResultsDiv.querySelector(`[data-defect-index="${defectIndex}"]`);
  const currentResult = window.currentAIResult;
  
  if (!defectItem) return;
  if (!currentResult || !currentResult.defects || !currentResult.defects[defectIndex]) {
    toast('AI 결과를 찾을 수 없습니다', 'error');
    return;
  }

  const defectData = currentResult.defects[defectIndex];
  
  // 감지된 하자 정보 추출
  const defectType = defectData.type;
  const description = defectData.description || '';
  
  // 하자명 드롭다운에서 해당 항목 선택
  const categorySelect = $('#defect-category');
  const options = Array.from(categorySelect.options);
  const matchingOption = options.find(option => option.textContent === defectType);
  
  if (matchingOption) {
    categorySelect.value = matchingOption.value;
    loadDefectDescription(); // 자동 설명 로드
  }
  
  // 하자 내용 자동 입력
  $('#def-content').value = description;
  
  // 성공 피드백
  defectItem.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <div style="font-size: 24px; margin-bottom: 8px;">✅</div>
      <div>AI 감지 결과가 적용되었습니다!</div>
    </div>
  `;
  
  // 학습 데이터에 긍정적 피드백 추가
  const predictionId = learningSystem.predictionCache.get(`defect-${defectIndex}`);
  if (predictionId) {
    const feedback = {
      isCorrect: true,
      feedback: '정확한 감지'
    };
    learningSystem.collectFeedback(predictionId, feedback);
  }
  
  toast('AI 감지 결과가 적용되었습니다!', 'success');
}

// AI 감지 결과 거부
function rejectAIDetection(defectIndex) {
  const aiResultsDiv = $('#ai-analysis-results');
  const defectItem = aiResultsDiv.querySelector(`[data-defect-index="${defectIndex}"]`);
  const currentResult = window.currentAIResult;
  
  if (!defectItem || !currentResult) return;
  
  // 거부 피드백 표시
  defectItem.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <div style="font-size: 24px; margin-bottom: 8px;">❌</div>
      <div>피드백이 학습에 반영됩니다.</div>
      <div style="font-size: 12px; opacity: 0.8; margin-top: 8px;">
        올바른 하자를 수동으로 선택해주세요.
      </div>
    </div>
  `;
  
  // 학습 데이터에 부정적 피드백 추가
  const predictionId = learningSystem.predictionCache.get(`defect-${defectIndex}`);
  if (predictionId) {
    const feedback = {
      isCorrect: false,
      feedback: '부정확한 감지'
    };
    learningSystem.collectFeedback(predictionId, feedback);
  }
  
  toast('피드백이 AI 학습에 반영됩니다', 'info');
}

// AI 분석 결과 숨기기
function hideAIAnalysis() {
  $('#ai-analysis-results').classList.add('hidden');
}

// 학습 데이터 저장
function saveDetectionForLearning(defects, file, photoType) {
  // 감지 결과를 메모리에 저장 (실제로는 서버에 전송)
  if (!window.currentDetectionData) {
    window.currentDetectionData = [];
  }
  
  window.currentDetectionData.push({
    photoType,
    fileName: file.name,
    fileSize: file.size,
    detectedDefects: defects,
    timestamp: new Date().toISOString()
  });
}

// 메뉴 외부 클릭 시 닫기
document.addEventListener('click', (e) => {
  const userMenu = $('#user-menu');
  const badgeUser = $('#badge-user');
  
  if (userMenu && !userMenu.classList.contains('hidden')) {
    if (!userMenu.contains(e.target) && e.target !== badgeUser) {
      closeUserMenu();
    }
  }
});

// 앱 초기화
window.addEventListener('DOMContentLoaded', async () => {
  debugLog('🚀 앱 초기화 시작');
  
  // 먼저 모든 화면을 숨기고 login 화면만 표시 (기본 상태)
  $$('.screen').forEach(el => el.classList.add('hidden'));
  const loginScreen = $('#login');
  if (loginScreen) {
    loginScreen.classList.remove('hidden');
  }
  
  // AI 모드 설정 (localStorage에서 로드)
  const savedAISetting = localStorage.getItem('ENABLE_AI_ANALYSIS');
  const aiEnabled = savedAISetting === 'true';
  window.ENABLE_AI_ANALYSIS = aiEnabled;
  debugLog(`🤖 AI 분석: ${window.ENABLE_AI_ANALYSIS ? '활성화' : '비활성화 ✓'}`);
  
  // 하이브리드 AI 디텍터 초기화
  if (window.ENABLE_AI_ANALYSIS) {
    try {
      window.hybridDetector = new HybridDetector();
      await window.hybridDetector.initialize();
      debugLog('✅ 하이브리드 AI 시스템 준비 완료');
    } catch (error) {
      debugError('❌ 하이브리드 AI 초기화 실패:', error);
      debugWarn('⚠️ AI 시스템 비활성화');
      window.ENABLE_AI_ANALYSIS = false;
    }
  }
  
  // 하자 카테고리 미리 로드
  try {
    await loadDefectCategories();
    debugLog('✅ 하자 카테고리 로드 완료');
  } catch (error) {
    debugError('❌ 하자 카테고리 로드 실패:', error);
    toast('서버 연결 중입니다 (최대 1-2분 소요)', 'info');
  }
  
  // 정책: 저장된 세션이 있어도 자동 로그인하지 않고 로그인 화면에서 시작
  const savedSession = localStorage.getItem('insighti_session');
  if (savedSession) {
    debugLog('💾 저장된 세션이 있지만 자동 로그인은 비활성화되어 있습니다');
    // 세션 정보는 유지하고 시작 화면만 로그인으로 고정
  }
  
  // 항상 로그인 화면으로 이동
  route('login');
  
  // UI 초기화
  initializeUI();
  
  debugLog('✅ 앱 초기화 완료');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Learning Data Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 학습 데이터 저장 (추후 모델 개선용)
 */
async function saveLearningData(filename, analysisResult, photoType) {
  try {
    // 간단한 해시 생성 (이미지 중복 체크용)
    const imageHash = await generateSimpleHash(filename);
    
    const learningData = {
      image_hash: imageHash,
      filename: filename,
      photo_type: photoType,
      prediction: analysisResult.defectType,
      confidence: analysisResult.confidence,
      severity: analysisResult.severity,
      source: analysisResult.source || (window.currentAIResult?.source ?? 'local'),
      final_label: null, // 사용자가 저장할 때 업데이트
      processing_time: analysisResult.processingTime || window.currentAIResult?.raw?.totalProcessingTime,
      recommendation: analysisResult.recommendation || '',
      created_at: new Date().toISOString()
    };
    
    // 로컬 백업 저장(오프라인/디버깅 용도)
    const savedData = JSON.parse(localStorage.getItem('learning_data') || '[]');
    savedData.push(learningData);
    
    // 최대 100개까지만 저장
    if (savedData.length > 100) {
      savedData.shift();
    }
    
    localStorage.setItem('learning_data', JSON.stringify(savedData));
    
    console.log('💾 학습 데이터 저장 완료 (로컬)');
    
  } catch (error) {
    console.error('학습 데이터 저장 실패:', error);
  }
}

/**
 * 간단한 해시 생성
 */
async function generateSimpleHash(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str + Date.now());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}


/**
 * 로컬 모델 전환
 */
async function switchLocalModel(mode) {
  console.log('🔄 로컬 모델 전환:', mode);
  
  if (!window.hybridDetector) {
    toast('AI 분석을 먼저 활성화해주세요', 'warning');
    return;
  }
  
  try {
    await window.hybridDetector.switchLocalMode(mode);
    
    const modeNames = {
      mock: 'Mock 모드',
      clip: 'CLIP 모델',
      mobilenet: 'MobileNet'
    };
    
    toast(`로컬 모델 변경: ${modeNames[mode]}`, 'success');
    localStorage.setItem('local_model_mode', mode);
    
  } catch (error) {
    console.error('모델 전환 실패:', error);
    toast('모델 전환에 실패했습니다', 'error');
  }
}

/**
 * 클라우드 프로바이더 전환
 */
function switchCloudProvider(provider) {
  console.log('🔄 클라우드 프로바이더 전환:', provider);
  
  if (!window.hybridDetector) {
    toast('AI 분석을 먼저 활성화해주세요', 'warning');
    return;
  }
  
  try {
    window.hybridDetector.switchCloudProvider(provider);
    
    const providerNames = {
      gpt4o: 'GPT-4o',
      gemini: 'Gemini Pro Vision',
      claude: 'Claude 3.5 Sonnet'
    };
    
    toast(`클라우드 AI 변경: ${providerNames[provider]}`, 'success');
    localStorage.setItem('cloud_provider', provider);
    
  } catch (error) {
    console.error('프로바이더 전환 실패:', error);
    toast('프로바이더 전환에 실패했습니다', 'error');
  }
}

/**
 * 신뢰도 임계값 표시 업데이트
 */
function updateThresholdDisplay(value) {
  const displayValue = Math.round(value * 100);
  $('#threshold-value').textContent = `${displayValue}%`;
}

/**
 * 신뢰도 임계값 설정
 */
function setConfidenceThreshold(value) {
  console.log('🔧 신뢰도 임계값 설정:', value);
  
  if (!window.hybridDetector) {
    return;
  }
  
  try {
    window.hybridDetector.setConfidenceThreshold(parseFloat(value));
    toast(`임계값 설정: ${Math.round(value * 100)}%`, 'success');
  } catch (error) {
    console.error('임계값 설정 실패:', error);
  }
}


/**
 * AI 통계 새로고침
 */
function refreshAIStats() {
  if (!window.hybridDetector) {
    console.log('ℹ️ AI가 비활성화되어 있습니다');
    return;
  }
  
  const stats = window.hybridDetector.getStats();
  
  $('#stat-total').textContent = `${stats.totalAnalyses}건`;
  $('#stat-local').textContent = `${stats.localOnly}건 (${stats.localPercentage}%)`;
  $('#stat-cloud').textContent = `${stats.cloudCalls}건 (${stats.cloudPercentage}%)`;
  $('#stat-cost').textContent = `$${stats.totalCost.toFixed(4)}`;
  $('#stat-saved').textContent = `$${stats.savedCost.toFixed(4)}`;
  
  console.log('📊 AI 통계 업데이트:', stats);
}

/**
 * AI 통계 초기화
 */
function resetAIStats() {
  if (!confirm('AI 사용 통계를 초기화하시겠습니까?')) {
    return;
  }
  
  if (window.hybridDetector) {
    window.hybridDetector.resetStats();
    refreshAIStats();
    toast('통계가 초기화되었습니다', 'success');
  }
}


/**
 * 모델 설정 로드
 */
function loadModelSettings() {
  // 로컬 모델 설정 로드
  const savedLocalMode = localStorage.getItem('local_model_mode') || 'mock';
  const localSelect = $('#local-model-select');
  if (localSelect) {
    localSelect.value = savedLocalMode;
  }
  
  // 클라우드 프로바이더 설정 로드
  const savedProvider = localStorage.getItem('cloud_provider') || 'gpt4o';
  const providerSelect = $('#cloud-provider-select');
  if (providerSelect) {
    providerSelect.value = savedProvider;
  }
  
  // 신뢰도 임계값 로드
  const savedThreshold = localStorage.getItem('ai_confidence_threshold') || '0.80';
  const thresholdInput = $('#confidence-threshold');
  if (thresholdInput) {
    thresholdInput.value = savedThreshold;
    updateThresholdDisplay(savedThreshold);
  }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Settings Screen Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function showSettings() {
  console.log('⚙️ 설정 화면 표시');
  route('settings');
  
  // AI 설정 상태 로드
  loadAISettings();
  
  // 모델 설정 로드
  loadModelSettings();
  
  // AI 통계 새로고침
  refreshAIStats();
  
  // 푸시 알림 설정 로드
  loadPushNotificationSettings();
  
  // 사용자 메뉴 닫기
  const userMenu = $('#user-menu');
  if (userMenu) {
    userMenu.classList.add('hidden');
  }
}

function loadAISettings() {
  // localStorage에서 AI 설정 로드
  const savedSetting = localStorage.getItem('ENABLE_AI_ANALYSIS');
  const isEnabled = savedSetting === 'true';
  
  // 토글 상태 설정
  const toggle = $('#ai-analysis-toggle');
  if (toggle) {
    toggle.checked = isEnabled;
  }
  
  // 전역 변수 업데이트
  window.ENABLE_AI_ANALYSIS = isEnabled;
  
  // 상태 표시 업데이트
  updateAIStatus(isEnabled);
  
  // 모델 설정 영역 표시/숨김
  const modelSettings = $('#ai-model-settings');
  if (modelSettings) {
    if (isEnabled) {
      modelSettings.style.display = 'block';
    } else {
      modelSettings.style.display = 'none';
    }
  }
  
  // 통계 카드 표시/숨김
  const statsCard = $('#ai-stats-card');
  if (statsCard) {
    if (isEnabled) {
      statsCard.style.display = 'block';
    } else {
      statsCard.style.display = 'none';
    }
  }
  
  console.log('⚙️ AI 설정 로드:', isEnabled ? '활성화' : '비활성화');
}

async function toggleAIAnalysis(enabled) {
  console.log('🔄 AI 분석 토글:', enabled ? 'ON' : 'OFF');
  
  // 전역 변수 업데이트
  window.ENABLE_AI_ANALYSIS = enabled;
  
  // localStorage에 저장
  localStorage.setItem('ENABLE_AI_ANALYSIS', enabled.toString());
  
  // 하이브리드 디텍터 초기화/해제
  if (enabled) {
    if (!window.hybridDetector) {
      try {
        window.hybridDetector = new HybridDetector();
        await window.hybridDetector.initialize();
        console.log('✅ 하이브리드 AI 시스템 활성화');
      } catch (error) {
        console.error('❌ 하이브리드 AI 초기화 실패:', error);
        toast('AI 시스템 초기화 실패', 'error');
        return;
      }
    }
  }
  
  // 상태 표시 업데이트
  updateAIStatus(enabled);
  
  // UI 표시/숨김
  loadAISettings();
  
  // 토스트 메시지
  if (enabled) {
    toast('AI 분석이 활성화되었습니다', 'success');
  } else {
    toast('AI 분석이 비활성화되었습니다', 'info');
  }
}

function updateAIStatus(enabled) {
  const statusDiv = $('#ai-status');
  if (!statusDiv) return;
  
  const indicator = statusDiv.querySelector('.status-indicator');
  const text = statusDiv.querySelector('.status-text');
  
  if (enabled) {
    indicator.classList.remove('offline');
    indicator.classList.add('online');
    text.textContent = '활성화됨';
  } else {
    indicator.classList.remove('online');
    indicator.classList.add('offline');
    text.textContent = '비활성화됨';
  }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Image Compression Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 이미지를 HD 수준으로 압축
 * @param {File} file - 원본 이미지 파일
 * @param {number} maxWidth - 최대 너비 (기본값: 1920)
 * @param {number} maxHeight - 최대 높이 (기본값: 1080)
 * @param {number} quality - JPEG 품질 (0-1, 기본값: 0.85)
 * @returns {Promise<File>} 압축된 이미지 파일
 */
async function compressImage(file, maxWidth = 1920, maxHeight = 1080, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      
      img.onload = () => {
        try {
          // 원본 크기
          const originalWidth = img.width;
          const originalHeight = img.height;
          
          console.log('📐 원본 이미지:', `${originalWidth}x${originalHeight}px`);
          
          // 비율 유지하면서 최대 크기 계산
          let targetWidth = originalWidth;
          let targetHeight = originalHeight;
          
          if (originalWidth > maxWidth || originalHeight > maxHeight) {
            const ratio = Math.min(maxWidth / originalWidth, maxHeight / originalHeight);
            targetWidth = Math.round(originalWidth * ratio);
            targetHeight = Math.round(originalHeight * ratio);
          }
          
          console.log('📐 압축 크기:', `${targetWidth}x${targetHeight}px`);
          
          // Canvas에 이미지 그리기
          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          
          const ctx = canvas.getContext('2d');
          
          // 이미지 품질 향상을 위한 설정
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          
          // 이미지 그리기
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          
          // Blob으로 변환
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('이미지 압축 실패'));
                return;
              }
              
              // File 객체 생성
              const compressedFile = new File(
                [blob],
                file.name,
                {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                }
              );
              
              const originalSize = (file.size / 1024 / 1024).toFixed(2);
              const compressedSize = (compressedFile.size / 1024 / 1024).toFixed(2);
              const reduction = ((1 - compressedFile.size / file.size) * 100).toFixed(1);
              
              console.log('✅ 이미지 압축 완료');
              console.log(`   원본: ${originalSize}MB`);
              console.log(`   압축: ${compressedSize}MB`);
              console.log(`   절감: ${reduction}%`);
              
              resolve(compressedFile);
            },
            'image/jpeg',
            quality
          );
        } catch (error) {
          reject(error);
        }
      };
      
      img.src = e.target.result;
    };
    
    reader.readAsDataURL(file);
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Push Notification Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function loadPushNotificationSettings() {
  if (!window.pushManager) {
    console.warn('⚠️ PushManager not available');
    return;
  }
  
  const status = window.pushManager.getSubscriptionStatus();
  const toggle = document.getElementById('notification-toggle');
  const statusElement = document.getElementById('notification-status');
  
  if (toggle) {
    toggle.checked = status.isSubscribed;
    toggle.disabled = !status.isSupported;
  }
  
  if (statusElement) {
    const statusText = statusElement.querySelector('.status-text');
    const statusIndicator = statusElement.querySelector('.status-indicator');
    
    if (statusText && statusIndicator) {
      if (!status.isSupported) {
        statusText.textContent = '지원하지 않음';
        statusIndicator.className = 'status-indicator offline';
      } else if (status.isSubscribed) {
        statusText.textContent = '활성화됨';
        statusIndicator.className = 'status-indicator online';
      } else {
        statusText.textContent = '비활성화됨';
        statusIndicator.className = 'status-indicator offline';
      }
    }
  }
}

async function togglePushNotifications() {
  if (!window.pushManager) {
    toast('푸시 알림을 지원하지 않는 브라우저입니다', 'error');
    return;
  }
  
  const toggle = document.getElementById('notification-toggle');
  if (!toggle) return;
  
  try {
    if (toggle.checked) {
      await window.pushManager.subscribe();
      toast('✅ 푸시 알림이 활성화되었습니다!', 'success');
    } else {
      await window.pushManager.unsubscribe();
      toast('✅ 푸시 알림이 비활성화되었습니다', 'info');
    }
    
    // UI 업데이트
    loadPushNotificationSettings();
    
  } catch (error) {
    console.error('❌ Push notification toggle failed:', error);
    toast('푸시 알림 설정에 실패했습니다', 'error');
    
    // 토글 상태 복원
    toggle.checked = !toggle.checked;
  }
}

async function sendTestNotification() {
  if (!window.pushManager) {
    toast('푸시 알림을 지원하지 않는 브라우저입니다', 'error');
    return;
  }
  
  const status = window.pushManager.getSubscriptionStatus();
  if (!status.isSubscribed) {
    toast('푸시 알림을 먼저 활성화해주세요', 'warning');
    return;
  }
  
  try {
    await window.pushManager.sendTestNotification();
    toast('✅ 테스트 알림을 발송했습니다!', 'success');
  } catch (error) {
    console.error('❌ Test notification failed:', error);
    toast('테스트 알림 발송에 실패했습니다', 'error');
  }
}

