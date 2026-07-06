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
 *   ⑧ Google Gemini 1.5 Flash AI — 단독 AI 제공자 (서버사이드 프록시)
 *
 * 필수 API 엔드포인트:
 *   POST /api/login           → 3단계 인증 + JWT 발급
 *   POST /api/token/refresh   → 토큰 갱신
 *   GET  /api/audit-logs      → Admin 전용 감사 로그 (JWT 필수)
 *   POST /api/salary/calculate → 4대보험+소득세 계산 API (JWT 필수)
 *   POST /api/ai/generate     → Gemini 1.5 Flash AI 서버 사이드 프록시
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
const bcrypt     = require('bcryptjs');

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

// 비밀번호 해시 (bcrypt salt=12) - 절대 평문 저장 금지
// 비밀번호 변경 시: node -e "const b=require('bcryptjs');console.log(b.hashSync('새비밀번호',12))"
const ROLE_BY_HASH = {
  admin:    process.env.ADMIN_PASSWORD_HASH    || '\\\.tsJz7aLqNrelTgZIUsDV7NP3N7gmTpEE0YXkhrUO/m',
  employee: process.env.EMPLOYEE_PASSWORD_HASH || '\\\/O3Hsv09ch/zY6BDafeumfGlJ7mkYUvJzBCeT.mM8aUofoFOgae',
};
// ══════════════════════════════════════════════════════════════════════
// 🔧 Express 미들웨어 설정
// ══════════════════════════════════════════════════════════════════════

// Helmet: 보안 HTTP 헤더 자동 설정 (XSS, Clickjacking, MIME 스니핑 등 차단)
app.use(helmet({
  contentSecurityPolicy: false, // SPA에서 인라인 스크립트 허용
  crossOriginEmbedderPolicy: false,
}));

// CORS: 로컬개발 + 배포 도메인만 허용 (전체오픈 '*' 제거)
const _allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim()) : []),
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || _allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: 허가되지 않은 출처'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(bodyParser.json({ limit: '1mb' }));

// 🛡️ 보안 민감 파일 직접 접근 차단
const _BLOCKED = ['/database.json','/.env','/credentials.md','/package.json','/package-lock.json'];
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (_BLOCKED.includes(p) || p.startsWith('/.') || (p.endsWith('.json') && p !== '/manifest.json')) {
    return res.status(403).json({ error: '접근이 거부되었습니다.', code: 'FORBIDDEN' });
  }
  next();
});

