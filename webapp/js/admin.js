// Admin Dashboard JavaScript
const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

// API Base URL
const isLocalDev =
  window.location.protocol === 'file:' ||
  !window.location.hostname ||
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1';
const API_BASE = isLocalDev
  ? 'http://localhost:3000'
  : 'https://insighti-app-new.onrender.com';

// Admin State
const AdminState = {
  token: null,
  admin: null,
  currentUserId: null,
  currentDefectId: null,
  resolutionPhotos: []
};

// API 헬퍼
async function apiCall(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (AdminState.token) {
    headers['Authorization'] = `Bearer ${AdminState.token}`;
  } else {
    console.warn('⚠️ AdminState.token이 없습니다:', endpoint);
  }
  
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });
    
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
      }
      
      // 403 에러인 경우 토큰 만료 가능성 - 재로그인 유도
      if (response.status === 403 && endpoint !== '/api/admin/login') {
        console.error('❌ 인증 실패 (403): 토큰이 만료되었거나 유효하지 않습니다.', {
          endpoint,
          hasToken: !!AdminState.token,
          tokenLength: AdminState.token?.length
        });
        
        // 토큰 만료 시 로그인 화면으로 이동
        if (errorData.error === 'Invalid or expired token' || 
            errorData.error === 'Admin access required') {
          AdminState.token = null;
          AdminState.admin = null;
          localStorage.removeItem('admin_token');
          localStorage.removeItem('admin_info');
          
          $('#login-screen').classList.remove('hidden');
          $('#admin-dashboard').classList.add('hidden');
          toast('세션이 만료되었습니다. 다시 로그인해주세요.', 'error');
          throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
        }
      }
      
      const errorMessage = errorData.error || errorData.details || errorData.message || 'API 요청 실패';
      console.error('❌ API 호출 실패:', {
        endpoint,
        status: response.status,
        statusText: response.statusText,
        error: errorMessage
      });
      throw new Error(errorMessage);
    }
    
    return await response.json();
  } catch (error) {
    if (error.message) {
      throw error;
    }
    console.error('❌ API 호출 중 예외 발생:', error);
    throw new Error('네트워크 오류가 발생했습니다.');
  }
}

// Toast 메시지
function toast(message, type = 'info') {
  const toastEl = $('#toast');
  toastEl.textContent = message;
  toastEl.className = 'toast show';
  
  if (type === 'success') {
    toastEl.style.background = '#27ae60';
  } else if (type === 'error') {
    toastEl.style.background = '#e74c3c';
  } else {
    toastEl.style.background = '#2c3e50';
  }
  
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 3000);
}

// 로그인
async function adminLogin() {
  const email = $('#admin-email').value.trim();
  const password = $('#admin-password').value;
  
  if (!email || !password) {
    toast('이메일과 비밀번호를 입력하세요', 'error');
    return;
  }
  
  try {
    const result = await apiCall('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    
    AdminState.token = result.token;
    AdminState.admin = result.admin;
    
    localStorage.setItem('admin_token', result.token);
    localStorage.setItem('admin_info', JSON.stringify(result.admin));
    
    $('#login-screen').classList.add('hidden');
    $('#admin-dashboard').classList.remove('hidden');
    $('#admin-name').textContent = result.admin.name;
    
    toast('로그인 성공!', 'success');
    
    // 대시보드 로드
    showScreen('dashboard');
    loadDashboardStats();
    loadAISettings();
    
    // 관리자 푸시 알림 자동 활성화
    await enableAdminPushNotifications();
    
  } catch (error) {
    console.error('Login error:', error);
    toast(error.message || '로그인 실패', 'error');
  }
}

// 관리자 푸시 알림 자동 활성화
async function enableAdminPushNotifications() {
  // 푸시 알림이 지원되지 않으면 스킵
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('⚠️ 푸시 알림을 지원하지 않는 브라우저입니다.');
    updatePushNotificationStatus('not-supported', '브라우저가 푸시 알림을 지원하지 않습니다.');
    return;
  }

  try {
    // Service Worker 등록 (메인 앱의 Service Worker 사용)
    let registration;
    try {
      registration = await navigator.serviceWorker.register('/sw.js');
      console.log('✅ Service Worker 등록 완료');
    } catch (error) {
      // 이미 등록되어 있으면 기존 등록 사용
      registration = await navigator.serviceWorker.ready;
      console.log('ℹ️ 기존 Service Worker 사용');
    }

    // 기존 구독 확인
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
      // 이미 구독되어 있으면 서버에 전송만
      await sendAdminSubscriptionToServer(existingSubscription);
      console.log('✅ 기존 푸시 구독 확인됨');
      updatePushNotificationStatus('active', '푸시 알림이 활성화되어 있습니다.');
      return;
    }

    // VAPID 공개키 가져오기
    const vapidKeyResponse = await fetch(`${API_BASE}/api/push/vapid-key`);
    const { publicKey } = await vapidKeyResponse.json();

    // 알림 권한 확인
    let permission = Notification.permission;
    if (permission === 'default') {
      // 권한이 아직 요청되지 않았으면 요청
      permission = await Notification.requestPermission();
    }
    
    if (permission !== 'granted') {
      console.log('⚠️ 알림 권한이 거부되었습니다.');
      updatePushNotificationStatus('permission-denied', '알림 권한이 필요합니다. 브라우저 설정에서 알림 권한을 허용해주세요.');
      return;
    }

    // urlBase64ToUint8Array 함수
    function urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - base64String.length % 4) % 4);
      const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    }

    // 푸시 구독 생성
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    console.log('✅ 푸시 구독 생성 완료');

    // 서버에 구독 정보 전송
    await sendAdminSubscriptionToServer(subscription);
    console.log('✅ 관리자 푸시 알림이 자동으로 활성화되었습니다.');
    updatePushNotificationStatus('active', '푸시 알림이 활성화되었습니다.');

  } catch (error) {
    console.error('❌ 관리자 푸시 알림 활성화 실패:', error);
    const errorMessage = error.message || '알 수 없는 오류가 발생했습니다.';
    updatePushNotificationStatus('error', `활성화 실패: ${errorMessage}`);
    // 실패해도 로그인은 계속 진행되도록 에러를 무시
  }
}

// 푸시 알림 상태 확인
async function checkPushNotificationStatus() {
  const statusEl = document.getElementById('push-notification-status');
  if (!statusEl) return;

  statusEl.innerHTML = '<p class="text-muted">확인 중...</p>';

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    updatePushNotificationStatus('not-supported', '브라우저가 푸시 알림을 지원하지 않습니다.');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const permission = Notification.permission;

    if (subscription && permission === 'granted') {
      // 서버에 구독 정보 전송 (확인)
      await sendAdminSubscriptionToServer(subscription);
      updatePushNotificationStatus('active', '푸시 알림이 활성화되어 있습니다.');
    } else if (permission === 'denied') {
      updatePushNotificationStatus('permission-denied', '알림 권한이 거부되었습니다. 브라우저 설정에서 알림 권한을 허용해주세요.');
    } else {
      updatePushNotificationStatus('inactive', '푸시 알림이 활성화되지 않았습니다.');
    }
  } catch (error) {
    console.error('푸시 알림 상태 확인 실패:', error);
    updatePushNotificationStatus('error', `상태 확인 실패: ${error.message}`);
  }
}

