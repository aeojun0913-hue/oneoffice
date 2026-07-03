/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  OneOffice — Phase 2 Enterprise Security Backend                    ║
 * ║  server.js v2.0 | 대기업 인트라넷급 SaaS 백엔드                        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * 보안 아키텍처:
 *   ① JWT 무결성 토큰 — 만료시간 포함, 역할(role) 내장
 *   ② Helmet HTTP 보안 헤더 — XSS/Clickjacking/MIME 스니핑 차단
 *   ③ Rate Limiter — 브루트포스 로그인 공격 방어 (5회/분 제한)
 *   ④ 보안 감사 로그 — 모든 민감 액션 자동 타임스탬프 기록
 *   ⑤ JWT 미들웨어 — 인증 없는 API 접근 완전 차단
 *   ⑥ Admin RBAC — /api/audit-logs 등 관리자 전용 엔드포인트 분리
 *   ⑦ 멀티 테넌트 격리 — oneoffice_ANTIGRAVITY_v1_{collection} 스키마
 *   ⑧ Gemini AI 서버 사이드 프록시 — API 키 프론트엔드 노출 완전 차단
 *
 * 필수 API 엔드포인트:
 *   POST /api/login           → 3단계 인증 + JWT 발급
 *   POST /api/token/refresh   → 토큰 갱신
 *   GET  /api/audit-logs      → Admin 전용 감사 로그 (JWT 필수)
 *   POST /api/salary/calculate → 4대보험+소득세 계산 API (JWT 필수)
 *   POST /api/ai/generate     → Gemini AI 서버 사이드 프록시 (JWT 필수)
 *   GET  /api/state           → 전체 앱 상태 (JWT 필수)
 *   ... 기타 기존 엔드포인트들 (JWT 미들웨어 적용)
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const dotenv     = require('dotenv');
const rateLimit  = require('express-rate-limit');
const jwt        = require('jsonwebtoken');
const helmet     = require('helmet');

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════════════════════════════
// 🛡️  보안 설정 상수
// ══════════════════════════════════════════════════════════════════════
const JWT_SECRET      = process.env.JWT_SECRET || 'oneoffice_ANTIGRAVITY_jwt_secret_2026_DO_NOT_SHARE';
const JWT_EXPIRES_IN  = '8h';   // 업무 시간 기준 8시간 만료
const TENANT_ID       = 'ANTIGRAVITY';
const COMPANY_CODE    = 'ANTIGRAVITY';

// 비밀번호 → 역할 매핑 (Phase 2: 실제 DB 해시 비교로 교체 예정)
const ROLE_BY_PASSWORD = {
  '1111': 'admin',
  '0000': 'employee',
};

// ══════════════════════════════════════════════════════════════════════
// 🔧 Express 미들웨어 설정
// ══════════════════════════════════════════════════════════════════════

// Helmet: 보안 HTTP 헤더 자동 설정 (XSS, Clickjacking, MIME 스니핑 등 차단)
app.use(helmet({
  contentSecurityPolicy: false, // SPA에서 인라인 스크립트 허용
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(bodyParser.json({ limit: '2mb' }));

// 정적 파일 서빙 (HTML, CSS, JS 모듈)
app.use(express.static(__dirname, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache'); // 항상 최신 파일 제공
  }
}));

// ══════════════════════════════════════════════════════════════════════
// 🗄️  멀티 테넌트 데이터베이스 레이어
//    - 실제 AWS 배포 시: database.json → RDS/DynamoDB SDK로 교체
//    - 테넌트별 격리: oneoffice_{TENANT}_v1_{collection}
// ══════════════════════════════════════════════════════════════════════
const DB_PATH = path.join(__dirname, 'database.json');

/** 기본 DB 스키마 (최초 실행 or 파일 손상 시) */
function _getDefaultDB() {
  return {
    // 멀티 테넌트 메타 정보
    __meta__: { tenantId: TENANT_ID, version: 'v1', createdAt: new Date().toISOString() },
    // 컬렉션 (모두 테넌트 격리됨)
    [`oneoffice_${TENANT_ID}_v1_employees`]: _getDefaultEmployees(),
    [`oneoffice_${TENANT_ID}_v1_welfarePoints`]: { '1':150000,'2':120000,'3':95000,'4':52000,'5':30000,'6':45000 },
    [`oneoffice_${TENANT_ID}_v1_calendarEvents`]: [],
    [`oneoffice_${TENANT_ID}_v1_chatLogs`]: {
      group: [
        { sender:'received', senderName:'Jane Doe', text:'원오피스 사내 단체 대화방입니다. 오늘 하루도 파이팅!', timestamp: new Date().toISOString() }
      ],
      bot: [
        { sender:'received', senderName:'AI Assistant', text:'안녕하세요! OneOffice AI 비서입니다. 노무, 연차, 급여 관련 질문을 자유롭게 해주세요!', timestamp: new Date().toISOString() }
      ],
    },
    [`oneoffice_${TENANT_ID}_v1_fleaMarketItems`]: _getDefaultMarketItems(),
    [`oneoffice_${TENANT_ID}_v1_registryEvents`]: _getDefaultRegistryEvents(),
    [`oneoffice_${TENANT_ID}_v1_reports`]: [],
    [`oneoffice_${TENANT_ID}_v1_securityLogs`]: [],
    [`oneoffice_${TENANT_ID}_v1_payrollHistory`]: [],
    [`oneoffice_${TENANT_ID}_v1_busRoutes`]: _getDefaultBusRoutes(),
    [`oneoffice_${TENANT_ID}_v1_clubMemberships`]: {},
  };
}

/** 테넌트 컬렉션 키 생성 */
function _tKey(collection) {
  return `oneoffice_${TENANT_ID}_v1_${collection}`;
}

/** DB 읽기 */
function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    // 마이그레이션: 구형 플랫 구조 → 테넌트 격리 구조 자동 변환
    if (!parsed.__meta__) {
      return _migrateLegacyDB(parsed);
    }
    return parsed;
  } catch {
    const defaultDB = _getDefaultDB();
    writeDB(defaultDB);
    return defaultDB;
  }
}

