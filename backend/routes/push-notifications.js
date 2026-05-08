// Push Notification API Routes
const express = require('express');
const webpush = require('web-push');
const { authenticateToken } = require('../middleware/auth');
const { safeLog } = require('../utils/logger');
const { decrypt } = require('../utils/encryption');

const router = express.Router();

// Database pool - database.js에서 가져오기
const pool = require('../database');

// VAPID 키 설정 (환경변수에서 가져오기)
const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa40HI8U7u7W1VZGOFjOTvRy8ZuyNeTijPvAUpb7IZ5vQy8sJ1CtoS2iKvFfgE',
  privateKey: process.env.VAPID_PRIVATE_KEY || 'p256dh=...' // 실제 키로 교체 필요
};

// Web Push 설정 (VAPID 키가 유효할 때만)
try {
  if (vapidKeys.publicKey && vapidKeys.privateKey && vapidKeys.privateKey !== 'p256dh=...') {
    webpush.setVapidDetails(
      'mailto:admin@insighti.com',
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );
    console.log('✅ VAPID keys configured for push notifications');
  } else {
    console.warn('⚠️ VAPID keys not configured. Push notifications will not work.');
  }
} catch (error) {
  console.error('❌ Failed to set VAPID details:', error.message);
  // VAPID 설정 실패해도 서버는 계속 실행되도록 함
}

// VAPID 공개키 반환
router.get('/vapid-key', (req, res) => {
  res.json({
    publicKey: vapidKeys.publicKey
  });
});

// 푸시 구독 등록
router.post('/subscribe', authenticateToken, async (req, res) => {
  try {
    const { subscription, userAgent, timestamp } = req.body;
    const { householdId, user_type, isAdmin, adminId, name: adminName } = req.user;

    if (!subscription) {
      return res.status(400).json({ error: 'Subscription data is required' });
    }

    let householdIdToUse = householdId;
    let complexId = null;
    let dong = null;
    let ho = null;
    let name = null;
    let userType = user_type || 'resident';

    // 관리자 계정인 경우
    if (isAdmin && adminId) {
      // 관리자 정보 조회
      const adminResult = await pool.query(
        'SELECT id, name, email, role FROM admin_user WHERE id = $1 AND is_active = true',
        [adminId]
      );

      if (adminResult.rows.length === 0) {
        return res.status(404).json({ error: 'Admin user not found' });
      }

      const admin = adminResult.rows[0];
      name = admin.name;
      userType = admin.role === 'super_admin' ? 'super_admin' : 'admin';
      
      // 관리자 계정은 household_id 없이 endpoint 기준으로 구독 관리
      householdIdToUse = null;
    } else {
      // 일반 사용자 계정인 경우
      if (!householdId) {
        return res.status(400).json({ error: 'Household ID is required for non-admin users' });
      }

      // JWT 토큰에서 개인정보가 제거되었으므로 DB에서 조회 (암호화된 필드 포함)
      const householdResult = await pool.query(
        `SELECT h.complex_id, h.dong, h.ho, h.resident_name, h.resident_name_encrypted, 
                h.phone, h.phone_encrypted, c.name as complex_name
         FROM household h
         JOIN complex c ON h.complex_id = c.id
         WHERE h.id = $1`,
        [householdId]
      );

      if (householdResult.rows.length === 0) {
        return res.status(404).json({ error: 'Household not found' });
      }

      const householdRaw = householdResult.rows[0];
      // 암호화된 필드가 있으면 복호화, 없으면 평문 사용 (호환성)
      const household = {
        ...householdRaw,
        resident_name: householdRaw.resident_name_encrypted 
          ? decrypt(householdRaw.resident_name_encrypted) 
          : householdRaw.resident_name,
        complex_name: householdRaw.complex_name
      };

      complexId = household.complex_id;
      dong = household.dong;
      ho = household.ho;
      name = household.resident_name;
    }

    // 구독 정보 저장: 관리자/일반 사용자 충돌을 피하기 위해 UPSERT 키를 분리
    if (householdIdToUse === null) {
      // 관리자 계정: endpoint만으로 UNIQUE 제약 조건 처리
      const adminQuery = `
        INSERT INTO push_subscription (
          household_id, complex_id, dong, ho, name, user_type,
          endpoint, p256dh, auth, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (endpoint) 
        DO UPDATE SET 
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          user_agent = EXCLUDED.user_agent,
          name = EXCLUDED.name,
          user_type = EXCLUDED.user_type,
          updated_at = now()
      `;
      
      await pool.query(adminQuery, [
        householdIdToUse,
        complexId,
        dong || '관리자',
        ho || '관리자',
        name,
        userType,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        userAgent || 'Unknown',
        timestamp || new Date().toISOString()
      ]);
    } else {
      // 일반 사용자 계정: (household_id, endpoint)로 UNIQUE 제약 조건 처리
      const userQuery = `
        INSERT INTO push_subscription (
          household_id, complex_id, dong, ho, name, user_type,
          endpoint, p256dh, auth, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (household_id, endpoint) 
        DO UPDATE SET 
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          user_agent = EXCLUDED.user_agent,
          updated_at = now()
      `;
      
      await pool.query(userQuery, [
        householdIdToUse,
        complexId,
        dong,
        ho,
        name,
        userType,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        userAgent || 'Unknown',
        timestamp || new Date().toISOString()
      ]);
    }

    safeLog('info', 'Push subscription registered', {
      householdId: householdIdToUse,
      name,
      userType,
      endpoint: subscription.endpoint.substring(0, 50) + '...'
    });

    res.json({
      success: true,
      message: 'Push subscription registered successfully'
    });

  } catch (error) {
    console.error('Push subscription error:', error);
    safeLog('error', 'Push subscription error', { 
      error: error.message,
      stack: error.stack,
      code: error.code,
      constraint: error.constraint
    });
    
    // 데이터베이스 제약 조건 위반 에러 처리
    if (error.code === '23505') { // unique_violation
      const errorMessage = error.constraint === 'push_subscription_endpoint_unique'
        ? '이미 등록된 푸시 구독입니다. 기존 구독을 업데이트했습니다.'
        : '중복된 푸시 구독입니다.';
      return res.status(409).json({ error: errorMessage });
    }
    
    // 외래 키 제약 조건 위반
    if (error.code === '23503') { // foreign_key_violation
      return res.status(400).json({ error: '유효하지 않은 사용자 정보입니다.' });
    }
    
    // 기타 데이터베이스 에러
    if (error.code && error.code.startsWith('23')) {
      return res.status(400).json({ error: `데이터베이스 오류: ${error.message}` });
    }
    
    res.status(500).json({ 
      error: 'Failed to register push subscription',
      message: error.message 
    });
  }
});