// 푸시 알림 상태 UI 업데이트
function updatePushNotificationStatus(status, message) {
  const statusEl = document.getElementById('push-notification-status');
  if (!statusEl) return;

  let html = '';
  let buttonHtml = '';

  switch (status) {
    case 'active':
      html = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
          <span style="color: #27ae60; font-size: 20px;">✅</span>
          <span style="color: #27ae60; font-weight: bold;">활성화됨</span>
        </div>
        <p style="color: #666; margin: 0;">${message}</p>
      `;
      buttonHtml = '<button class="btn btn-secondary btn-small" onclick="checkPushNotificationStatus()">새로고침</button>';
      break;
    case 'inactive':
      html = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
          <span style="color: #e74c3c; font-size: 20px;">❌</span>
          <span style="color: #e74c3c; font-weight: bold;">비활성화됨</span>
        </div>
        <p style="color: #666; margin: 0 0 15px 0;">${message}</p>
      `;
      buttonHtml = '<button class="btn btn-primary btn-small" onclick="enableAdminPushNotifications()">푸시 알림 활성화</button>';
      break;
    case 'permission-denied':
      html = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
          <span style="color: #f39c12; font-size: 20px;">⚠️</span>
          <span style="color: #f39c12; font-weight: bold;">권한 필요</span>
        </div>
        <p style="color: #666; margin: 0 0 15px 0;">${message}</p>
      `;
      buttonHtml = '<button class="btn btn-primary btn-small" onclick="enableAdminPushNotifications()">다시 시도</button>';
      break;
    case 'not-supported':
      html = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
          <span style="color: #95a5a6; font-size: 20px;">ℹ️</span>
          <span style="color: #95a5a6; font-weight: bold;">지원 안 됨</span>
        </div>
        <p style="color: #666; margin: 0;">${message}</p>
      `;
      break;
    case 'error':
      html = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
          <span style="color: #e74c3c; font-size: 20px;">❌</span>
          <span style="color: #e74c3c; font-weight: bold;">오류</span>
        </div>
        <p style="color: #666; margin: 0 0 15px 0;">${message}</p>
      `;
      buttonHtml = '<button class="btn btn-primary btn-small" onclick="enableAdminPushNotifications()">다시 시도</button>';
      break;
    default:
      html = `<p class="text-muted">${message}</p>`;
  }

  statusEl.innerHTML = html + (buttonHtml ? `<div style="margin-top: 15px;">${buttonHtml}</div>` : '');
}

// 관리자 푸시 구독 정보를 서버에 전송
async function sendAdminSubscriptionToServer(subscription) {
  try {
    const response = await fetch(`${API_BASE}/api/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AdminState.token}`
      },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: '구독 등록 실패' }));
      const errorMessage = errorData.error || errorData.message || '구독 등록 실패';
      throw new Error(errorMessage);
    }

    console.log('✅ 관리자 푸시 구독이 서버에 등록되었습니다.');
  } catch (error) {
    console.error('❌ 서버에 구독 정보 전송 실패:', error);
    throw error;
  }
}

// 로그아웃
function adminLogout() {
  if (!confirm('로그아웃하시겠습니까?')) return;
  
  AdminState.token = null;
  AdminState.admin = null;
  
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_info');
  
  $('#admin-dashboard').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  
  $('#admin-email').value = '';
  $('#admin-password').value = '';
}

// 화면 전환
function showScreen(screenName) {
  console.log(`🖥️ 화면 전환: ${screenName}`);
  
  const targetScreenId = `screen-${screenName}`;
  
  // 선택된 화면을 제외하고 모든 화면 숨기기
  const allScreens = $$('.screen');
  console.log(`📋 총 ${allScreens.length}개의 화면 발견`);
  
  allScreens.forEach(s => {
    // 선택된 화면은 제외
    if (s.id === targetScreenId) {
      return;
    }
    
    const screenId = s.id;
    // hidden 클래스 추가
    s.classList.add('hidden');
    // CSS도 강제로 숨김 (important 우선순위 문제 해결)
    s.style.display = 'none';
    s.style.visibility = 'hidden';
    s.style.opacity = '0';
    
    console.log(`🔒 화면 숨김: ${screenId}`, {
      hasHidden: s.classList.contains('hidden'),
      inlineDisplay: s.style.display
    });
  });
  
  // 선택된 화면 표시
  const targetScreen = $(`#${targetScreenId}`);
  if (!targetScreen) {
    console.error(`❌ 화면을 찾을 수 없습니다: ${targetScreenId}`);
    return;
  }
  
  // hidden 클래스 제거
  targetScreen.classList.remove('hidden');
  
  // CSS도 강제로 표시 (important 우선순위 문제 해결)
  targetScreen.style.display = 'block';
  targetScreen.style.visibility = 'visible';
  targetScreen.style.opacity = '1';
  targetScreen.style.width = '100%';
  targetScreen.style.minHeight = '500px';
  targetScreen.style.position = 'relative';
  targetScreen.style.top = '0';
  targetScreen.style.left = '0';
  
  console.log(`🔧 화면 CSS 강제 설정:`, {
    id: targetScreen.id,
    className: targetScreen.className,
    display: targetScreen.style.display,
    hasHidden: targetScreen.classList.contains('hidden')
  });
  
  // 화면을 보이도록 스크롤 (즉시 실행)
  setTimeout(() => {
    const rect = targetScreen.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    
    console.log('🔍 화면 위치 확인:', {
      top: rect.top,
      viewportHeight: viewportHeight,
      needsScroll: rect.top < 0 || rect.top > viewportHeight
    });
    
    if (rect.top < 0 || rect.top > viewportHeight) {
      console.log('🔍 화면이 보이지 않는 위치에 있습니다. 스크롤합니다.');
      
      // 여러 방법으로 스크롤 시도
      targetScreen.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
      
      // main-content도 스크롤
      const mainContent = targetScreen.closest('.main-content');
      if (mainContent) {
        mainContent.scrollTop = 0;
        console.log('🔍 main-content 스크롤 초기화');
      }
      
      // window도 스크롤
      window.scrollTo({ top: 0, behavior: 'auto' });
      
      // 다시 확인
      setTimeout(() => {
        const newRect = targetScreen.getBoundingClientRect();
        console.log('🔍 스크롤 후 위치:', {
          top: newRect.top,
          isVisible: newRect.top >= 0 && newRect.top < viewportHeight
        });
      }, 50);
    }
  }, 50);
  
  // 다른 화면이 여전히 보이는지 확인
  const visibleScreens = Array.from($$('.screen')).filter(s => {
    if (s.id === targetScreenId) return false; // 선택된 화면은 제외
    const style = window.getComputedStyle(s);
    return style.display !== 'none' && !s.classList.contains('hidden');
  });
  
  if (visibleScreens.length > 0) {
    console.warn(`⚠️ ${visibleScreens.length}개의 다른 화면이 여전히 보입니다:`, 
      visibleScreens.map(s => s.id));
    // 강제로 숨김
    visibleScreens.forEach(s => {
      s.classList.add('hidden');
      s.style.display = 'none';
      s.style.visibility = 'hidden';
      s.style.opacity = '0';
      console.log(`🔒 추가로 숨김: ${s.id}`);
    });
  }
  
  // admin-dashboard가 숨겨져 있으면 표시
  const adminDashboard = $('#admin-dashboard');
  if (adminDashboard && adminDashboard.classList.contains('hidden')) {
    console.log('⚠️ admin-dashboard가 숨겨져 있습니다. 표시합니다.');
    adminDashboard.classList.remove('hidden');
    adminDashboard.style.display = 'flex';
  }
  
  // 즉시 확인
  const computedStyle = window.getComputedStyle(targetScreen);
  const rect = targetScreen.getBoundingClientRect();
  
  console.log(`✅ 화면 표시됨: screen-${screenName}`, {
    hasHidden: targetScreen.classList.contains('hidden'),
    inlineDisplay: targetScreen.style.display,
    computedDisplay: computedStyle.display,
    visible: targetScreen.offsetParent !== null,
    rect: {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left
    },
    parentVisible: adminDashboard ? !adminDashboard.classList.contains('hidden') : 'N/A',
    parentOffsetParent: adminDashboard ? adminDashboard.offsetParent !== null : 'N/A'
  });
  
  // 메뉴 활성화
  $$('.menu-item').forEach(m => m.classList.remove('active'));
  if (typeof event !== 'undefined' && event?.currentTarget) {
    event.currentTarget.classList.add('active');
  } else {
    const menuItem = Array.from($$('.menu-item')).find(m => {
      const handler = m.getAttribute('onclick') || '';
      return handler.includes(`showScreen('${screenName}')`);
    });
    if (menuItem) {
      menuItem.classList.add('active');
    }
  }
  
  // 데이터 로드
  if (screenName === 'dashboard') {
    loadDashboardStats();
  } else if (screenName === 'users') {
    loadUsers();
  } else if (screenName === 'inspectors') {
    loadInspectorRegistrations();
  } else if (screenName === 'defects') {
    loadDefects();
  } else if (screenName === 'ai-settings') {
    // 화면이 완전히 표시된 후 설정 로드
    setTimeout(() => {
      loadAISettings();
    }, 50);
  }
}