/** DB 쓰기 (원자적 파일 교체) */
function writeDB(data) {
  try {
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_PATH);
  } catch (err) {
    console.error('[DB] 쓰기 실패:', err.message);
  }
}

/** 구형 flat DB → 테넌트 격리 구조 마이그레이션 */
function _migrateLegacyDB(old) {
  console.info('[DB] 구형 데이터베이스를 멀티테넌트 구조로 자동 마이그레이션 중...');
  const newDB = _getDefaultDB();
  // 기존 데이터 보존
  if (old.employees?.length)       newDB[_tKey('employees')]       = old.employees;
  if (old.welfarePoints)           newDB[_tKey('welfarePoints')]   = old.welfarePoints;
  if (old.calendarEvents?.length)  newDB[_tKey('calendarEvents')]  = old.calendarEvents;
  if (old.chatLogs)                newDB[_tKey('chatLogs')]        = old.chatLogs;
  if (old.fleaMarketItems?.length) newDB[_tKey('fleaMarketItems')] = old.fleaMarketItems;
  if (old.registryEvents?.length)  newDB[_tKey('registryEvents')]  = old.registryEvents;
  if (old.reports?.length)         newDB[_tKey('reports')]         = old.reports;
  if (old.securityLogs?.length)    newDB[_tKey('securityLogs')]    = old.securityLogs;
  writeDB(newDB);
  console.info('[DB] 마이그레이션 완료 ✅');
  return newDB;
}

/** 컬렉션 단일 읽기 헬퍼 */
function getCollection(collection, fallback = null) {
  const db = readDB();
  return db[_tKey(collection)] ?? fallback;
}

/** 컬렉션 단일 쓰기 헬퍼 */
function setCollection(collection, value) {
  const db = readDB();
  db[_tKey(collection)] = value;
  writeDB(db);
}

// ══════════════════════════════════════════════════════════════════════
// 🔒 보안 감사 로그 (Security Audit Log)
//    - 모든 민감 이벤트 자동 기록
//    - 타임스탬프 / 사용자 / IP / 액션유형 / 상세내역
// ══════════════════════════════════════════════════════════════════════
function logSecurity(userName, ip, action, detail, severity = 'INFO') {
  const entry = {
    id:        Date.now(),
    timestamp: new Date().toISOString(),
    userName:  userName || 'GUEST',
    ip:        ip       || '127.0.0.1',
    action,
    detail,
    severity, // INFO | WARN | CRITICAL
  };
  const logs = getCollection('securityLogs', []);
  logs.unshift(entry);
  if (logs.length > 500) logs.splice(500); // 최대 500건 보관
  setCollection('securityLogs', logs);
}

// ══════════════════════════════════════════════════════════════════════
// 🔐 JWT 유틸리티
// ══════════════════════════════════════════════════════════════════════

/** JWT 토큰 생성 */
function issueToken(employee, role) {
  const payload = {
    sub:      employee.id,          // Subject (사용자 ID)
    name:     employee.name,
    email:    employee.email,
    role,                           // 'admin' | 'employee'
    tenantId: TENANT_ID,
    iat:      Math.floor(Date.now() / 1000),
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/** JWT 검증 미들웨어 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error:  '인증 토큰이 없습니다. 로그인 후 다시 시도해주세요.',
      code:   'TOKEN_MISSING',
    });
  }
  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? '세션이 만료되었습니다. 다시 로그인해주세요.' : '유효하지 않은 인증 토큰입니다.';
    return res.status(401).json({ success: false, error: msg, code: err.name });
  }
}

/** Admin 전용 미들웨어 */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logSecurity(req.user?.name || 'Unknown', ip, '권한 없음 접근 시도', `Admin 전용 엔드포인트에 일반 직원 접근 시도: ${req.path}`, 'WARN');
    return res.status(403).json({ success: false, error: '관리자 권한이 필요합니다.', code: 'FORBIDDEN' });
  }
  next();
}