// 푸시 구독 해제
router.delete('/unsubscribe', authenticateToken, async (req, res) => {
  try {
    const { householdId } = req.user;

    const query = 'DELETE FROM push_subscription WHERE household_id = $1';
    await pool.query(query, [householdId]);

    safeLog('info', 'Push subscription removed', { householdId });

    res.json({
      success: true,
      message: 'Push subscription removed successfully'
    });

  } catch (error) {
    safeLog('error', 'Push unsubscribe error', { error: error.message });
    res.status(500).json({ error: 'Failed to remove push subscription' });
  }
});

// 테스트 알림 발송
router.post('/test', authenticateToken, async (req, res) => {
  try {
    const { title, body, icon } = req.body;
    const { householdId } = req.user;

    // 사용자 정보 조회 (암호화된 필드 포함)
    const householdResult = await pool.query(
      `SELECT resident_name, resident_name_encrypted FROM household WHERE id = $1`,
      [householdId]
    );
    const householdRaw = householdResult.rows[0];
    const name = householdRaw 
      ? (householdRaw.resident_name_encrypted 
          ? decrypt(householdRaw.resident_name_encrypted) 
          : householdRaw.resident_name) || '사용자'
      : '사용자';

    // 사용자의 구독 정보 조회
    const subscriptionQuery = `
      SELECT endpoint, p256dh, auth 
      FROM push_subscription 
      WHERE household_id = $1
    `;
    
    const subscriptionResult = await pool.query(subscriptionQuery, [householdId]);
    
    if (subscriptionResult.rows.length === 0) {
      return res.status(404).json({ error: 'No push subscription found' });
    }

    const subscription = subscriptionResult.rows[0];
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth
      }
    };

    // 알림 페이로드
    const payload = JSON.stringify({
      title: title || 'InsightI 테스트 알림',
      body: body || '푸시 알림이 정상적으로 작동합니다!',
      icon: icon || '/icon-192x192.png',
      badge: '/badge-72x72.png',
      tag: 'test-notification',
      requireInteraction: true,
      actions: [
        {
          action: 'view',
          title: '확인',
          icon: '/icon-192x192.png'
        }
      ],
      data: {
        url: '/',
        timestamp: new Date().toISOString(),
        type: 'test'
      }
    });

    // 푸시 알림 발송
    await webpush.sendNotification(pushSubscription, payload);

    safeLog('info', 'Test notification sent', { householdId, name });

    res.json({
      success: true,
      message: 'Test notification sent successfully'
    });

  } catch (error) {
    safeLog('error', 'Test notification error', { error: error.message });
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// 하자 등록 완료 알림 발송
router.post('/defect-registered', authenticateToken, async (req, res) => {
  try {
    const { defectId, location, trade, content } = req.body;
    const { householdId } = req.user;

    // 사용자 정보 조회 (암호화된 필드 포함)
    const householdResult = await pool.query(
      `SELECT h.complex_id, h.dong, h.ho, h.resident_name, h.resident_name_encrypted, c.name as complex_name
       FROM household h
       JOIN complex c ON h.complex_id = c.id
       WHERE h.id = $1`,
      [householdId]
    );
    if (householdResult.rows.length === 0) {
      return res.status(404).json({ error: 'Household not found' });
    }
    const householdRaw = householdResult.rows[0];
    const complex = householdRaw.complex_name;
    const dong = householdRaw.dong;
    const ho = householdRaw.ho;
    const name = householdRaw.resident_name_encrypted 
      ? decrypt(householdRaw.resident_name_encrypted) 
      : householdRaw.resident_name;

    // 관리자들에게 알림 발송
    // 관리자 계정은 household_id가 NULL일 수 있으므로 LEFT JOIN 사용
    const adminQuery = `
      SELECT ps.endpoint, ps.p256dh, ps.auth, 
             COALESCE(
               CASE 
                 WHEN h.resident_name_encrypted IS NOT NULL THEN NULL
                 ELSE h.resident_name
               END,
               ps.name
             ) as name, 
             COALESCE(h.dong, ps.dong) as dong, 
             COALESCE(h.ho, ps.ho) as ho
      FROM push_subscription ps
      LEFT JOIN household h ON ps.household_id = h.id
      WHERE ps.user_type IN ('admin', 'super_admin')
    `;
    
    const adminResult = await pool.query(adminQuery);
    
    if (adminResult.rows.length === 0) {
      return res.json({ success: true, message: 'No admin subscriptions found' });
    }

    const payload = JSON.stringify({
      title: '🔔 새로운 하자 등록',
      body: `${complex} ${dong}동 ${ho}호 - ${location} ${trade} 하자 등록`,
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      tag: 'defect-registered',
      requireInteraction: true,
      actions: [
        {
          action: 'view',
          title: '확인',
          icon: '/icon-192x192.png'
        }
      ],
      data: {
        url: '/admin',
        type: 'defect-registered',
        defectId,
        householdId,
        complex,
        dong,
        ho,
        location,
        trade,
        content
      }
    });

    // 모든 관리자에게 알림 발송
    const sendPromises = adminResult.rows.map(async (admin) => {
      try {
        const pushSubscription = {
          endpoint: admin.endpoint,
          keys: {
            p256dh: admin.p256dh,
            auth: admin.auth
          }
        };
        
        await webpush.sendNotification(pushSubscription, payload);
        safeLog('info', 'Defect notification sent to admin', { 
          adminName: admin.name || '관리자',
          endpoint: admin.endpoint.substring(0, 50) + '...'
        });
      } catch (error) {
        safeLog('error', 'Failed to send to admin', { adminName: admin.name, error: error.message });
      }
    });

    await Promise.allSettled(sendPromises);

    res.json({
      success: true,
      message: 'Defect registration notification sent to admins'
    });

  } catch (error) {
    safeLog('error', 'Defect notification error', { error: error.message });
    res.status(500).json({ error: 'Failed to send defect notification' });
  }
});

// 점검 결과 등록 알림 발송
router.post('/inspection-completed', authenticateToken, async (req, res) => {
  try {
    const { inspectionType, location, result } = req.body;
    const { householdId } = req.user;

    // 사용자 정보 조회
    const householdResult = await pool.query(
      `SELECT h.complex_id, h.dong, h.ho, h.resident_name, c.name as complex_name
       FROM household h
       JOIN complex c ON h.complex_id = c.id
       WHERE h.id = $1`,
      [householdId]
    );
    if (householdResult.rows.length === 0) {
      return res.status(404).json({ error: 'Household not found' });
    }
    const household = householdResult.rows[0];
    const complex = household.complex_name;
    const dong = household.dong;
    const ho = household.ho;

    // 해당 세대 입주자에게 알림 발송
    const residentQuery = `
      SELECT ps.endpoint, ps.p256dh, ps.auth
      FROM push_subscription ps
      JOIN household h ON ps.household_id = h.id
      WHERE h.complex_id = (SELECT complex_id FROM household WHERE id = $1)
      AND h.dong = (SELECT dong FROM household WHERE id = $1)
      AND h.ho = (SELECT ho FROM household WHERE id = $1)
      AND h.user_type = 'resident'
    `;
    
    const residentResult = await pool.query(residentQuery, [householdId]);
    
    if (residentResult.rows.length === 0) {
      return res.json({ success: true, message: 'No resident subscriptions found' });
    }

    const inspectionTypeNames = {
      'thermal': '열화상',
      'air': '공기질',
      'radon': '라돈',
      'level': '레벨기'
    };

    const payload = JSON.stringify({
      title: '📊 점검 결과 등록 완료',
      body: `${inspectionTypeNames[inspectionType]} 점검이 완료되었습니다 (${location})`,
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      tag: 'inspection-completed',
      requireInteraction: true,
      actions: [
        {
          action: 'view',
          title: '보고서 보기',
          icon: '/icon-192x192.png'
        }
      ],
      data: {
        url: '/',
        type: 'inspection-completed',
        inspectionType,
        location,
        result,
        complex,
        dong,
        ho
      }
    });

    // 해당 세대 입주자에게 알림 발송
    const sendPromises = residentResult.rows.map(async (resident) => {
      try {
        const pushSubscription = {
          endpoint: resident.endpoint,
          keys: {
            p256dh: resident.p256dh,
            auth: resident.auth
          }
        };
        
        await webpush.sendNotification(pushSubscription, payload);
        safeLog('info', 'Inspection notification sent to resident');
      } catch (error) {
        safeLog('error', 'Failed to send to resident', { error: error.message });
      }
    });

    await Promise.allSettled(sendPromises);

    res.json({
      success: true,
      message: 'Inspection completion notification sent to residents'
    });

  } catch (error) {
    safeLog('error', 'Inspection notification error', { error: error.message });
    res.status(500).json({ error: 'Failed to send inspection notification' });
  }
});

// 점검원 승인/거부 알림 발송
router.post('/inspector-decision', authenticateToken, async (req, res) => {
  try {
    const { registrationId, approved, rejectionReason } = req.body;
    const { householdId } = req.user;

    // 점검원 등록 정보 조회
    const registrationQuery = `
      SELECT ir.*, h.complex_id, h.dong, h.ho
      FROM inspector_registration ir
      JOIN household h ON ir.complex_id = h.complex_id 
        AND ir.dong = h.dong AND ir.ho = h.ho
      WHERE ir.id = $1
    `;
    
    const registrationResult = await pool.query(registrationQuery, [registrationId]);
    
    if (registrationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    const registration = registrationResult.rows[0];

    // 해당 세대의 구독 정보 조회
    const subscriptionQuery = `
      SELECT ps.endpoint, ps.p256dh, ps.auth
      FROM push_subscription ps
      JOIN household h ON ps.household_id = h.id
      WHERE h.complex_id = $1 AND h.dong = $2 AND h.ho = $3
    `;
    
    const subscriptionResult = await pool.query(subscriptionQuery, [
      registration.complex_id,
      registration.dong,
      registration.ho
    ]);
    
    if (subscriptionResult.rows.length === 0) {
      return res.json({ success: true, message: 'No subscription found for this household' });
    }

    const subscription = subscriptionResult.rows[0];
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth
      }
    };

    const payload = JSON.stringify({
      title: approved ? '✅ 점검원 등록 승인' : '❌ 점검원 등록 거부',
      body: approved 
        ? '점검원 등록이 승인되었습니다. 장비점검 기능을 사용할 수 있습니다.'
        : `점검원 등록이 거부되었습니다. 사유: ${rejectionReason || '기타'}`,
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      tag: 'inspector-decision',
      requireInteraction: true,
      actions: [
        {
          action: 'view',
          title: '확인',
          icon: '/icon-192x192.png'
        }
      ],
      data: {
        url: '/',
        type: 'inspector-decision',
        approved,
        rejectionReason,
        registrationId
      }
    });

    await webpush.sendNotification(pushSubscription, payload);

    safeLog('info', 'Inspector decision notification sent', {
      registrationId,
      approved,
      inspector: registration.inspector_name
    });

    res.json({
      success: true,
      message: 'Inspector decision notification sent successfully'
    });

  } catch (error) {
    safeLog('error', 'Inspector decision notification error', { error: error.message });
    res.status(500).json({ error: 'Failed to send inspector decision notification' });
  }
});