// 대시보드 통계 로드
async function loadDashboardStats() {
  try {
    const stats = await apiCall('/api/admin/dashboard/stats');
    
    $('#stat-users').textContent = stats.total_users || 0;
    $('#stat-defects').textContent = stats.total_defects || 0;
    $('#stat-pending').textContent = stats.pending_defects || 0;
    $('#stat-resolved').textContent = stats.total_resolutions || 0;
    
    // 최근 하자 로드
    loadRecentDefects();
    
  } catch (error) {
    console.error('Load stats error:', error);
    toast('통계 로드 실패', 'error');
  }
}

// 최근 하자 목록
async function loadRecentDefects() {
  try {
    const result = await apiCall('/api/admin/defects?limit=5');
    
    const container = $('#recent-defects');
    
    if (!result.defects || result.defects.length === 0) {
      container.innerHTML = '<p class="text-muted">등록된 하자가 없습니다</p>';
      return;
    }
    
    container.innerHTML = result.defects.map(d => `
      <div style="padding: 10px 0; border-bottom: 1px solid #ecf0f1;">
        <div><strong>${d.location} - ${d.trade}</strong></div>
        <div style="font-size: 13px; color: #7f8c8d;">
          ${d.complex_name} ${d.dong}동 ${d.ho}호 (${d.resident_name})
        </div>
        <div style="font-size: 12px; color: #95a5a6;">
          ${new Date(d.created_at).toLocaleDateString('ko-KR')}
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('Load recent defects error:', error);
  }
}

// 사용자 목록 로드
async function loadUsers() {
  try {
    const result = await apiCall('/api/admin/users?limit=100');
    
    const tbody = $('#users-tbody');
    
    if (!result.users || result.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">등록된 사용자가 없습니다</td></tr>';
      return;
    }
    
    tbody.innerHTML = result.users.map(u => `
      <tr>
        <td>${u.id}</td>
        <td>${u.complex_name}</td>
        <td>${u.dong}</td>
        <td>${u.ho}</td>
        <td>${u.resident_name}</td>
        <td>${u.phone}</td>
        <td>${u.total_defects || 0}건</td>
        <td>
          <button class="btn btn-primary btn-small" onclick="editUser(${u.id})">수정</button>
          <button class="btn btn-secondary btn-small" onclick="manageTokens(${u.id})">토큰</button>
        </td>
      </tr>
    `).join('');
    
  } catch (error) {
    console.error('Load users error:', error);
    toast('사용자 목록 로드 실패', 'error');
  }
}

// 사용자 검색
async function searchUsers() {
  const search = $('#user-search').value.trim();
  
  try {
    const result = await apiCall(`/api/admin/users?search=${encodeURIComponent(search)}&limit=100`);
    
    const tbody = $('#users-tbody');
    tbody.innerHTML = result.users.map(u => `
      <tr>
        <td>${u.id}</td>
        <td>${u.complex_name}</td>
        <td>${u.dong}</td>
        <td>${u.ho}</td>
        <td>${u.resident_name}</td>
        <td>${u.phone}</td>
        <td>${u.total_defects || 0}건</td>
        <td>
          <button class="btn btn-primary btn-small" onclick="editUser(${u.id})">수정</button>
        </td>
      </tr>
    `).join('');
    
  } catch (error) {
    console.error('Search users error:', error);
  }
}

// 사용자 수정
async function editUser(userId) {
  try {
    const user = await apiCall(`/api/admin/users/${userId}`);
    
    AdminState.currentUserId = userId;
    
    $('#modal-complex').value = user.complex_name;
    $('#modal-dong').value = user.dong;
    $('#modal-ho').value = user.ho;
    $('#modal-name').value = user.resident_name;
    $('#modal-phone').value = user.phone;
    
    $('#user-modal').classList.add('show');
    
  } catch (error) {
    console.error('Load user error:', error);
    toast('사용자 정보 로드 실패', 'error');
  }
}

function closeUserModal() {
  $('#user-modal').classList.remove('show');
  AdminState.currentUserId = null;
}

async function saveUser() {
  if (!AdminState.currentUserId) return;
  
  const name = $('#modal-name').value.trim();
  const phone = $('#modal-phone').value.trim();
  
  try {
    await apiCall(`/api/admin/users/${AdminState.currentUserId}`, {
      method: 'PUT',
      body: JSON.stringify({ resident_name: name, phone })
    });
    
    toast('사용자 정보 수정 완료', 'success');
    closeUserModal();
    loadUsers();
    
  } catch (error) {
    console.error('Save user error:', error);
    toast(error.message || '사용자 정보 수정 실패', 'error');
  }
}

// 토큰 관리
async function manageTokens(userId) {
  if (!confirm('이 세대에 새 토큰을 발급하시겠습니까? (30일 유효)')) return;
  
  try {
    await apiCall(`/api/admin/users/${userId}/tokens`, {
      method: 'POST',
      body: JSON.stringify({ days: 30 })
    });
    
    toast('토큰 발급 완료', 'success');
    
  } catch (error) {
    console.error('Token error:', error);
    toast('토큰 발급 실패', 'error');
  }
}

// 하자 목록 로드
async function loadDefects() {
  try {
    const result = await apiCall('/api/admin/defects?limit=100');
    
    const tbody = $('#defects-tbody');
    
    if (!result.defects || result.defects.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">등록된 하자가 없습니다</td></tr>';
      return;
    }
    
    tbody.innerHTML = result.defects.map(d => `
      <tr>
        <td style="font-size: 11px;">${d.id}</td>
        <td>${d.complex_name}</td>
        <td>${d.dong}-${d.ho}</td>
        <td>${d.location}</td>
        <td>${d.trade}</td>
        <td>${new Date(d.created_at).toLocaleDateString('ko-KR')}</td>
        <td>
          ${d.resolution_id 
            ? '<span class="badge badge-success">처리완료</span>' 
            : '<span class="badge badge-warning">미처리</span>'}
        </td>
        <td>
          <button class="btn btn-primary btn-small" onclick="openResolutionModal('${d.id}')">처리등록</button>
        </td>
      </tr>
    `).join('');
    
  } catch (error) {
    console.error('Load defects error:', error);
    toast('하자 목록 로드 실패', 'error');
  }
}

// AI 설정 로드
async function loadAISettings() {
  console.log('🔍 loadAISettings() 호출됨');
  
  // admin-dashboard가 숨겨져 있으면 표시
  const adminDashboard = $('#admin-dashboard');
  if (adminDashboard && adminDashboard.classList.contains('hidden')) {
    console.log('⚠️ admin-dashboard가 숨겨져 있습니다. 표시합니다.');
    adminDashboard.classList.remove('hidden');
    adminDashboard.style.display = 'flex';
  }
  
  // 화면이 보이는지 확인하고, 안 보이면 잠시 대기
  const screenEl = document.getElementById('screen-ai-settings');
  console.log('📺 화면 요소:', screenEl ? '존재' : '없음');
  
  if (!screenEl) {
    console.error('❌ screen-ai-settings 요소를 찾을 수 없습니다.');
    return;
  }
  
  // 강제로 표시 (showScreen에서 설정했지만 다시 확인)
  // 먼저 모든 .screen 요소를 확인하고 hidden 제거
  $$('.screen').forEach(s => {
    if (s.id === 'screen-ai-settings') {
      s.classList.remove('hidden');
      s.style.display = 'block';
      s.style.visibility = 'visible';
      s.style.opacity = '1';
      s.style.width = '100%';
      s.style.minHeight = '500px';
      console.log('✅ screen-ai-settings 강제 표시 완료');
    } else {
      // 다른 화면은 확실히 숨김
      s.classList.add('hidden');
      s.style.display = 'none';
    }
  });
  
  console.log('🔧 loadAISettings에서 화면 강제 표시:', {
    hasHidden: screenEl.classList.contains('hidden'),
    inlineDisplay: screenEl.style.display,
    computedDisplay: window.getComputedStyle(screenEl).display,
    allScreens: Array.from($$('.screen')).map(s => ({
      id: s.id,
      hasHidden: s.classList.contains('hidden'),
      display: window.getComputedStyle(s).display
    }))
  });
  
  // 부모 요소도 확인
  if (screenEl.offsetParent === null && adminDashboard) {
    const screenStyle = window.getComputedStyle(screenEl);
    const mainContent = screenEl.closest('.main-content');
    const mainContentStyle = mainContent ? window.getComputedStyle(mainContent) : null;
    
    console.warn('⚠️ 화면이 보이지 않습니다. CSS 상태 확인:', {
      screenHidden: screenEl.classList.contains('hidden'),
      screenDisplay: screenStyle.display,
      screenVisibility: screenStyle.visibility,
      screenPosition: screenStyle.position,
      screenOpacity: screenStyle.opacity,
      screenWidth: screenStyle.width,
      screenHeight: screenStyle.height,
      parentHidden: adminDashboard.classList.contains('hidden'),
      parentDisplay: window.getComputedStyle(adminDashboard).display,
      mainContentDisplay: mainContentStyle?.display,
      mainContentVisibility: mainContentStyle?.visibility,
      mainContentWidth: mainContentStyle?.width,
      mainContentHeight: mainContentStyle?.height,
      mainContentPosition: mainContentStyle?.position,
      screenRect: screenEl.getBoundingClientRect(),
      mainContentRect: mainContent?.getBoundingClientRect()
    });
    
    // CSS 강제 설정
    if (screenStyle.display === 'none') {
      console.log('🔧 display: none을 block으로 변경');
      screenEl.style.display = 'block';
    }
    if (screenStyle.visibility === 'hidden') {
      console.log('🔧 visibility: hidden을 visible로 변경');
      screenEl.style.visibility = 'visible';
    }
    if (screenStyle.opacity === '0') {
      console.log('🔧 opacity: 0을 1로 변경');
      screenEl.style.opacity = '1';
    }
    
    // main-content도 확인
    if (mainContent) {
      const mcStyle = window.getComputedStyle(mainContent);
      if (mcStyle.display === 'none') {
        console.log('🔧 main-content display: none을 block으로 변경');
        mainContent.style.display = 'block';
      }
      if (mcStyle.visibility === 'hidden') {
        console.log('🔧 main-content visibility: hidden을 visible로 변경');
        mainContent.style.visibility = 'visible';
      }
    }
    
    // 강제로 표시
    adminDashboard.classList.remove('hidden');
    screenEl.classList.remove('hidden');
    
    // position을 명시적으로 설정 (offsetParent 문제 해결)
    if (screenStyle.position === 'static' || screenStyle.position === '') {
      console.log('🔧 position을 relative로 설정');
      screenEl.style.position = 'relative';
    }
    
    // 다시 확인
    const newStyle = window.getComputedStyle(screenEl);
    const newRect = screenEl.getBoundingClientRect();
    const parentRect = adminDashboard.getBoundingClientRect();
    
    console.log('✅ 수정 후 상태:', {
      display: newStyle.display,
      visibility: newStyle.visibility,
      position: newStyle.position,
      offsetParent: screenEl.offsetParent !== null,
      screenRect: {
        top: newRect.top,
        left: newRect.left,
        width: newRect.width,
        height: newRect.height
      },
      parentRect: {
        top: parentRect.top,
        left: parentRect.left,
        width: parentRect.width,
        height: parentRect.height
      }
    });
    
    // 실제로 화면이 보이는지 확인
    console.log('🔍 화면 크기 확인:', {
      width: newRect.width,
      height: newRect.height,
      top: newRect.top,
      left: newRect.left
    });
    
    if (newRect.width > 0 && newRect.height > 0) {
      console.log('✅ 화면이 실제로 렌더링되고 있습니다!');
    } else {
      console.error('❌ 화면 크기가 0입니다. 레이아웃 문제가 있을 수 있습니다.');
      console.log('🔧 화면 크기를 강제로 설정합니다...');
      
      // 다른 화면과 비교
      const dashboardScreen = document.getElementById('screen-dashboard');
      if (dashboardScreen) {
        const dashRect = dashboardScreen.getBoundingClientRect();
        console.log('📊 대시보드 화면 크기 (비교용):', {
          width: dashRect.width,
          height: dashRect.height,
          hidden: dashboardScreen.classList.contains('hidden')
        });
      }
      
      // 강제로 크기 설정 시도
      const mainContent = screenEl.closest('.main-content');
      if (mainContent) {
        const mcStyle = window.getComputedStyle(mainContent);
        const mcRect = mainContent.getBoundingClientRect();
        console.log('📐 main-content 상태:', {
          width: mcRect.width,
          height: mcRect.height,
          display: mcStyle.display,
          marginLeft: mcStyle.marginLeft,
          padding: mcStyle.padding
        });
        
        // main-content가 보이지 않으면 강제로 표시
        if (mcRect.width === 0 || mcRect.height === 0) {
          console.log('🔧 main-content 크기가 0입니다. 강제로 설정합니다.');
          mainContent.style.display = 'block';
          mainContent.style.width = 'calc(100% - 250px)';
          mainContent.style.minHeight = '100vh';
          mainContent.style.marginLeft = '250px';
          mainContent.style.padding = '20px';
        }
      }
      
      // screen 요소도 강제로 크기 설정
      console.log('🔧 screen 요소에 강제 크기 설정');
      screenEl.style.width = '100%';
      screenEl.style.minHeight = '500px';
      screenEl.style.display = 'block';
      screenEl.style.position = 'relative';
      
      // 부모 요소들도 확인
      let parent = screenEl.parentElement;
      let level = 0;
      console.log('🔍 screen-ai-settings 직접 확인:', {
        id: screenEl.id,
        className: screenEl.className,
        hasHidden: screenEl.classList.contains('hidden'),
        inlineDisplay: screenEl.style.display,
        computedDisplay: window.getComputedStyle(screenEl).display,
        rect: screenEl.getBoundingClientRect(),
        parentElement: parent ? {
          tagName: parent.tagName,
          id: parent.id,
          className: parent.className
        } : 'null'
      });
      
      // screen-ai-settings가 다른 screen 요소 안에 있는지 확인
      const parentScreen = screenEl.closest('.screen');
      if (parentScreen && parentScreen.id !== 'screen-ai-settings') {
        console.error(`❌ screen-ai-settings가 다른 screen 요소 (${parentScreen.id}) 안에 있습니다!`);
        console.log('🔧 screen-ai-settings를 .main-content로 직접 이동합니다.');
        const mainContent = document.querySelector('.main-content');
        if (mainContent && parentScreen) {
          // screen-ai-settings를 parentScreen에서 분리
          const aiSettingsClone = screenEl.cloneNode(true);
          screenEl.remove();
          mainContent.appendChild(aiSettingsClone);
          console.log('✅ screen-ai-settings를 .main-content로 이동했습니다.');
          // 새로운 요소 참조로 업데이트
          const newScreenEl = document.getElementById('screen-ai-settings');
          if (newScreenEl) {
            newScreenEl.classList.remove('hidden');
            newScreenEl.style.display = 'block';
            newScreenEl.style.visibility = 'visible';
            newScreenEl.style.opacity = '1';
            newScreenEl.style.width = '100%';
            newScreenEl.style.minHeight = '500px';
            console.log('✅ 새로운 위치에서 화면 표시 완료');
          }
        }
      }
      
      while (parent && level < 5) {
        const pStyle = window.getComputedStyle(parent);
        const pRect = parent.getBoundingClientRect();
        console.log(`📦 부모 요소 ${level} (${parent.tagName}.${parent.className || '(no class)'}):`, {
          id: parent.id || '(no id)',
          display: pStyle.display,
          width: pRect.width,
          height: pRect.height,
          hasHidden: parent.classList ? parent.classList.contains('hidden') : false
        });
        
        // 부모가 screen이고 hidden이면 강제로 표시하지 않음 (다른 화면이므로)
        if (parent.classList && parent.classList.contains('hidden') && !parent.classList.contains('screen')) {
          console.log(`🔧 부모 요소 ${level}가 hidden입니다. 강제로 표시합니다.`);
          parent.classList.remove('hidden');
          if (parent.classList.contains('main-content')) {
            parent.style.display = 'block';
          } else if (parent.id === 'admin-dashboard') {
            parent.style.display = 'flex';
          }
        }
        
        parent = parent.parentElement;
        level++;
      }
      
      // 다시 확인
      setTimeout(() => {
        const finalRect = screenEl.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        
        console.log('🔍 최종 크기 (100ms 후):', {
          width: finalRect.width,
          height: finalRect.height,
          top: finalRect.top,
          left: finalRect.left,
          viewport: {
            width: viewportWidth,
            height: viewportHeight
          },
          isVisible: finalRect.top >= 0 && finalRect.top < viewportHeight && 
                    finalRect.left >= 0 && finalRect.left < viewportWidth
        });
        
        if (finalRect.width > 0 && finalRect.height > 0) {
          console.log('✅ 강제 설정 후 화면이 렌더링되었습니다!');
          
          // 화면이 뷰포트 밖에 있으면 스크롤
          if (finalRect.top < 0 || finalRect.top > viewportHeight || 
              finalRect.left < 0 || finalRect.left > viewportWidth) {
            console.log('🔍 화면이 뷰포트 밖에 있습니다. 강제로 스크롤합니다.');
            
            // 여러 방법으로 스크롤 시도
            screenEl.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
            
            // main-content도 스크롤
            const mainContent = screenEl.closest('.main-content');
            if (mainContent) {
              // main-content의 스크롤 위치 계산
              const mainContentRect = mainContent.getBoundingClientRect();
              const targetTop = finalRect.top - mainContentRect.top;
              mainContent.scrollTop = Math.max(0, targetTop - 20); // 20px 여유
              console.log('🔍 main-content 스크롤:', {
                scrollTop: mainContent.scrollTop,
                targetTop: targetTop
              });
            }
            
            // window도 스크롤
            window.scrollTo({ top: 0, behavior: 'auto' });
            
            // 다시 확인
            setTimeout(() => {
              const afterScrollRect = screenEl.getBoundingClientRect();
              console.log('🔍 스크롤 후 최종 위치:', {
                top: afterScrollRect.top,
                left: afterScrollRect.left,
                isVisible: afterScrollRect.top >= 0 && afterScrollRect.top < viewportHeight &&
                          afterScrollRect.left >= 0 && afterScrollRect.left < viewportWidth
              });
            }, 100);
          } else {
            console.log('✅ 화면이 뷰포트 내에 있습니다.');
          }
        } else {
          console.error('❌ 여전히 화면 크기가 0입니다. 추가 조사가 필요합니다.');
        }
      }, 100);
    }
  }

  const modeSelect = document.getElementById('ai-mode');
  console.log('📋 modeSelect 요소:', modeSelect ? '존재' : '없음');
  
  if (!modeSelect) {
    console.error('❌ AI 설정 화면 요소를 찾을 수 없습니다.');
    console.error('🔍 현재 DOM 상태:', {
      screenVisible: !screenEl.classList.contains('hidden'),
      screenHTML: screenEl.innerHTML.substring(0, 200)
    });
    return;
  }

  try {
    console.log('🔍 AI 설정 로드 시작...');
    const result = await apiCall('/api/ai-detection/settings');
    console.log('📥 AI 설정 응답:', result);
    
    if (!result || !result.success) {
      const errorMsg = result?.error || result?.details || '설정 정보를 불러오지 못했습니다.';
      console.error('❌ AI 설정 로드 실패:', errorMsg);
      throw new Error(errorMsg);
    }

    const settings = result.settings || {};
    console.log('📋 설정 값:', settings);

    // 각 요소가 존재하는지 확인하고 값 설정
    const setValue = (selector, value) => {
      const el = $(selector);
      if (el) {
        el.value = value;
        console.log(`✅ ${selector} = ${value}`);
      } else {
        console.warn(`⚠️ 요소를 찾을 수 없습니다: ${selector}`);
      }
    };

    // 설정 값 적용
    console.log('📝 설정 값 적용 시작...');
    setValue('#ai-mode', settings.mode || 'hybrid');
    setValue('#ai-provider', settings.provider || 'azure');
    setValue('#ai-local-enabled', String(settings.localEnabled ?? true));
    setValue('#ai-azure-enabled', String(settings.azureEnabled ?? true));
    const hfEnabled = settings.huggingfaceEnabled;
    setValue('#ai-hf-enabled', String(hfEnabled ?? (settings.provider === 'huggingface')));
    setValue('#ai-hf-model', settings.huggingfaceModel || 'microsoft/resnet-50');
    setValue('#ai-azure-threshold', (settings.azureFallbackThreshold ?? 0.8).toFixed(2));
    setValue('#ai-local-confidence', (settings.localBaseConfidence ?? 0.65).toFixed(2));
    setValue('#ai-max-detections', settings.maxDetections ?? 3);
    setValue('#ai-hf-task', settings.huggingfaceTask || 'image-classification');
    setValue('#ai-hf-prompt', 
      settings.huggingfacePrompt ||
      'Describe any building defects such as cracks, water leaks, mold, or safety issues in this photo.');
    
    // 값이 제대로 설정되었는지 확인
    console.log('🔍 설정 값 확인:', {
      mode: $('#ai-mode')?.value,
      provider: $('#ai-provider')?.value,
      localEnabled: $('#ai-local-enabled')?.value
    });

    // 이벤트 트리거하여 UI 업데이트
    const modeEl = $('#ai-mode');
    if (modeEl) {
      modeEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    updateAIProviderVisibility();
    renderAIRulesSummary(settings);

    if (window.hybridDetector) {
      window.hybridDetector.settings = settings;
    }

    console.log('✅ AI 설정 로드 완료');
  } catch (error) {
    console.error('❌ AI 설정 로드 실패:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    const errorMessage = error.message || 'AI 설정을 불러오지 못했습니다.';
    toast(errorMessage, 'error');
    
    // 에러 상세 정보를 콘솔에 출력
    if (error.message.includes('관리자 권한')) {
      console.warn('⚠️ 관리자 권한이 필요합니다. 로그인 상태를 확인하세요.');
    } else if (error.message.includes('테이블')) {
      console.warn('⚠️ 데이터베이스 테이블이 없습니다. 서버 로그를 확인하세요.');
    }
  }
}

// AI 설정 저장
async function saveAISettings() {
  try {
    const payload = {
      mode: $('#ai-mode').value,
      provider: $('#ai-provider').value,
      localEnabled: $('#ai-local-enabled').value === 'true',
      azureEnabled: $('#ai-azure-enabled').value === 'true',
      azureFallbackThreshold: parseFloat($('#ai-azure-threshold').value) || 0.8,
      localBaseConfidence: parseFloat($('#ai-local-confidence').value) || 0.65,
      maxDetections: parseInt($('#ai-max-detections').value, 10) || 3,
      huggingfaceEnabled: $('#ai-hf-enabled').value === 'true',
      huggingfaceModel: $('#ai-hf-model').value.trim() || 'microsoft/resnet-50',
      huggingfaceTask: $('#ai-hf-task').value,
      huggingfacePrompt:
        $('#ai-hf-prompt').value.trim() ||
        'Describe any building defects such as cracks, water leaks, mold, or safety issues in this photo.'
    };

    const result = await apiCall('/api/ai-detection/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    if (!result || !result.success) {
      throw new Error(result?.error || '설정 저장에 실패했습니다.');
    }

    toast('AI 설정이 저장되었습니다', 'success');
    const updated = result.settings || payload;
    renderAIRulesSummary(updated);

    if (window.hybridDetector) {
      window.hybridDetector.settings = updated;
    }
  } catch (error) {
    console.error('AI 설정 저장 실패:', error);
    toast(error.message || 'AI 설정 저장에 실패했습니다', 'error');
  }
}

function updateAIProviderVisibility() {
  const provider = $('#ai-provider').value;
  const azureGroup = $('#ai-azure-enabled').closest('.form-group');
  const hfGroup = $('#ai-hf-enabled').closest('.form-group');
  const hfModelGroup = document.getElementById('ai-hf-model-group');
  const hfTaskGroup = document.getElementById('ai-hf-task-group');
  const hfPromptGroup = document.getElementById('ai-hf-prompt-group');

  if (provider === 'azure') {
    if (azureGroup) azureGroup.style.display = '';
    if (hfGroup) {
      hfGroup.style.display = 'none';
      $('#ai-hf-enabled').value = 'false';
    }
    if (hfModelGroup) hfModelGroup.style.display = 'none';
    if (hfTaskGroup) hfTaskGroup.style.display = 'none';
    if (hfPromptGroup) hfPromptGroup.style.display = 'none';
  } else if (provider === 'huggingface') {
    if (azureGroup) {
      azureGroup.style.display = 'none';
      $('#ai-azure-enabled').value = 'false';
    }
    if (hfGroup) {
      hfGroup.style.display = '';
      if ($('#ai-hf-enabled').value === 'false') {
        $('#ai-hf-enabled').value = 'true';
      }
    }
    if (hfModelGroup) hfModelGroup.style.display = '';
    if (hfTaskGroup) hfTaskGroup.style.display = '';
    if (hfPromptGroup) hfPromptGroup.style.display = '';
  } else {
    if (azureGroup) azureGroup.style.display = '';
    if (hfGroup) hfGroup.style.display = '';
    if (hfModelGroup) hfModelGroup.style.display = '';
    if (hfTaskGroup) hfTaskGroup.style.display = '';
    if (hfPromptGroup) hfPromptGroup.style.display = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const providerSelect = document.getElementById('ai-provider');
  if (providerSelect) {
    providerSelect.addEventListener('change', updateAIProviderVisibility);
  }
});

// 로컬 규칙 요약 표시
function renderAIRulesSummary(settings = {}) {
  const summaryEl = document.getElementById('ai-local-rules-summary');
  if (!summaryEl) return;

  const rules = settings.rules;
  if (!rules || rules.length === 0) {
    summaryEl.innerHTML = `
      <p class="text-muted">
        등록된 사용자 정의 규칙이 없습니다. 기본 규칙 세트를 사용합니다.
      </p>
      <ul class="ai-rules-list">
        <li>천장누수: 파란 채널이 높고 대비가 낮은 경우</li>
        <li>욕실곰팡이: 전체가 어둡고 대비가 낮은 경우</li>
        <li>벽균열: 밝은 배경에서 대비가 높은 경우</li>
      </ul>
    `;
    return;
  }

  const items = rules.map(rule => `
    <li>
      <strong>${rule.label || rule.id || '규칙'}</strong> - ${rule.description || '설명 없음'}
      <div class="text-muted" style="font-size: 12px;">
        심각도: ${rule.severity || '보통'}
      </div>
    </li>
  `).join('');

  summaryEl.innerHTML = `
    <p>총 ${rules.length}개의 사용자 정의 규칙이 적용됩니다.</p>
    <ul class="ai-rules-list">
      ${items}
    </ul>
    <div class="text-muted" style="font-size: 12px;">
      마지막 수정: ${settings.updatedAt ? new Date(settings.updatedAt).toLocaleString('ko-KR') : '알 수 없음'}
    </div>
  `;
}

// 하자 검색
async function searchDefects() {
  const search = $('#defect-search').value.trim();
  
  try {
    const result = await apiCall(`/api/admin/defects?search=${encodeURIComponent(search)}&limit=100`);
    
    const tbody = $('#defects-tbody');
    tbody.innerHTML = result.defects.map(d => `
      <tr>
        <td style="font-size: 11px;">${d.id}</td>
        <td>${d.complex_name}</td>
        <td>${d.dong}-${d.ho}</td>
        <td>${d.location}</td>
        <td>${d.trade}</td>
        <td>${new Date(d.created_at).toLocaleDateString('ko-KR')}</td>
        <td>
          ${d.resolution_id 
            ? '<span class="badge badge-success">처리완료</span>' 
            : '<span class="badge badge-warning">미처리</span>'}
        </td>
        <td>
          <button class="btn btn-primary btn-small" onclick="openResolutionModal('${d.id}')">처리등록</button>
        </td>
      </tr>
    `).join('');
    
  } catch (error) {
    console.error('Search defects error:', error);
  }
}

// 처리 결과 모달 열기
async function openResolutionModal(defectId) {
  AdminState.currentDefectId = defectId;
  AdminState.resolutionPhotos = [];
  
  // 기존 처리 결과 로드
  try {
    const resolution = await apiCall(`/api/admin/defects/${defectId}/resolution`);
    
    if (resolution) {
      $('#resolution-memo').value = resolution.memo || '';
      $('#resolution-contractor').value = resolution.contractor || '';
      $('#resolution-worker').value = resolution.worker || '';
      $('#resolution-cost').value = resolution.cost || '';
      
      // 기존 사진 표시
      if (resolution.resolution_photos && resolution.resolution_photos.length > 0) {
        AdminState.resolutionPhotos = resolution.resolution_photos;
        updatePhotosGrid();
      }
    } else {
      // 새로운 처리 결과
      $('#resolution-memo').value = '';
      $('#resolution-contractor').value = '';
      $('#resolution-worker').value = '';
      $('#resolution-cost').value = '';
    }
    
  } catch (error) {
    console.error('Load resolution error:', error);
  }
  
  $('#resolution-defect-id').value = defectId;
  $('#resolution-modal').classList.add('show');
}

function closeResolutionModal() {
  $('#resolution-modal').classList.remove('show');
  AdminState.currentDefectId = null;
  AdminState.resolutionPhotos = [];
}

// 처리 후 사진 처리
async function handleResolutionPhotos(event) {
  const files = Array.from(event.target.files);
  
  for (const file of files) {
    try {
      // 사진 업로드 (기존 upload API 사용)
      const formData = new FormData();
      formData.append('photo', file);
      
      const response = await fetch(`${API_BASE}/api/upload/photo`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AdminState.token}`
        },
        body: formData
      });
      
      const result = await response.json();
      AdminState.resolutionPhotos.push(result.filename);
      
      updatePhotosGrid();
      
    } catch (error) {
      console.error('Upload photo error:', error);
      toast('사진 업로드 실패', 'error');
    }
  }
}