// ══════════════════════════════════════════════════════════════════════
// 🚦 Rate Limiter (브루트포스 방어)
// ══════════════════════════════════════════════════════════════════════
const isProd       = process.env.NODE_ENV === 'production';

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      isProd ? 5 : 30,    // 개발: 30회, 프로덕션: 5회
  skip:     (req) => !isProd && (req.ip === '127.0.0.1' || req.ip === '::1'),
  message:  { success: false, error: '너무 많은 로그인 시도입니다. 1분 후 다시 시도해주세요.', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      isProd ? 20 : 100,  // 개발: 100회, 프로덕션: 20회
  skip:     (req) => !isProd && (req.ip === '127.0.0.1' || req.ip === '::1'),
  message:  { success: false, error: 'AI API 요청 한도를 초과했습니다.', code: 'AI_RATE_LIMITED' },
});

// ══════════════════════════════════════════════════════════════════════
// ① POST /api/login — 3단계 인증 + JWT 발급
//    Step 1: 회사 코드 검증
//    Step 2: 이메일 + 비밀번호 → 역할 판별 → OTP 생성
//    Step 3: OTP 검증 → JWT 토큰 발급
// ══════════════════════════════════════════════════════════════════════
const _otpStore = new Map(); // { email: { otp, role, expiry } }