// 보고서 생성 완료 알림 발송
router.post('/report-generated', authenticateToken, async (req, res) => {
  try {
    const { reportId, reportUrl } = req.body;
    const { householdId } = req.user;

    // 사용자 정보 조회 (암호화된 필드 포함)
    const householdResult = await pool.query(
      `SELECT h.complex_id, h.dong, h.ho, h.resident_name, h.resident_name_encrypted, c.name as complex_name
       FROM household h
       JOIN complex c ON h.complex_id = c.id
       WHERE h.id = $1`,
      [householdId]
    );
    if (householdResult.rows.length === 0) {
      return res.status(404).json({ error: 'Household not found' });
    }
    const householdRaw = householdResult.rows[0];
    const complex = householdRaw.complex_name;
    const dong = householdRaw.dong;
    const ho = householdRaw.ho;
    const name = householdRaw.resident_name_encrypted 
      ? decrypt(householdRaw.resident_name_encrypted) 
      : householdRaw.resident_name;

    // 해당 세대의 구독 정보 조회
    const subscriptionQuery = `
      SELECT ps.endpoint, ps.p256dh, ps.auth
      FROM push_subscription ps
      WHERE ps.household_id = $1
    `;
    
    const subscriptionResult = await pool.query(subscriptionQuery, [householdId]);
    
    if (subscriptionResult.rows.length === 0) {
      return res.json({ success: true, message: 'No subscription found' });
    }

    const subscription = subscriptionResult.rows[0];
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth
      }
    };

    const payload = JSON.stringify({
      title: '📄 보고서 생성 완료',
      body: `${complex} ${dong}동 ${ho}호 점검 보고서가 생성되었습니다`,
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      tag: 'report-generated',
      requireInteraction: true,
      actions: [
        {
          action: 'view',
          title: '보고서 보기',
          icon: '/icon-192x192.png'
        },
        {
          action: 'download',
          title: '다운로드',
          icon: '/icon-192x192.png'
        }
      ],
      data: {
        url: '/',
        type: 'report-generated',
        reportId,
        reportUrl,
        complex,
        dong,
        ho
      }
    });

    await webpush.sendNotification(pushSubscription, payload);

    safeLog('info', 'Report generation notification sent', {
      householdId,
      reportId,
      name
    });

    res.json({
      success: true,
      message: 'Report generation notification sent successfully'
    });

  } catch (error) {
    safeLog('error', 'Report notification error', { error: error.message });
    res.status(500).json({ error: 'Failed to send report notification' });
  }
});

module.exports = router;