function updatePhotosGrid() {
  const grid = $('#resolution-photos-grid');
  
  grid.innerHTML = AdminState.resolutionPhotos.map((photo, index) => `
    <div class="photo-item">
      <img src="${API_BASE}/uploads/${photo}" alt="처리 후 사진" />
      <div style="position: absolute; top: 5px; right: 5px;">
        <button 
          onclick="removeResolutionPhoto(${index})" 
          style="background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 16px;"
        >×</button>
      </div>
    </div>
  `).join('') + `
    <div class="photo-item" onclick="$('#resolution-photo-input').click()">
      <div class="add-icon">+</div>
    </div>
  `;
}

function removeResolutionPhoto(index) {
  AdminState.resolutionPhotos.splice(index, 1);
  updatePhotosGrid();
}

// 처리 결과 저장
async function saveResolution() {
  if (!AdminState.currentDefectId) return;
  
  const memo = $('#resolution-memo').value.trim();
  const contractor = $('#resolution-contractor').value.trim();
  const worker = $('#resolution-worker').value.trim();
  const cost = parseInt($('#resolution-cost').value) || null;
  
  try {
    await apiCall(`/api/admin/defects/${AdminState.currentDefectId}/resolution`, {
      method: 'POST',
      body: JSON.stringify({
        memo,
        contractor,
        worker,
        cost,
        resolution_photos: AdminState.resolutionPhotos
      })
    });
    
    toast('처리 결과 저장 완료', 'success');
    closeResolutionModal();
    loadDefects();
    loadDashboardStats();
    
  } catch (error) {
    console.error('Save resolution error:', error);
    toast(error.message || '처리 결과 저장 실패', 'error');
  }
}