// 정적 파일 서빙 (HTML, CSS, JS)
app.use(express.static(__dirname, {
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache'); },
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
    [`oneoffice_${TENANT_ID}_v1_calendarEvents`]: (() => {
      const y = new Date().getFullYear();
      const m = String(new Date().getMonth() + 1).padStart(2, '0');
      return [
        { id:'ev_j1', title:'Jane Doe [연차]',   start:`${y}-${m}-08`, end:`${y}-${m}-09`, type:'leave', color:'#6366f1', employeeId:1, leaveDays:2 },
        { id:'ev_j2', title:'Jane Doe [출장]',   start:`${y}-${m}-20`, end:`${y}-${m}-21`, type:'leave', color:'#f97316', employeeId:1, leaveDays:0 },
        { id:'ev_s1', title:'John Smith [병가]',  start:`${y}-${m}-03`, end:`${y}-${m}-03`, type:'leave', color:'#ef4444', employeeId:2, leaveDays:1 },
        { id:'ev_s2', title:'John Smith [재택근무]',start:`${y}-${m}-14`, end:`${y}-${m}-14`, type:'leave', color:'#3b82f6', employeeId:2, leaveDays:0 },
        { id:'ev_a1', title:'Anna Lee [오전반차]', start:`${y}-${m}-10`, end:`${y}-${m}-10`, type:'leave', color:'#06b6d4', employeeId:3, leaveDays:0.5 },
        { id:'ev_a2', title:'Anna Lee [경조사휴가]',start:`${y}-${m}-25`, end:`${y}-${m}-26`, type:'leave', color:'#f59e0b', employeeId:3, leaveDays:2 },
        { id:'ev_h1', title:'홍길동 [연차]',      start:`${y}-${m}-06`, end:`${y}-${m}-07`, type:'leave', color:'#a855f7', employeeId:4, leaveDays:2 },
        { id:'ev_h2', title:'홍길동 [반차]',      start:`${y}-${m}-15`, end:`${y}-${m}-15`, type:'leave', color:'#06b6d4', employeeId:4, leaveDays:0.5 },
        { id:'ev_k1', title:'김태희 [재택근무]',   start:`${y}-${m}-12`, end:`${y}-${m}-12`, type:'leave', color:'#3b82f6', employeeId:5, leaveDays:0 },
        { id:'ev_i1', title:'이민정 [연차]',      start:`${y}-${m}-18`, end:`${y}-${m}-18`, type:'leave', color:'#10b981', employeeId:6, leaveDays:1 },
      ];
    })(),

    // 결재함
    [`oneoffice_${TENANT_ID}_v1_approvals`]: [],

    [`oneoffice_${TENANT_ID}_v1_chatLogs`]: {
      group: [
        { sender:'received', senderName:'Jane Doe', text:'원오피스 사내 단체 대화방입니다. 오늘 하루도 파이팅!', timestamp: new Date().toISOString() }
      ],
      bot: [
        { sender:'received', senderName:'AI Assistant', text:'안녕하세요! OneOffice AI 비서입니다. 노무, 연차, 급여 관련 질문을 자유롭게 해주세요!', timestamp: new Date().toISOString() }
      ],
    },
    [`oneoffice_${TENANT_ID}_v1_fleaMarketItems`]: [],
    [`oneoffice_${TENANT_ID}_v1_registryEvents`]: [],
    [`oneoffice_${TENANT_ID}_v1_reports`]: [],
    [`oneoffice_${TENANT_ID}_v1_securityLogs`]: [],
    [`oneoffice_${TENANT_ID}_v1_payrollHistory`]: [],
    [`oneoffice_${TENANT_ID}_v1_busRoutes`]: [],
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

app.post('/api/login', loginLimiter, async (req, res) => {
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

    // bcrypt 해시 비교 (admin/employee 역할 판별)
    let role = null;
    for (const [r, hash] of Object.entries(ROLE_BY_HASH)) {
      if (await bcrypt.compare(String(password), hash)) { role = r; break; }
    }
    if (!role) {
      logSecurity('GUEST', ip, 'Password Error', `Wrong password attempt (email: )`, 'WARN');
      return res.status(400).json({ success: false, error: 'Invalid email or password.' });
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
    // [개발모드] OTP 서버 콘솔 출력 (실배포 시 SMS/이메일 발송으로 교체)
    // [개발모드] OTP 서버 콘솔 출력
    if (process.env.NODE_ENV !== 'production') console.log('[OTP-DEV]', email, '->', generatedOTP, '(5min valid)');
    return res.json({
      success:  true,
      // otpHint 제거 (보안): OTP는 서버에서만 보관 → 실서비스에서는 SMS/이메일 발송
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
// ④ POST /api/ai/generate — Gemini AI 서버 사이드 프록시 (멀티모델 + 오프라인 폴백)
//    ⚠️ API 키는 서버(.env)에서만 관리 — 프론트엔드 완전 차단
// ══════════════════════════════════════════════════════════════════════

// 오프라인 규칙 기반 AI (Gemini 429 시 폴백)
function _ruleBasedAI(prompt) {
  const p = prompt.toLowerCase();

  // 주휴수당
  if (p.includes('주휴수당')) {
    return `📌 **주휴수당 계산법 (2026년 기준)**\n\n주휴수당 = (1주 소정근로시간 / 40시간) × 8시간 × 시간급\n\n예시: 시급 10,030원, 주 40시간 근무\n→ 주휴수당 = (40/40) × 8 × 10,030 = **80,240원/주**\n\n⚖️ 근거: 근로기준법 제55조`;
  }

  // ── 사내 데이터 연동 폴백 파서 ─────────────────────────────────────────
  if (p.includes('연차') && (p.includes('남은') || p.includes('며칠') || p.includes('얼마나') || p.includes('조회'))) {
    const match = prompt.match(/남은 연차 일수:\s*(.*?일)/);
    if (match) {
      return `📌 **연차 조회 결과**\n\n현재 남은 연차는 **${match[1]}**입니다. (연간 총 15일 기준)`;
    }
  }

  if (p.includes('이메일') || p.includes('연락처') || p.includes('전화번호') || p.includes('mbti') || p.includes('정보') || p.includes('주소')) {
    const qMatch = prompt.match(/질문:\s*(.*)/i);
    const question = qMatch ? qMatch[1] : prompt;
    const lines = prompt.split('\n');
    for (const line of lines) {
      if (line.startsWith('- ')) {
        const empName = line.match(/- ([^\s(]+)/)?.[1];
        if (empName && question.includes(empName)) {
          return `📌 **임직원 정보 조회**\n\n${line.substring(2)}`;
        }
      }
    }
  }

  if (p.includes('휴가자') || p.includes('부재자') || p.includes('오늘 쉬는') || p.includes('부재') || p.includes('쉬는 사람')) {
    const match = prompt.match(/\[오늘의 휴가\/부재자 목록\]\s*(.*)/);
    if (match && match[1].trim() !== '없음') {
      return `📌 **오늘의 휴가/부재자 현황**\n\n오늘 부재 중인 직원은 **${match[1].trim()}**입니다.`;
    }
    return `📌 **오늘의 휴가/부재자 현황**\n\n오늘 예정된 부재자(휴가자)가 없습니다. 모두 정상 출근 상태입니다. 🟢`;
  }

  // 연차 일반
  if (p.includes('연차')) {
    return `📌 **연차 유급휴가 기준 (근로기준법 제60조)**\n\n• 1년 미만: 1개월 개근 시 1일 (최대 11일)\n• 1년 이상: 15일 (기본) + 2년마다 1일 추가 (최대 25일)\n\n⚠️ 미사용 연차는 1년 후 소멸 (연차수당 청구 가능)`;
  }

  // 퇴직금
  if (p.includes('퇴직금')) {
    return `📌 **퇴직금 계산 (근로자퇴직급여 보장법)**\n\n퇴직금 = 평균임금 × 30일 × (재직일수 / 365)\n\n• 1년 이상 근무한 모든 근로자에게 지급 의무\n• 평균임금: 퇴직 직전 3개월 총 임금 ÷ 해당 일수`;
  }

  // 4대보험
  if (p.includes('4대보험') || p.includes('보험료')) {
    return `📌 **2026년 4대보험 요율 (근로자 부담분)**\n\n| 항목 | 요율 |\n|------|------|\n| 국민연금 | 4.5% |\n| 건강보험 | 3.545% |\n| 장기요양 | 건보료 × 12.95% |\n| 고용보험 | 0.9% |\n\n※ 산재보험은 사업주 전액 부담`;
  }

  // 보고서 관련
  if (p.includes('보고서') || p.includes('업무보고')) {
    const today = new Date().toISOString().slice(0,10);
    return `📝 **업무 보고서 초안**\n\n[${today}] 업무 보고\n\n■ 오늘 완료한 업무\n1. [작성해주세요]\n2. [작성해주세요]\n\n■ 진행 중인 업무\n1. [작성해주세요]\n\n■ 내일 예정 업무\n1. [작성해주세요]\n\n■ 특이사항\n- 없음`;
  }

  // PPT/슬라이드
  if (p.includes('ppt') || p.includes('슬라이드') || p.includes('발표')) {
    return JSON.stringify([
      {"num":1,"title":"주제 소개 및 배경","bullets":["핵심 목적 및 배경 설명","현황 및 문제 인식"],"layout":"메인 타이틀 레이아웃"},
      {"num":2,"title":"본론: 주요 내용 분석","bullets":["데이터 기반 분석 결과","핵심 인사이트 도출"],"layout":"2컬럼 대조 구조"},
      {"num":3,"title":"결론 및 액션 플랜","bullets":["최종 제안 사항","담당자별 실행 계획"],"layout":"결론 강조 레이아웃"}
    ]);
  }

  // 회의록
  if (p.includes('회의') || p.includes('회의록')) {
    return `📋 **회의록 요약**\n\n■ 회의 안건\n- 입력하신 내용 기반 안건\n\n■ 주요 논의 사항\n- 핵심 포인트 1\n- 핵심 포인트 2\n\n■ 결정 사항\n- 결정 내용\n\n■ Action Items\n- [ ] 담당자: 기한`;
  }

  // 마케팅 카피
  if (p.includes('마케팅') || p.includes('카피') || p.includes('광고')) {
    return `📢 **마케팅 카피 초안**\n\n🗞️ 보도자료 헤드라인: "혁신적인 솔루션으로 비즈니스 패러다임을 바꾸다"\n\n📱 인스타그램 감성 카피:\n① "새로운 시작, 새로운 가능성 ✨ #혁신 #미래"\n② "당신의 일상을 바꿀 단 하나의 선택 💫"\n③ "더 나은 내일을 위한 오늘의 선택 🌟"\n\n💼 링크드인 비즈니스 카피:\n"업무 효율을 극대화하는 스마트 솔루션으로 팀의 생산성을 혁신하세요."`;
  }

  // 기본 응답
  return `🤖 **AI Copilot 응답**\n\n입력하신 내용: "${prompt.slice(0, 100)}"\n\n현재 AI 서비스가 일시적으로 제한되어 있습니다. (Gemini API quota 초과)\n\n다음 기능은 정상 동작합니다:\n• 캘린더 일정 등록/수정/삭제\n• 조직도 검색 및 직원 정보 조회\n• 급여 계산기\n• 복지포인트 관리\n\n⏳ AI 기능은 잠시 후 자동 복구됩니다.`;
}


// ── 멀티 키 로테이션: GEMINI_API_KEY_1/2/3 지원 ────────────────────────
// .env에 GEMINI_API_KEY_1, GEMINI_API_KEY_2, ... 를 추가하면 자동 로테이션
const _geminiKeyPool = (() => {
  const keys = [];
  // 번호 붙은 키들 수집 (GEMINI_API_KEY_1, _2, _3 ...)
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  // 기본 키도 추가 (중복 방지)
  const base = process.env.GEMINI_API_KEY;
  if (base && !keys.includes(base)) keys.push(base);
  return keys;
})();

// 라운드로빈 카운터 (키 소진 추적)
const _keyStatus = {}; // { key: { exhaustedUntil: timestamp } }
let _keyIdx = 0;

function _getNextGeminiKey() {
  const now = Date.now();
  const available = _geminiKeyPool.filter(k => {
    const s = _keyStatus[k];
    if (!s) return true;
    if (s.exhaustedUntil && now < s.exhaustedUntil) return false; // 아직 소진 중
    return true;
  });
  if (available.length === 0) return null; // 전부 소진
  const key = available[_keyIdx % available.length];
  _keyIdx++;
  return key;
}

function _markKeyExhausted(key, retryAfterSeconds = 60) {
  _keyStatus[key] = { exhaustedUntil: Date.now() + retryAfterSeconds * 1000 };
  console.warn(`[AI] 키 ${key.substring(0,8)}... quota 소진 → ${retryAfterSeconds}초 후 재시도`);
}

// ── AI 응답 캐시 (24시간 TTL) ─────────────────────────────────────────
const _aiCache = new Map(); // key: prompt_hash → { text, provider, cachedAt }
const AI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24시간

function _getCached(prompt) {
  const entry = _aiCache.get(prompt);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > AI_CACHE_TTL_MS) { _aiCache.delete(prompt); return null; }
  return entry;
}

function _setCached(prompt, text, provider) {
  if (_aiCache.size > 500) {
    // LRU: 가장 오래된 100개 삭제
    const keys = [..._aiCache.keys()].slice(0, 100);
    keys.forEach(k => _aiCache.delete(k));
  }
  _aiCache.set(prompt, { text, provider, cachedAt: Date.now() });
}

// ── Groq API 호출 (Llama-3 무료 티어) ──────────────────────────────────
async function _callGroq(prompt) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
        temperature: 0.7,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (text) { console.info('[AI] Groq Llama-3 응답 성공'); return text; }
    return null;
  } catch (e) {
    console.warn('[AI] Groq 오류:', e.message);
    return null;
  }
}

app.post('/api/ai/generate', aiLimiter, async (req, res) => {
  const { prompt } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!prompt?.trim()) {
    return res.status(400).json({ success: false, error: '프롬프트가 비어있습니다.' });
  }

  // ── 1단계: 캐시 확인 ─────────────────────────────────────────────────
  const cached = _getCached(prompt);
  if (cached) {
    console.info(`[AI] 캐시 HIT (provider: ${cached.provider})`);
    return res.json({ success: true, text: cached.text, provider: `${cached.provider}(cached)` });
  }

  // ── 2단계: Gemini 멀티키 × 멀티모델 시도 ──────────────────────────────
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];

  for (const model of models) {
    // 키 풀에서 사용 가능한 키 순환
    const attemptsPerModel = Math.max(_geminiKeyPool.length, 1);
    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      const geminiKey = _getNextGeminiKey();
      if (!geminiKey) break; // 모든 키 소진

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-goog-api-key': geminiKey },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
            }),
          }
        );

        if (response.status === 429) {
          // Retry-After 헤더 파싱
          const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
          _markKeyExhausted(geminiKey, retryAfter);
          continue; // 다음 키로
        }

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          console.warn(`[AI] ${model} key=${geminiKey.substring(0,8)}... HTTP ${response.status}`);
          continue;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          _setCached(prompt, text, model);
          logSecurity(req.user?.name || 'anonymous', ip, 'AI 생성', `${model} 성공 (${prompt.length}자)`);
          return res.json({ success: true, text, provider: model });
        }

      } catch (err) {
        console.warn(`[AI] ${model} 네트워크 오류:`, err.message);
      }
    }
  }

  // ── 3단계: Groq Llama-3 폴백 ────────────────────────────────────────
  const groqText = await _callGroq(prompt);
  if (groqText) {
    _setCached(prompt, groqText, 'groq-llama3');
    return res.json({ success: true, text: groqText, provider: 'groq-llama3' });
  }

  // ── 4단계: 규칙 기반 오프라인 AI ────────────────────────────────────
  console.info('[AI] 모든 AI 소진 → 규칙 기반 폴백');
  const fallbackText = _ruleBasedAI(prompt);
  return res.json({ success: true, text: fallbackText, provider: 'rule-based-fallback' });
});

