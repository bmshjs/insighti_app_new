// Authentication routes
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../database');
const config = require('../config');
const { safeLog } = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/encryption');

// 복호화 실패 시(로컬 ENCRYPTION_KEY 불일치 등) 500 방지
function safeDecrypt(value, fallback) {
  if (!value) return fallback || '';
  try {
    return decrypt(value);
  } catch (e) {
    console.warn('⚠️ 복호화 실패, fallback 사용:', e.message);
    return fallback || value;
  }
}

const router = express.Router();

async function householdHasEncryptedColumns() {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'household'
       AND column_name = 'resident_name_encrypted'
     LIMIT 1`
  );
  return result.rows.length > 0;
}

// Create session by household info
router.post('/session', async (req, res) => {
  try {
    const { complex, dong, ho, name, phone } = req.body;

    // 로그인 키: 아파트(단지명) + 동 + 호만 필수. 이름/전화는 최초 로그인 시에만 필수.
    if (!complex || !dong || !ho) {
      return res.status(400).json({ error: '아파트명, 동, 호수를 입력해 주세요.' });
    }

    // Complex 찾기 또는 생성 (대소문자·공백 무시 — 점검원 admin 계정 대응)
    let complexResult = await pool.query(
      'SELECT id, name FROM complex WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))',
      [complex]
    );
    
    let complexId;
    if (complexResult.rows.length === 0) {
      // 신규 Complex 생성
      complexResult = await pool.query(
        'INSERT INTO complex (name, address) VALUES ($1, $2) RETURNING id',
        [complex, '자동 등록']
      );
      complexId = complexResult.rows[0].id;
      safeLog('info', '신규 단지 생성', { complex });
    } else {
      complexId = complexResult.rows[0].id;
    }
    
    // Household 찾기 (단지+동+호만으로 조회)
    const hasEncrypted = await householdHasEncryptedColumns();
    const householdSelect = hasEncrypted
      ? `SELECT id, resident_name, phone, resident_name_encrypted, phone_encrypted, user_type
         FROM household
         WHERE complex_id = $1 AND dong = $2 AND ho = $3`
      : `SELECT id, resident_name, phone, user_type
         FROM household
         WHERE complex_id = $1 AND dong = $2 AND ho = $3`;

    let householdResult = await pool.query(householdSelect, [complexId, dong, ho]);
    
    let householdId;
    let userName = name || '';
    let userPhone = phone || '';

    if (householdResult.rows.length === 0) {
      // 신규 세대 등록 — 최초 로그인 시에만 이름·전화 필수
      if (!name || !phone) {
        return res.status(400).json({
          error: '최초 로그인입니다. 성명과 전화번호를 입력해 주세요.',
          code: 'FIRST_LOGIN_REQUIRED'
        });
      }
      safeLog('info', '신규 세대 등록', { complex, dong, ho, name });

      const nameEncrypted = encrypt(name);
      const phoneEncrypted = encrypt(phone);

      const insertSql = hasEncrypted
        ? `INSERT INTO household (complex_id, dong, ho, resident_name, phone, resident_name_encrypted, phone_encrypted)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`
        : `INSERT INTO household (complex_id, dong, ho, resident_name, phone)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`;
      const insertParams = hasEncrypted
        ? [complexId, dong, ho, name, phone, nameEncrypted, phoneEncrypted]
        : [complexId, dong, ho, name, phone];

      const newHouseholdResult = await pool.query(insertSql, insertParams);

      householdId = newHouseholdResult.rows[0].id;
      userName = name;
      userPhone = phone;
      safeLog('info', '신규 세대 등록 완료', { householdId });
    } else {
      // 기존 세대 — 재로그인 시 이름/전화는 선택. 있으면 업데이트, 없으면 기존값 유지
      householdId = householdResult.rows[0].id;
      const existing = householdResult.rows[0];

      const existingName = existing.resident_name_encrypted
        ? safeDecrypt(existing.resident_name_encrypted, existing.resident_name)
        : (existing.resident_name || '');
      const existingPhone = existing.phone_encrypted
        ? safeDecrypt(existing.phone_encrypted, existing.phone)
        : (existing.phone || '');

      const finalName = (name != null && name !== '') ? name : existingName;
      const finalPhone = (phone != null && phone !== '') ? phone : existingPhone;
      userName = finalName;
      userPhone = finalPhone;

      if (finalName !== existingName || finalPhone !== existingPhone) {
        safeLog('info', '세대 정보 업데이트', { name: finalName, phone: finalPhone });
        if (hasEncrypted) {
          const nameEncrypted = encrypt(finalName);
          const phoneEncrypted = encrypt(finalPhone);
          await pool.query(
            `UPDATE household
             SET resident_name = $1, phone = $2,
                 resident_name_encrypted = $4, phone_encrypted = $5
             WHERE id = $3`,
            [finalName, finalPhone, householdId, nameEncrypted, phoneEncrypted]
          );
        } else {
          await pool.query(
            `UPDATE household SET resident_name = $1, phone = $2 WHERE id = $3`,
            [finalName, finalPhone, householdId]
          );
        }
      }

      safeLog('info', '기존 세대 로그인', { householdId });
    }

    // Get user type for token
    let userType = 'resident'; // Default for new households
    if (householdResult.rows.length > 0) {
      userType = householdResult.rows[0].user_type || 'resident';
    }

    // Generate JWT token (최소 정보만 포함 - 개인정보 제거)
    const token = jwt.sign(
      { 
        householdId,
        user_type: userType,
        purpose: 'precheck'
        // ✅ 개인정보(complex, dong, ho, name, phone) 제거
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 3); // 3 days

    res.json({
      token,
      user: {
        householdId,
        complex,
        dong,
        ho,
        name: userName,
        phone: userPhone,
        user_type: userType
      },
      purpose: 'precheck',
      expires_at: expiresAt.toISOString()
    });

  } catch (error) {
    safeLog('error', 'Auth error', { error: error.message });
    console.error('❌ /api/auth/session error:', error.message, error.stack);
    const msg = error.message || String(error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: msg,
      details: msg
    });
  }
});

module.exports = router;