// 토큰 유효성 검증
async function verifyAdminToken(token) {
  try {
    // 간단한 API 호출로 토큰 유효성 검증
    const response = await fetch(`${API_BASE}/api/admin/dashboard/stats`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.ok; // 200이면 유효, 403/401이면 무효
  } catch (error) {
    console.error('토큰 검증 중 오류:', error);
    return false;
  }
}

// 초기화
window.addEventListener('DOMContentLoaded', async () => {
  // 저장된 토큰 확인
  const savedToken = localStorage.getItem('admin_token');
  const savedAdmin = localStorage.getItem('admin_info');
  
  if (savedToken && savedAdmin) {
    // 토큰 유효성 검증
    console.log('🔍 저장된 토큰 유효성 검증 중...');
    const isValid = await verifyAdminToken(savedToken);
    
    if (isValid) {
      // 토큰이 유효한 경우
      AdminState.token = savedToken;
      AdminState.admin = JSON.parse(savedAdmin);
      
      $('#login-screen').classList.add('hidden');
      $('#admin-dashboard').classList.remove('hidden');
      $('#admin-name').textContent = AdminState.admin.name;
      
      loadDashboardStats();
      
      // 관리자 푸시 알림 자동 활성화 (백그라운드에서 시도)
      enableAdminPushNotifications().catch(err => {
        console.error('푸시 알림 자동 활성화 실패:', err);
      });
      
      // 푸시 알림 상태 확인
      setTimeout(() => {
        checkPushNotificationStatus();
      }, 1000);
    } else {
      // 토큰이 만료되었거나 유효하지 않은 경우
      console.log('⚠️ 저장된 토큰이 만료되었거나 유효하지 않습니다. 로그인 화면을 표시합니다.');
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_info');
      AdminState.token = null;
      AdminState.admin = null;
      
      $('#login-screen').classList.remove('hidden');
      $('#admin-dashboard').classList.add('hidden');
    }
  } else {
    // 저장된 토큰이 없는 경우
    $('#login-screen').classList.remove('hidden');
    $('#admin-dashboard').classList.add('hidden');
  }
  
  // Enter 키로 로그인
  $('#admin-password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      adminLogin();
    }
  });
  
  // 점검원 승인 모달 라디오 버튼 이벤트
  $$('input[name="approval-action"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const rejectionGroup = $('#rejection-reason-group');
      if (e.target.value === 'reject') {
        rejectionGroup.style.display = 'block';
      } else {
        rejectionGroup.style.display = 'none';
      }
    });
  });
});