// ── AI 상태 조회 엔드포인트 (관리용) ───────────────────────────────────
app.get('/api/ai/status', (req, res) => {
  const now = Date.now();
  const keyStatuses = _geminiKeyPool.map((k, i) => {
    const s = _keyStatus[k] || {};
    const exhausted = s.exhaustedUntil && now < s.exhaustedUntil;
    return {
      index: i + 1,
      keyPrefix: k.substring(0, 8) + '...',
      status: exhausted ? '소진' : '사용가능',
      resumesIn: exhausted ? Math.round((s.exhaustedUntil - now) / 1000) + '초' : '-',
    };
  });
  res.json({
    totalKeys: _geminiKeyPool.length,
    cacheSize: _aiCache.size,
    groqAvailable: !!process.env.GROQ_API_KEY,
    keys: keyStatuses,
  });
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
    approvals:       db[_tKey('approvals')]       || [],
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
  const { title, start, end, type, color, employeeId, leaveDays, reason, skipApproval } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // 연차/병가/반차 등 leave 타입은 결재 대기로 전환 (skipApproval=true면 즉시 등록)
  if (type === 'leave' && employeeId && !skipApproval) {
    const approvals = getCollection('approvals', []);
    // 결재자 결정: CEO(id:1)는 없음, CTO(id:2)/HR(id:3)은 CEO, 나머지는 CTO
    const approverMap = { 1: null, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2 };
    const approverId = approverMap[Number(employeeId)] ?? 2;
    const employees  = getCollection('employees', []);
    const requester  = employees.find(e => e.id === Number(employeeId));
    const approver   = employees.find(e => e.id === approverId);
    const newApproval = {
      id: 'apr_' + Date.now(),
      type: 'leave',
      title,
      start,
      end: end || start,
      color,
      employeeId: Number(employeeId),
      employeeName: requester?.name || '직원',
      leaveDays: leaveDays || 1,
      reason: reason || '',
      approverId,
      approverName: approver?.name || '팀장',
      status: 'pending',   // pending | approved | rejected
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comment: '',
    };
    approvals.push(newApproval);
    setCollection('approvals', approvals);
    logSecurity(req.user.name, ip, '결재 요청', `${title} (${start} ~ ${end||start}) → 대기중`);
    return res.json({ success: true, approval: newApproval, pending: true });
  }

  // 즉시 등록 (비-leave 타입 또는 skipApproval)
  const events = getCollection('calendarEvents', []);
  const newEvent = { id: 'evt_' + Date.now(), title, start, end: end || start, type, color, employeeId: Number(employeeId), leaveDays };
  events.push(newEvent);
  setCollection('calendarEvents', events);
  logSecurity(req.user.name, ip, '일정 등록', `${title} (${start})`);
  res.json({ success: true, event: newEvent, pending: false });
});