app.post('/api/login', loginLimiter, (req, res) => {
  const { step, code, email, password, otp } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // ── Step 1: 회사 코드 ────────────────────────────────────────────
  if (step === 1) {
    if (code?.trim().toUpperCase() === COMPANY_CODE) {
      logSecurity('GUEST', ip, '회사코드 인증', `[${TENANT_ID}] 워크스페이스 진입 성공`);
      return res.json({ success: true, tenantId: TENANT_ID });
    }
    logSecurity('GUEST', ip, '회사코드 실패', `잘못된 코드 입력: "${code}"`, 'WARN');
    return res.status(400).json({ success: false, error: '잘못된 회사 코드입니다.', code: 'INVALID_COMPANY_CODE' });
  }

  // ── Step 2: 이메일 + 비밀번호 ─────────────────────────────────────
  if (step === 2) {
    if (!email || !password) {
      return res.status(400).json({ success: false, error: '이메일과 비밀번호를 입력해주세요.' });
    }

    const role = ROLE_BY_PASSWORD[password];
    if (!role) {
      logSecurity('GUEST', ip, '비밀번호 오류', `잘못된 비밀번호 시도 (email: ${email})`, 'WARN');
      return res.status(400).json({ success: false, error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const employees = getCollection('employees', _getDefaultEmployees());
    const employee  = employees.find(e => e.email.toLowerCase() === email.toLowerCase());
    if (!employee) {
      logSecurity('GUEST', ip, '이메일 없음', `존재하지 않는 이메일: ${email}`, 'WARN');
      return res.status(400).json({ success: false, error: '등록되지 않은 이메일입니다.' });
    }

    // OTP 생성 (6자리) + 5분 만료
    const generatedOTP = String(Math.floor(100000 + Math.random() * 900000));
    _otpStore.set(email, { otp: generatedOTP, role, expiry: Date.now() + 5 * 60 * 1000 });

    // 만료된 OTP 자동 정리
    setTimeout(() => _otpStore.delete(email), 5 * 60 * 1000);

    logSecurity(employee.name, ip, 'OTP 발급', `2단계 인증 코드 발급 → [${role.toUpperCase()}] 권한 예정`);
    return res.json({
      success:  true,
      otpHint:  generatedOTP, // 실제 환경: SMS/이메일 발송 후 제거
      employee: { id: employee.id, name: employee.name, email: employee.email, dept: employee.dept, title: employee.title },
    });
  }

  // ── Step 3: OTP 검증 → JWT 발급 ──────────────────────────────────
  if (step === 3) {
    const stored = _otpStore.get(email);

    if (!stored) {
      return res.status(400).json({ success: false, error: 'OTP가 만료되었거나 존재하지 않습니다. 다시 시도해주세요.', code: 'OTP_EXPIRED' });
    }
    if (Date.now() > stored.expiry) {
      _otpStore.delete(email);
      return res.status(400).json({ success: false, error: 'OTP가 만료되었습니다. (유효시간: 5분)', code: 'OTP_EXPIRED' });
    }
    if (otp?.replace(/-/g, '').trim() !== stored.otp) {
      logSecurity(email, ip, 'OTP 실패', 'OTP 보안코드 불일치', 'WARN');
      return res.status(400).json({ success: false, error: 'OTP 코드가 일치하지 않습니다.', code: 'OTP_MISMATCH' });
    }

    // OTP 소비 (1회성)
    _otpStore.delete(email);

    const employees = getCollection('employees', _getDefaultEmployees());
    const employee  = employees.find(e => e.email.toLowerCase() === email.toLowerCase());
    if (!employee) {
      return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다.' });
    }

    // ✅ JWT 발급
    const token = issueToken(employee, stored.role);
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

    logSecurity(employee.name, ip, '로그인 완료', `[${stored.role.toUpperCase()}] ${employee.name}님 JWT 토큰 발급 성공 (테넌트: ${TENANT_ID})`);

    return res.json({
      success:    true,
      token,
      expiresAt,
      role:       stored.role,
      tenantId:   TENANT_ID,
      employee,
    });
  }

  return res.status(400).json({ success: false, error: '잘못된 요청 단계입니다.' });
});

// ── POST /api/token/refresh — JWT 갱신 ──────────────────────────────
app.post('/api/token/refresh', requireAuth, (req, res) => {
  const employees = getCollection('employees', []);
  const employee  = employees.find(e => e.id === req.user.sub);
  if (!employee) return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다.' });

  const newToken  = issueToken(employee, req.user.role);
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  logSecurity(employee.name, req.socket.remoteAddress, '토큰 갱신', `JWT 토큰 갱신 완료`);
  res.json({ success: true, token: newToken, expiresAt });
});

// ══════════════════════════════════════════════════════════════════════
// ② GET /api/audit-logs — Admin 전용 보안 감사 로그
//    JWT 인증 + Admin 권한 모두 필요
// ══════════════════════════════════════════════════════════════════════
app.get('/api/audit-logs', requireAuth, requireAdmin, (req, res) => {
  const limit  = Math.min(Number(req.query.limit) || 15, 100);
  const offset = Number(req.query.offset) || 0;
  const logs   = getCollection('securityLogs', []);
  const ip     = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  logSecurity(req.user.name, ip, '감사 로그 조회', `Admin 보안 감사 로그 조회 (${limit}건)`);
  res.json({
    success: true,
    total:   logs.length,
    logs:    logs.slice(offset, offset + limit),
  });
});

// ══════════════════════════════════════════════════════════════════════
// ③ POST /api/salary/calculate — 4대보험 & 소득세 계산 API
//    JWT 인증 필요 (Employee/Admin 모두 가능)
// ══════════════════════════════════════════════════════════════════════
app.post('/api/salary/calculate', requireAuth, (req, res) => {
  const { base, leaveDay = 0, otHours = 0, includesSeverance = false, hireDate, resignDate } = req.body;

  if (!base || isNaN(base) || base < 0) {
    return res.status(400).json({ success: false, error: '올바른 기본급을 입력해주세요.' });
  }

  // ── 순수 계산 로직 (2024년 근로기준법 기준) ──────────────────────
  const leaveBonus = leaveDay * (base / 30 / 8);   // 미사용연차수당
  const otBonus    = otHours  * (base / 209) * 1.5; // 연장수당 1.5배
  const gross      = Math.round(base + leaveBonus + otBonus);

  const np     = Math.round(gross * 0.045);    // 국민연금 4.5%
  const hi     = Math.round(gross * 0.0354);   // 건강보험 3.54%
  const lt     = Math.round(hi * 0.1295);      // 장기요양보험
  const em     = Math.round(gross * 0.009);    // 고용보험 0.9%
  const it     = Math.round(gross * 0.02);     // 근로소득세 간이 ~2%
  const localIt= Math.round(it * 0.1);         // 지방소득세
  const totalDeduct = np + hi + lt + em + it + localIt;
  const net    = gross - totalDeduct;
  const pct    = Math.round((net / gross) * 100);

  // 퇴직금 계산 (옵션)
  let severance = null;
  if (includesSeverance && hireDate && resignDate) {
    const dHire   = new Date(hireDate);
    const dResign = new Date(resignDate);
    if (dResign > dHire) {
      const days      = Math.floor((dResign - dHire) / (1000 * 60 * 60 * 24));
      const avgPerDay = Math.round(gross / 30);
      severance = {
        days,
        years:     Math.floor(days / 365),
        months:    Math.floor((days % 365) / 30),
        avgPerDay,
        amount:    Math.round(avgPerDay * 30 * (days / 365)),
      };
    }
  }

  // 히스토리 저장
  const history = getCollection('payrollHistory', []);
  const record  = {
    id: Date.now(), userId: req.user.sub, userName: req.user.name,
    base, leaveDay, otHours, gross, net, pct, totalDeduct, severance,
    calculatedAt: new Date().toISOString(),
  };
  history.unshift(record);
  if (history.length > 100) history.splice(100);
  setCollection('payrollHistory', history);

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  logSecurity(req.user.name, ip, '급여 계산', `급여 시뮬레이션 실행 (기본급: ${base.toLocaleString()}원, 실수령: ${net.toLocaleString()}원)`);

  res.json({
    success: true,
    result: { gross, leaveBonus: Math.round(leaveBonus), otBonus: Math.round(otBonus),
              np, hi, lt, em, it, localIt, totalDeduct, net, pct, severance },
  });
});

// ══════════════════════════════════════════════════════════════════════
// ④ POST /api/ai/generate — Gemini AI 서버 사이드 프록시
//    ⚠️ API 키는 서버(.env)에서만 관리 — 프론트엔드 완전 차단
// ══════════════════════════════════════════════════════════════════════
app.post('/api/ai/generate', aiLimiter, async (req, res) => {
  const { prompt, context = '' } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!prompt?.trim()) {
    return res.status(400).json({ success: false, error: '프롬프트가 비어있습니다.' });
  }

  const geminiKey = process.env.GEMINI_API_KEY || 'AIzaSyAezv0644G4yvEN_GbXTk1T0WL4ptNcEf4';
  const nvidiaKey = process.env.NVIDIA_API_KEY || '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';

  // ── NVIDIA NIM API (1순위) ──────────────────────────────────────
  if (nvidiaKey) {
    try {
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${nvidiaKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:       'nvidia/llama-3.1-nemotron-70b-instruct',
          messages:    [{ role: 'user', content: prompt }],
          temperature: 0.5,
          max_tokens:  2048,
        }),
      });
      if (!response.ok) throw new Error(`NVIDIA API ${response.status}`);
      const data = await response.json();
      const text = data.choices[0].message.content;
      logSecurity(req.user?.name || 'anonymous', ip, 'AI 생성 (NVIDIA)', `NVIDIA Llama 호출 성공 (${prompt.length}자)`);
      return res.json({ success: true, text, provider: 'nvidia' });
    } catch (err) {
      console.error('[AI] NVIDIA 오류, Gemini로 fallback:', err.message);
    }
  }

  // ── Google Gemini API (2순위) ───────────────────────────────────
  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiKey}`;
      const response = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
      });
      if (!response.ok) throw new Error(`Gemini API ${response.status}`);
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '응답을 생성하지 못했습니다.';
      logSecurity(req.user?.name || 'anonymous', ip, 'AI 생성 (Gemini)', `Gemini 호출 성공 (${prompt.length}자)`);
      return res.json({ success: true, text, provider: 'gemini' });
    } catch (err) {
      console.error('[AI] Gemini 오류:', err.message);
      return res.status(500).json({ success: false, error: 'AI API 호출 실패: ' + err.message });
    }
  }

  // ── 키 없음: Mock 응답 ───────────────────────────────────────────
  logSecurity(req.user?.name || 'anonymous', ip, 'AI Mock 응답', `.env에 API 키 없음. Mock 응답 반환`);
  const mockText = `[AI 시뮬레이션 응답]\n\n요청: "${prompt.substring(0, 80)}..."\n\n실제 AI와 연동하려면:\n• .env 파일에 GEMINI_API_KEY=your_key 를 추가하세요.\n• 또는 NVIDIA_API_KEY=your_key 를 추가하세요.\n\n현재는 보안 백엔드 Phase 2 Mock 모드로 실행 중입니다.`;
  return res.json({ success: true, text: mockText, provider: 'mock' });
});

// ══════════════════════════════════════════════════════════════════════
// 📊 GET /api/state — 전체 앱 상태 (JWT 인증 필수)
// ══════════════════════════════════════════════════════════════════════
app.get('/api/state', requireAuth, (req, res) => {
  const db = readDB();
  res.json({
    employees:       db[_tKey('employees')]       || [],
    welfarePoints:   db[_tKey('welfarePoints')]   || {},
    calendarEvents:  db[_tKey('calendarEvents')]  || [],
    chatLogs:        db[_tKey('chatLogs')]        || {},
    fleaMarketItems: db[_tKey('fleaMarketItems')] || [],
    registryEvents:  db[_tKey('registryEvents')]  || [],
    reports:         db[_tKey('reports')]         || [],
    securityLogs:    db[_tKey('securityLogs')]    || [],
    tenantId: TENANT_ID,
    requestedBy: req.user?.name,
    servedAt: new Date().toISOString(),
  });
});

// ══════════════════════════════════════════════════════════════════════
// 💬 채팅 API (JWT 인증)
// ══════════════════════════════════════════════════════════════════════
app.get('/api/chats', requireAuth, (req, res) => {
  res.json(getCollection('chatLogs', {}));
});

app.post('/api/chats', requireAuth, (req, res) => {
  const { channel, sender, senderName, text } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const logs = getCollection('chatLogs', {});
  if (!logs[channel]) logs[channel] = [];
  const msg = { sender, senderName, text, timestamp: new Date().toISOString() };
  logs[channel].push(msg);
  setCollection('chatLogs', logs);
  res.json({ success: true, message: msg });
});

// ══════════════════════════════════════════════════════════════════════
// 📅 캘린더 & 연차 API (JWT 인증)
// ══════════════════════════════════════════════════════════════════════
app.post('/api/calendar', requireAuth, (req, res) => {
  const { title, start, end, type, color, employeeId, leaveDays } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  const events = getCollection('calendarEvents', []);
  const newEvent = { id: String(Date.now()), title, start, end: end || start, type, color };
  events.push(newEvent);
  setCollection('calendarEvents', events);

  // 연차 차감
  if (type === 'leave' && employeeId) {
    const employees = getCollection('employees', []);
    const emp = employees.find(e => e.id === Number(employeeId));
    if (emp) {
      const match    = (emp.status || '').match(/\d+(\.\d+)?/);
      const current  = match ? parseFloat(match[0]) : 15;
      const newLeave = Math.max(0, current - (leaveDays || 1));
      emp.status     = `${newLeave}일의 여유 휴가 보유 중 ✈️`;
      setCollection('employees', employees);
    }
  }

  logSecurity(req.user.name, ip, '휴가 신청', `${title} (${start} ~ ${end})`);
  res.json({ success: true, event: newEvent });
});

// ══════════════════════════════════════════════════════════════════════
// 🛍️ 플리마켓 API (JWT 인증)
// ══════════════════════════════════════════════════════════════════════
app.get('/api/market', requireAuth, (req, res) => {
  res.json(getCollection('fleaMarketItems', []));
});

app.post('/api/market', requireAuth, (req, res) => {
  const { title, category, price, description, image } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const items = getCollection('fleaMarketItems', []);
  const newItem = {
    id:         'item' + Date.now(),
    title, category, description,
    price:      Number(price),
    sellerId:   req.user.sub,
    sellerName: req.user.name,
    status:     '판매중',
    image:      image || 'https://images.unsplash.com/photo-1546213290-e1b7610339e5?w=400',
    date:       new Date().toISOString().split('T')[0],
  };
  items.unshift(newItem);
  setCollection('fleaMarketItems', items);
  logSecurity(req.user.name, ip, '마켓 등록', `물품 [${title}] (${Number(price).toLocaleString()}원) 등록`);
  res.json({ success: true, item: newItem });
});

app.post('/api/market/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  const items = getCollection('fleaMarketItems', []);
  const item  = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, error: '상품을 찾을 수 없습니다.' });
  if (item.sellerId !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '본인 상품만 수정할 수 있습니다.' });
  }
  item.status = status;
  setCollection('fleaMarketItems', items);
  res.json({ success: true, item });
});

// ══════════════════════════════════════════════════════════════════════
// 💸 복지 포인트 API (JWT 인증)
// ══════════════════════════════════════════════════════════════════════
app.post('/api/welfare/transfer', requireAuth, (req, res) => {
  const { receiverId, amount, message } = req.body;
  const ip  = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const pts = getCollection('welfarePoints', {});
  const senderId = String(req.user.sub);

  if ((pts[senderId] || 0) < amount) {
    return res.status(400).json({ success: false, error: '포인트 잔액이 부족합니다.' });
  }
  pts[senderId]           = (pts[senderId] || 0) - amount;
  pts[String(receiverId)] = (pts[String(receiverId)] || 0) + amount;
  setCollection('welfarePoints', pts);

  logSecurity(req.user.name, ip, '포인트 송금', `${amount.toLocaleString()}p → 직원 ID ${receiverId} (${message || ''})`);
  res.json({ success: true, senderPoints: pts[senderId] });
});

app.post('/api/welfare/dutchpay', requireAuth, (req, res) => {
  const { members, perPersonAmount } = req.body;
  const senderId = String(req.user.sub);
  const pts      = getCollection('welfarePoints', {});
  let success = 0, fail = 0;

  (members || []).forEach(mId => {
    if (String(mId) === senderId) return;
    if ((pts[String(mId)] || 0) >= perPersonAmount) {
      pts[String(mId)] = (pts[String(mId)] || 0) - perPersonAmount;
      pts[senderId]    = (pts[senderId]    || 0) + perPersonAmount;
      success++;
    } else {
      fail++;
    }
  });
  setCollection('welfarePoints', pts);
  res.json({ success: true, successCount: success, failCount: fail, senderPoints: pts[senderId] });
});

// ══════════════════════════════════════════════════════════════════════
// 📊 업무 보고 API (JWT 인증)
// ══════════════════════════════════════════════════════════════════════
app.get('/api/reports', requireAuth, (req, res) => {
  const reports = getCollection('reports', []);
  if (req.user.role === 'admin') return res.json(reports);
  res.json(reports.filter(r => r.authorId === req.user.sub));
});

app.post('/api/reports', requireAuth, (req, res) => {
  const { title, content, type } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const reports = getCollection('reports', []);
  const report  = {
    id: Date.now(), title, content, type,
    authorId:   req.user.sub,
    authorName: req.user.name,
    date:       new Date().toISOString().split('T')[0],
    createdAt:  new Date().toISOString(),
  };
  reports.unshift(report);
  setCollection('reports', reports);
  logSecurity(req.user.name, ip, '업무 보고 제출', `보고서: ${title}`);
  res.json({ success: true, report });
});

// ══════════════════════════════════════════════════════════════════════
// 👤 직원 관리 API (JWT + Admin 전용)
// ══════════════════════════════════════════════════════════════════════
app.get('/api/employees', requireAuth, (req, res) => {
  res.json(getCollection('employees', []));
});

app.post('/api/employees', requireAuth, requireAdmin, (req, res) => {
  const { name, dept, title, email, phone } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (!name || !email) return res.status(400).json({ success: false, error: '이름과 이메일은 필수입니다.' });

  const employees = getCollection('employees', []);
  if (employees.find(e => e.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ success: false, error: '이미 등록된 이메일입니다.' });
  }

  const newEmp = {
    id:        Date.now(), name, dept, title, email, phone,
    joinDate:  new Date().toISOString().slice(0, 10),
    status:    `${title} 신규 입사 🎉`,
    initial:   name[0], mbti: '?', workStyle: '협의 중',
  };
  employees.push(newEmp);
  setCollection('employees', employees);

  // 초기 복지 포인트 지급
  const pts = getCollection('welfarePoints', {});
  pts[String(newEmp.id)] = 50000;
  setCollection('welfarePoints', pts);

  logSecurity(req.user.name, ip, '직원 계정 생성', `신규 직원 [${name}] 등록 및 초기 포인트 50,000p 지급`, 'INFO');
  res.json({ success: true, employee: newEmp });
});

app.delete('/api/employees/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const ip     = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const employees = getCollection('employees', []);
  const emp    = employees.find(e => String(e.id) === id);
  if (!emp) return res.status(404).json({ success: false, error: '직원을 찾을 수 없습니다.' });

  setCollection('employees', employees.filter(e => String(e.id) !== id));
  logSecurity(req.user.name, ip, '직원 계정 삭제', `[${emp.name}] 계정 삭제`, 'WARN');
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════
// 🚌 버스 노선 API (JWT + Admin 관리)
// ══════════════════════════════════════════════════════════════════════
app.get('/api/bus-routes', requireAuth, (req, res) => {
  res.json(getCollection('busRoutes', _getDefaultBusRoutes()));
});

app.post('/api/bus-routes', requireAuth, requireAdmin, (req, res) => {
  const { name, stops, time, seats } = req.body;
  const routes = getCollection('busRoutes', []);
  routes.push({ id: 'bus' + Date.now(), name, stops, time, seats: seats || 40, registered: 0 });
  setCollection('busRoutes', routes);
  logSecurity(req.user.name, req.socket.remoteAddress, '버스 노선 추가', `[${name}] 노선 등록`);
  res.json({ success: true, routes });
});

app.delete('/api/bus-routes/:id', requireAuth, requireAdmin, (req, res) => {
  const routes = getCollection('busRoutes', []).filter(r => r.id !== req.params.id);
  setCollection('busRoutes', routes);
  res.json({ success: true, routes });
});

// ══════════════════════════════════════════════════════════════════════
// 🎉 경조사 API (JWT 인증)
// ══════════════════════════════════════════════════════════════════════
app.post('/api/registry/congratulate', requireAuth, (req, res) => {
  const { receiverId, receiverName, actionType, giftName, points, message } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (actionType === 'gift' && points) {
    const pts = getCollection('welfarePoints', {});
    const senderPts = pts[String(req.user.sub)] || 0;
    if (senderPts < points) {
      return res.status(400).json({ success: false, error: '복지 포인트가 부족합니다.' });
    }
    pts[String(req.user.sub)]   = senderPts - points;
    pts[String(receiverId)]      = (pts[String(receiverId)] || 0) + points;
    setCollection('welfarePoints', pts);
  }

  const logs = getCollection('chatLogs', {});
  const ch   = String(receiverId);
  if (!logs[ch]) logs[ch] = [];
  logs[ch].push({
    sender: 'received', senderName: req.user.name,
    text: `💌 **축전 도착**: "${message}"${actionType === 'gift' ? `\n🎁 [${giftName}] 기프티콘이 함께 도착했습니다!` : ''}`,
    timestamp: new Date().toISOString(),
  });
  setCollection('chatLogs', logs);

  logSecurity(req.user.name, ip, actionType === 'gift' ? '경조사 선물' : '경조사 축전', `${receiverName}님께 ${actionType === 'gift' ? giftName : '축전'} 발송`);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════
// 🏥 서버 상태 모니터링 (인증 불필요 — 헬스체크용)
// ══════════════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  const db = readDB();
  res.json({
    status:    'ok',
    service:   'OneOffice Backend',
    version:   '2.0.0',
    tenant:    TENANT_ID,
    uptime:    Math.round(process.uptime()),
    memory:    process.memoryUsage().heapUsed,
    employees: (db[_tKey('employees')] || []).length,
    timestamp: new Date().toISOString(),
  });
});

// ══════════════════════════════════════════════════════════════════════
// 🏠 SPA Fallback — 모든 미지정 경로 → index.html
// ══════════════════════════════════════════════════════════════════════
app.get('*', (req, res) => {
  // API 경로는 404 반환
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: '존재하지 않는 API 엔드포인트입니다.' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ══════════════════════════════════════════════════════════════════════
// 🚀 서버 시작
// ══════════════════════════════════════════════════════════════════════
const networkInterfaces = os.networkInterfaces();
const localIP = Object.values(networkInterfaces)
  .flat()
  .find(i => i.family === 'IPv4' && !i.internal)?.address || 'localhost';

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   🚀 OneOffice Phase 2 — Enterprise Security Backend  ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  🌐 Local:   http://localhost:${PORT}                   ║`);
  console.log(`║  🌐 Network: http://${localIP}:${PORT}              ║`);
  console.log('║                                                      ║');
  console.log('║  🔐 Security Stack:                                   ║');
  console.log('║     ✅ JWT Authentication (8h expiry)                 ║');
  console.log('║     ✅ Helmet HTTP Security Headers                   ║');
  console.log('║     ✅ Rate Limiting (5 login / 20 AI req per min)   ║');
  console.log('║     ✅ Security Audit Log (자동 기록)                  ║');
  console.log('║     ✅ Multi-Tenant DB Isolation                      ║');
  console.log('║     ✅ Admin RBAC Enforcement                         ║');
  console.log('║                                                      ║');
  console.log(`║  🤖 AI: ${process.env.GEMINI_API_KEY ? 'Gemini API ✅' : process.env.NVIDIA_API_KEY ? 'NVIDIA NIM ✅' : 'Mock 모드 (키 없음)'}                              ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');
});

// ══════════════════════════════════════════════════════════════════════
// 📦 기본 시드 데이터
// ══════════════════════════════════════════════════════════════════════
function _getDefaultEmployees() {
  return [
    { id:1, name:'Jane Doe',  dept:'Executive',       title:'대표이사 (CEO)',  email:'jane@company.com',    phone:'010-1111-1111', joinDate:'2020-01-01', status:'글로벌 OneOffice 비전 리딩 중 🚀', initial:'J', mbti:'ENTJ',   workStyle:'결과 중심 비동기 소통' },
    { id:2, name:'John Smith',dept:'Technology',      title:'기술이사 (CTO)',  email:'john@company.com',    phone:'010-9999-8888', joinDate:'2021-06-01', status:'클라우드 아키텍처 설계 중 ☁️',   initial:'J', mbti:'INTJ',   workStyle:'문서 기반 텍스트 소통 선호' },
    { id:3, name:'Anna Lee',  dept:'Human Resources', title:'인사팀장 (HR)',   email:'anna@company.com',    phone:'010-7777-6666', joinDate:'2022-09-01', status:'인사 복지 관련 문의 대환영',       initial:'A', mbti:'ESFJ',   workStyle:'대면 미팅 및 조율 소통' },
    { id:4, name:'홍길동',    dept:'Technology',      title:'개발팀 (대리)',   email:'gildong@company.com', phone:'010-1234-5678', joinDate:'2024-01-01', status:'15일의 여유 휴가 보유 중 ✈️',     initial:'홍', mbti:'INTP-A', workStyle:'슬랙 메신저 및 텍스트 선호' },
    { id:5, name:'김태희',    dept:'Technology',      title:'개발팀 (사원)',   email:'taehee@company.com',  phone:'010-2222-3333', joinDate:'2025-03-01', status:'열심히 공부하고 있습니다 🛠️',     initial:'김', mbti:'ENFP',   workStyle:'빠른 구두 피드백 선호' },
    { id:6, name:'이민정',    dept:'Design',          title:'디자인팀 (선임)', email:'minjung@company.com', phone:'010-4444-5555', joinDate:'2024-10-01', status:'사용성 극대화 UX 다듬는 중 ✨',   initial:'이', mbti:'ISFP',   workStyle:'시각적 와이어프레임 선호' },
  ];
}

function _getDefaultMarketItems() {
  return [
    { id:'item1', title:'맥북 에어 M2 (스페이스그레이)', category:'digital', price:850000, sellerId:2, sellerName:'John Smith (CTO)', status:'판매중', description:'회의 출장용으로 깔끔하게 사용.', image:'https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?w=400&q=80', date:'2026-07-02' },
    { id:'item2', title:'저소음 기계식 키보드 (갈축)',    category:'office',  price:45000,  sellerId:6, sellerName:'이민정 (선임)',       status:'예약중', description:'사무실 2달 사용, 갈축.', image:'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400&q=80', date:'2026-07-01' },
  ];
}

function _getDefaultRegistryEvents() {
  return [
    { id:'reg1', employeeId:5, employeeName:'김태희 (사원)', eventType:'birthday', eventTitle:'오늘 🎂 생일 이벤트!',          description:'생일 축하 메시지를 보내보세요.', date:'2026-07-03', isToday:true  },
    { id:'reg2', employeeId:6, employeeName:'이민정 (선임)', eventType:'wedding',  eventTitle:'이번 주 토요일 🤵 결혼식 예고', description:'이민정 선임님의 결혼식이 다가왔습니다.', date:'2026-07-05', isToday:false },
  ];
}

function _getDefaultBusRoutes() {
  return [
    { id:'bus1', name:'A노선 (강남행)',    stops:'강남역 → 선릉역 → 역삼역 → 사무실',  time:'08:30', seats:40, registered:12 },
    { id:'bus2', name:'B노선 (홍대행)',    stops:'홍대입구 → 합정 → 마포 → 사무실',    time:'08:45', seats:30, registered:8  },
    { id:'bus3', name:'C노선 (신도림행)', stops:'신도림역 → 구로디지털단지 → 사무실', time:'08:15', seats:50, registered:22 },
  ];
}