// ===== 점검원 관리 기능 =====

// 점검원 등록 목록 로드
async function loadInspectorRegistrations() {
  try {
    const data = await apiCall('/api/inspector-registration/admin/pending');
    
    // 통계 업데이트
    $('#inspector-total').textContent = data.total;
    $('#inspector-pending').textContent = data.pending;
    $('#inspector-approved').textContent = data.approved;
    $('#inspector-rejected').textContent = data.rejected;
    
    // 테이블 업데이트
    const tbody = $('#inspectors-tbody');
    tbody.innerHTML = '';
    
    if (data.registrations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">등록 신청이 없습니다</td></tr>';
      return;
    }
    
    data.registrations.forEach(reg => {
      const row = document.createElement('tr');
      
      const statusBadge = getStatusBadge(reg.status);
      const processedDate = reg.approved_at ? new Date(reg.approved_at).toLocaleDateString() : '-';
      
      row.innerHTML = `
        <td>#${reg.id}</td>
        <td>${reg.complex}</td>
        <td>${reg.dong}동 ${reg.ho}호</td>
        <td>${reg.inspector_name}</td>
        <td>${reg.company_name || '-'}</td>
        <td>${new Date(reg.created_at).toLocaleDateString()}</td>
        <td>${statusBadge}</td>
        <td>${processedDate}</td>
        <td>
          ${reg.status === 'pending' ? 
            `<button class="btn btn-sm btn-primary" onclick="openInspectorApprovalModal(${reg.id})">처리</button>` :
            `<button class="btn btn-sm btn-secondary" onclick="viewInspectorDetails(${reg.id})">상세</button>`
          }
        </td>
      `;
      
      tbody.appendChild(row);
    });
    
  } catch (error) {
    console.error('점검원 등록 목록 로드 오류:', error);
    toast('점검원 등록 목록을 불러오는데 실패했습니다', 'error');
  }
}