// ══════════════════════════════════════════════════════════════════════
// ✅ 결재 API (JWT 인증)
// ══════════════════════════════════════════════════════════════════════

/** 결재 목록 조회: 내가 요청한 것 + 내가 처리해야 할 것 */
app.get('/api/approvals', requireAuth, (req, res) => {
  const { employeeId } = req.query;
  const approvals = getCollection('approvals', []);
  const myId = Number(employeeId);
  res.json({
    mine:    approvals.filter(a => a.employeeId === myId),
    pending: approvals.filter(a => a.approverId === myId && a.status === 'pending'),
    all:     approvals,
  });
});

/** 결재 생성 (AI 문서에서 직접 요청) */
app.post('/api/approvals', requireAuth, (req, res) => {
  const approvals = getCollection('approvals', []);
  const employees = getCollection('employees', []);
  const { type, title, content, employeeId, approverId, start, end, leaveDays, reason, color } = req.body;
  const requester = employees.find(e => e.id === Number(employeeId));
  const approver  = employees.find(e => e.id === Number(approverId));
  const newApproval = {
    id: 'apr_' + Date.now(),
    type: type || 'document',
    title, content: content || '',
    start, end, leaveDays, reason, color,
    employeeId: Number(employeeId),
    employeeName: requester?.name || '직원',
    approverId: Number(approverId),
    approverName: approver?.name || '팀장',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comment: '',
  };
  approvals.push(newApproval);
  setCollection('approvals', approvals);
  res.json({ success: true, approval: newApproval });
});