// 상태 배지 생성
function getStatusBadge(status) {
  const badges = {
    'pending': '<span class="badge badge-warning">승인 대기</span>',
    'approved': '<span class="badge badge-success">승인 완료</span>',
    'rejected': '<span class="badge badge-danger">승인 거부</span>'
  };
  return badges[status] || '<span class="badge badge-secondary">알 수 없음</span>';
}

// 점검원 승인 모달 열기
async function openInspectorApprovalModal(registrationId) {
  try {
    // 등록 정보 로드
    const data = await apiCall(`/api/inspector-registration/status/${registrationId}`);
    const reg = data.registration;
    
    // 모달 정보 업데이트
    $('#approval-registration-id').value = registrationId;
    $('#approval-inspector-info').innerHTML = `
      <div class="info-item">
        <strong>점검원:</strong> ${reg.inspector_name}
      </div>
      <div class="info-item">
        <strong>연락처:</strong> ${reg.phone}
      </div>
      <div class="info-item">
        <strong>회사명:</strong> ${reg.company_name || '-'}
      </div>
      <div class="info-item">
        <strong>자격증:</strong> ${reg.license_number || '-'}
      </div>
      <div class="info-item">
        <strong>등록 사유:</strong> ${reg.registration_reason}
      </div>
    `;
    
    // 기본값 설정
    $('input[name="approval-action"][value="approve"]').checked = true;
    $('#rejection-reason-group').style.display = 'none';
    $('#rejection-reason').value = '';
    
    // 모달 표시
    $('#inspector-approval-modal').style.display = 'flex';
    
  } catch (error) {
    console.error('점검원 승인 모달 열기 오류:', error);
    toast('점검원 정보를 불러오는데 실패했습니다', 'error');
  }
}

// 점검원 승인 모달 닫기
function closeInspectorApprovalModal() {
  $('#inspector-approval-modal').style.display = 'none';
}

// 점검원 승인/거부 처리
async function processInspectorApproval() {
  const registrationId = $('#approval-registration-id').value;
  const action = $('input[name="approval-action"]:checked').value;
  const rejectionReason = $('#rejection-reason').value.trim();
  
  if (action === 'reject' && !rejectionReason) {
    toast('거부 사유를 입력해주세요', 'error');
    return;
  }
  
  try {
    const data = await apiCall(`/api/inspector-registration/admin/${registrationId}/approve`, {
      method: 'PUT',
      body: JSON.stringify({
        approved: action === 'approve',
        rejection_reason: action === 'reject' ? rejectionReason : null
      })
    });
    
    if (action === 'approve') {
      toast('점검원 등록이 승인되었습니다', 'success');
    } else {
      toast('점검원 등록이 거부되었습니다', 'warning');
    }
    
    closeInspectorApprovalModal();
    loadInspectorRegistrations();
    
  } catch (error) {
    console.error('점검원 승인/거부 처리 오류:', error);
    toast('처리 중 오류가 발생했습니다', 'error');
  }
}

// 점검원 상세 정보 보기
async function viewInspectorDetails(registrationId) {
  try {
    const data = await apiCall(`/api/inspector-registration/status/${registrationId}`);
    const reg = data.registration;
    
    const details = `
      <div class="inspector-details">
        <h3>점검원 등록 상세 정보</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <label>등록 ID:</label>
            <span>#${reg.id}</span>
          </div>
          <div class="detail-item">
            <label>단지:</label>
            <span>${reg.complex}</span>
          </div>
          <div class="detail-item">
            <label>세대:</label>
            <span>${reg.dong}동 ${reg.ho}호</span>
          </div>
          <div class="detail-item">
            <label>점검원명:</label>
            <span>${reg.inspector_name}</span>
          </div>
          <div class="detail-item">
            <label>연락처:</label>
            <span>${reg.phone}</span>
          </div>
          <div class="detail-item">
            <label>회사명:</label>
            <span>${reg.company_name || '-'}</span>
          </div>
          <div class="detail-item">
            <label>자격증 번호:</label>
            <span>${reg.license_number || '-'}</span>
          </div>
          <div class="detail-item">
            <label>이메일:</label>
            <span>${reg.email || '-'}</span>
          </div>
          <div class="detail-item">
            <label>등록 사유:</label>
            <span>${reg.registration_reason}</span>
          </div>
          <div class="detail-item">
            <label>신청일:</label>
            <span>${new Date(reg.created_at).toLocaleString()}</span>
          </div>
          <div class="detail-item">
            <label>처리일:</label>
            <span>${reg.approved_at ? new Date(reg.approved_at).toLocaleString() : '-'}</span>
          </div>
          <div class="detail-item">
            <label>처리자:</label>
            <span>${reg.approved_by || '-'}</span>
          </div>
          ${reg.rejection_reason ? `
            <div class="detail-item">
              <label>거부 사유:</label>
              <span>${reg.rejection_reason}</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    
    // 모달이나 팝업으로 표시 (간단하게 alert 사용)
    alert(details.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
    
  } catch (error) {
    console.error('점검원 상세 정보 조회 오류:', error);
    toast('상세 정보를 불러오는데 실패했습니다', 'error');
  }
}

// 점검원 등록 목록 새로고침
function refreshInspectorRegistrations() {
  loadInspectorRegistrations();
}