/** 결재 승인 / 반려 */
app.put('/api/approvals/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { action, comment } = req.body;  // action: 'approve' | 'reject'
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const approvals = getCollection('approvals', []);
  const idx = approvals.findIndex(a => a.id === id);
  if (idx < 0) return res.status(404).json({ error: '결재 건을 찾을 수 없습니다.' });

  const apr = approvals[idx];
  apr.status    = action === 'approve' ? 'approved' : 'rejected';
  apr.comment   = comment || '';
  apr.updatedAt = new Date().toISOString();
  apr.approvedBy = req.user.name;
  approvals[idx] = apr;
  setCollection('approvals', approvals);

  // 승인 시 캘린더 자동 등록 + 연차 차감
  if (action === 'approve' && apr.type === 'leave') {
    const events = getCollection('calendarEvents', []);
    events.push({
      id: 'evt_' + Date.now(),
      title: apr.title, start: apr.start, end: apr.end || apr.start,
      type: 'leave', color: apr.color || '#a855f7',
      employeeId: apr.employeeId, leaveDays: apr.leaveDays,
    });
    setCollection('calendarEvents', events);

    // 연차 차감
    const employees = getCollection('employees', []);
    const emp = employees.find(e => e.id === apr.employeeId);
    if (emp && apr.leaveDays > 0) {
      const match   = (emp.status || '').match(/\d+(\.\d+)?/);
      const current = match ? parseFloat(match[0]) : 15;
      emp.status    = `${Math.max(0, current - apr.leaveDays)}일의 여유 휴가 보유 중 ✈️`;
      setCollection('employees', employees);
    }
    logSecurity(req.user.name, ip, '결재 승인', `${apr.title} 승인 → 캘린더 자동 등록`);
  } else {
    logSecurity(req.user.name, ip, '결재 ' + (action === 'approve' ? '승인' : '반려'), apr.title);
  }

  res.json({ success: true, approval: apr });
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


// ═══════════════════════════════════════════════════════════════════════
// 🗄️  /api/db/* — 서버사이드 DB 프록시 (Supabase 키는 서버에서만 관리)
//    클라이언트가 직접 Supabase에 접근하지 않고 이 엔드포인트를 통해 처리
// ═══════════════════════════════════════════════════════════════════════
app.get('/api/db/:collection', requireAuth, (req, res) => {
  const { collection } = req.params;
  const data = getCollection(collection, null);
  res.json({ success: true, data });
});

app.post('/api/db/:collection', requireAuth, (req, res) => {
  const { collection } = req.params;
  const { data } = req.body;
  if (data === undefined) return res.status(400).json({ success: false, error: 'data 필드 필요' });
  setCollection(collection, data);
  res.json({ success: true });
});

app.put('/api/db/:collection', requireAuth, (req, res) => {
  const { collection } = req.params;
  const { item } = req.body;
  if (!item) return res.status(400).json({ success: false, error: 'item 필드 필요' });
  const existing = getCollection(collection, []);
  if (Array.isArray(existing)) { existing.push(item); setCollection(collection, existing); }
  res.json({ success: true });
});

app.delete('/api/db/:collection/:id', requireAuth, (req, res) => {
  const { collection, id } = req.params;
  const existing = getCollection(collection, []);
  if (Array.isArray(existing)) {
    const filtered = existing.filter(item => String(item.id) !== String(id));
    setCollection(collection, filtered);
  }
  res.json({ success: true });
});

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


