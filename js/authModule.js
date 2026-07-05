/**
 * 🔐 authModule.js — SaaS 핵심 모듈 3: 인증/RBAC/세션 관리
 *
 * 담당 기능:
 *   - 3단계 로그인 (회사코드 → 이메일+비밀번호 → OTP)
 *   - 비밀번호로 역할 결정: '1111' → admin, '0000' → employee
 *   - RBAC: 역할별 사이드바 메뉴 동적 렌더링
 *   - 세션 저장/복원/삭제
 *   - 보안 감사 로그 기록
 *
 * 의존성: cloudDB.js, mockAPI.js
 *
 * 사용법:
 *   AuthModule.init()           // DOMContentLoaded 시 호출
 *   AuthModule.isAdmin()        // 현재 사용자가 admin인지
 *   AuthModule.getSession()     // { userId, role, tenantId, ... }
 */

window.AuthModule = (() => {
  // ── RBAC 메뉴 정의 ─────────────────────────────────────────────────
  const MENU_DEFINITIONS = [
    { tab:'dashboard', icon:'fa-chart-pie',            label:'대시보드',           roles:['admin','employee'] },
    { tab:'calendar',  icon:'fa-calendar-days',        label:'업무 캘린더',         roles:['admin','employee'] },
    { tab:'directory', icon:'fa-sitemap',              label:'조직도 & 구성원',     roles:['admin','employee'] },
    { tab:'payroll',   icon:'fa-wallet',               label:'급여 시뮬레이터',     roles:['admin','employee'], highlight:'employee' },
    { tab:'aioffice',  icon:'fa-wand-magic-sparkles',  label:'AI 워크스페이스',     roles:['admin','employee'], badge:'NEW' },
    { tab:'welfare',   icon:'fa-gift',                 label:'복지 포털',           roles:['admin','employee'], badge:'HOT', badgeColor:'var(--success)' },
    { tab:'approval',  icon:'fa-file-circle-check',    label:'결재 & 문서',         roles:['admin','employee'] },
    { tab:'hrmanage',  icon:'fa-shield-halved',        label:'HR 관리',             roles:['admin'], badge:'ADMIN', badgeColor:'var(--danger)' },
    { tab:'empmanage', icon:'fa-user-gear',            label:'직원 계정 관리',      roles:['admin'], badge:'ADMIN', badgeColor:'var(--danger)' },
    { tab:'busmanage', icon:'fa-bus',                  label:'버스 노선 관리',      roles:['admin'], badge:'ADMIN', badgeColor:'var(--danger)' },
    { tab:'expense',   icon:'fa-receipt',              label:'경비 & 자산',         roles:['admin','employee'] },
    { tab:'reports',   icon:'fa-file-invoice',         label:'업무 보고',           roles:['admin','employee'] },
    { tab:'messenger', icon:'fa-comments',             label:'메신저',              roles:['admin','employee'] },
    { tab:'market',    icon:'fa-store',                label:'사내 플리마켓',       roles:['admin','employee'] },
    { tab:'registry',  icon:'fa-cake-candles',         label:'경조사 캘린더',       roles:['admin','employee'] },
  ];

  let _currentRole = 'employee';
  let _onLoginCallbacks   = [];
  let _onLogoutCallbacks  = [];

  // ── 이벤트 버스 ────────────────────────────────────────────────────
  function _emit(event, ...args) {
    const map = { login: _onLoginCallbacks, logout: _onLogoutCallbacks };
    (map[event] || []).forEach(cb => { try { cb(...args); } catch(e) { console.error(e); } });
  }

  // ── 역할 판별 ───────────────────────────────────────────────────────
  /**
   * 비밀번호로 역할 결정
   * - '1111' → 'admin'  (관리자: 전체 메뉴 + 직원/버스 관리)
   * - '0000' → 'employee' (일반 직원: 기본 메뉴만)
   */
  function getRoleByPassword(password) {
    if (password === '1111') return 'admin';
    return 'employee';
  }

  // ── 사이드바 렌더링 (RBAC) ─────────────────────────────────────────
  /**
   * 역할에 따라 사이드바 메뉴를 동적으로 렌더링합니다.
   * Employee에게는 ADMIN 전용 메뉴가 표시되지 않습니다.
   */
  function renderNavMenu(role) {
    const navMenu = document.querySelector('.nav-menu');
    if (!navMenu) return;

    const allowed = MENU_DEFINITIONS.filter(m => m.roles.includes(role));
    navMenu.innerHTML = allowed.map(m => {
      const badge = m.badge
        ? `<span class="nav-badge" style="background:${m.badgeColor || 'var(--primary)'}; margin-left:4px; font-size:0.6rem; padding:2px 5px; border-radius:4px; color:white; font-weight:700;">${m.badge}</span>`
        : '';
      const isFirst = m.tab === 'dashboard';
      return `<a class="nav-item${isFirst ? ' active' : ''}" data-tab="${m.tab}">
        <i class="fa-solid ${m.icon}"></i>
        <span>${m.label}</span>${badge}
      </a>`;
    }).join('');

    // 클릭 이벤트 재바인딩
    navMenu.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        navMenu.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        item.classList.add('active');
        const tabName = item.getAttribute('data-tab');
        const target = document.getElementById(tabName);
        if (target) target.classList.add('active');

        // 탭별 추가 렌더링 (app.js의 글로벌 함수 호출)
        if (tabName === 'hrmanage'  && window.renderSecurityAuditLogs) window.renderSecurityAuditLogs();
        if (tabName === 'market'    && window.renderMarketItems)        window.renderMarketItems();
        if (tabName === 'registry'  && window.renderRegistryEvents)     window.renderRegistryEvents();
        if (tabName === 'empmanage' && window.renderEmpManageList)      window.renderEmpManageList();
        if (tabName === 'busmanage' && window.renderBusRouteList)       window.renderBusRouteList();
      });
    });

    // Admin 배너 표시/숨김
    const adminBanner = document.getElementById('adminRoleBanner');
    if (adminBanner) adminBanner.style.display = role === 'admin' ? 'flex' : 'none';
  }

  // ── 보안 로그 기록 ───────────────────────────────────────────────
  async function _logSecurity(userName, action, detail, ip = 'Browser-Session') {
    const logs = await CloudDB.get('securityLogs', []);
    logs.unshift({ timestamp: new Date().toISOString(), userName, ip, action, detail });
    await CloudDB.set('securityLogs', logs);
    if (window.AppState) window.AppState.securityLogs = logs;
  }

  // ── 세션 관리 ────────────────────────────────────────────────────
  async function saveSession(user, role) {
    const session = { userId: user.id, userName: user.name, role, tenantId: 'ANTIGRAVITY', loginAt: new Date().toISOString() };
    await CloudDB.set('currentSession', session);
    localStorage.setItem('ex_logged_user', JSON.stringify(user));
    localStorage.setItem('oneoffice_current_role', role);
    await _logSecurity(user.name, '로그인 완료', `[${role.toUpperCase()}] ${user.name}님 로그인 성공`);
  }

  async function getSession() {
    return await CloudDB.get('currentSession');
  }

  async function clearSession() {
    const session = await getSession();
    if (session) await _logSecurity(session.userName || 'Unknown', '로그아웃', '정상 로그아웃 처리');
    await CloudDB.set('currentSession', null);
    localStorage.removeItem('ex_logged_user');
    localStorage.removeItem('oneoffice_current_role');
  }

  // ── 로그인 화면 초기화 ────────────────────────────────────────────
  /**
   * 3단계 로그인 UI 이벤트를 연결합니다.
   * Step 1: 회사 코드 입력
   * Step 2: 이메일 + 비밀번호 (비밀번호로 role 결정)
   * Step 3: OTP 확인
   */
  function _initLoginUI() {
    const loginOverlay  = document.getElementById('loginOverlay');
    const loginError    = document.getElementById('loginError');
    const loginStep1    = document.getElementById('loginStep1');
    const loginStep2    = document.getElementById('loginStep2');
    const loginStep3    = document.getElementById('loginStep3');
    const loginCompanyCode = document.getElementById('loginCompanyCode');
    const loginEmail    = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    const loginOTP      = document.getElementById('loginOTP');
    const btnGoStep2    = document.getElementById('btnGoStep2');
    const btnBackStep1  = document.getElementById('btnBackStep1');
    const btnGoStep3    = document.getElementById('btnGoStep3');
    const btnBackStep2  = document.getElementById('btnBackStep2');
    const btnSubmit     = document.getElementById('btnSubmitLogin');

    if (!btnGoStep2) return; // 로그인 UI가 없을 경우 스킵

    let _otp = '';
    let _pendingRole = 'employee';
    let _pendingEmail = '';

    function setError(msg) { if (loginError) loginError.textContent = msg; }
    function clearError()   { if (loginError) loginError.textContent = ''; }

    // ── Step 1: 회사 코드 확인 ──────────────────────────────────────
    btnGoStep2.addEventListener('click', async () => {
      const code = (loginCompanyCode?.value || '').trim().toUpperCase();
      if (!code) { setError('회사 코드를 입력해주세요.'); return; }

      // 서버 시도 → 실패 시 LocalStorage 모드로 허용 (ANTIGRAVITY)
      const res = await MockAPI.fetchDataFromServer('/api/login', 'POST', { step: 1, code });
      if (res === null) {
        // 서버 없음 → LocalStorage 모드: 'ANTIGRAVITY' 코드만 허용
        if (code !== 'ANTIGRAVITY') { setError('잘못된 회사 코드입니다. (힌트: ANTIGRAVITY)'); return; }
      } else if (!res.ok && res.status !== undefined) {
        setError('잘못된 회사 코드입니다. (힌트: ANTIGRAVITY)'); return;
      }

      clearError();
      loginStep1.style.display = 'none';
      loginStep2.style.display = 'flex';
    });

    btnBackStep1.addEventListener('click', () => {
      clearError();
      loginStep2.style.display = 'none';
      loginStep1.style.display = 'flex';
    });

    // ── Step 2: 이메일 + 비밀번호 ───────────────────────────────────
    btnGoStep3.addEventListener('click', async () => {
      const email    = (loginEmail?.value || '').trim();
      const password = loginPassword?.value || '';
      if (!email || !password) { setError('이메일과 비밀번호를 입력해주세요.'); return; }

      _pendingEmail = email;
      _pendingRole  = getRoleByPassword(password);

      // 서버 시도
      const res = await MockAPI.fetchDataFromServer('/api/login', 'POST', { step: 2, email, password });

      if (res && res.success) {
        // 서버 인증 성공 → OTP는 서버 콘솔([OTP-DEV])에서 확인 (실배포: SMS/이메일)
        // 보안: OTP를 API 응답에서 제거됨 (서버에서만 보관)
        if (window.showToast) window.showToast('📱 OTP 발송됨', '서버 콘솔 [OTP-DEV] 로그에서 OTP를 확인하세요. (실배포 시 SMS/이메일 발송)', 'info');
      } else {
        // LocalStorage 모드: 서버 없을 때 Mock OTP 생성 (개발 전용)
        const employees = await CloudDB.get('employees', MockAPI.getDefaultEmployees());
        const emp = employees.find(e => e.email.toLowerCase() === email.toLowerCase());
        if (!emp) { setError('이메일이 올바르지 않습니다.'); return; }
        _otp = String(Math.floor(100000 + Math.random() * 900000));
        if (window.showSecurityOTPToast) window.showSecurityOTPToast(_otp);
        if (window.showToast) window.showToast('🔒 LocalStorage 모드', '서버 없이 실행 중. OTP 알림을 확인하세요.', 'info');
      }

      clearError();
      loginStep2.style.display = 'none';
      loginStep3.style.display = 'flex';
      if (loginOTP) loginOTP.focus();
    });

    btnBackStep2.addEventListener('click', () => {
      clearError();
      loginStep3.style.display = 'none';
      loginStep2.style.display = 'flex';
    });

    // ── Step 3: OTP 확인 + 로그인 완료 ─────────────────────────────
    const _submitLogin = async () => {
      const otp = (loginOTP?.value || '').trim();
      if (!otp) { setError('보안코드 6자리를 입력해주세요.'); return; }

      let employee = null;

      // ── 서버 3단계 인증 시도 (JWT 발급) ────────────────────────────
      // fetchDataFromServer를 skipAuth=true로 호출 (로그인 전이라 토큰 없음)
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 3, email: _pendingEmail, otp }),
      }).then(r => r.ok ? r.json() : null).catch(() => null);

      if (res && res.employee && res.token) {
        // ✅ 서버 JWT 발급 성공 → 토큰 저장
        employee = res.employee;
        _pendingRole = res.role || _pendingRole;
        MockAPI.saveToken(res.token, res.expiresAt, res.role);
      } else {
        // 📴 LocalStorage 모드: OTP 검증
        if (otp !== _otp) { setError('보안코드가 일치하지 않습니다. 상단 OTP 알림을 참고하세요.'); return; }
        const employees = await CloudDB.get('employees', MockAPI.getDefaultEmployees());
        employee = employees.find(e => e.email.toLowerCase() === _pendingEmail.toLowerCase());
        if (!employee) { setError('사용자를 찾을 수 없습니다.'); return; }
      }

      // 로그인 성공 처리
      _currentRole = _pendingRole;
      await saveSession(employee, _currentRole);

      if (loginOverlay) loginOverlay.classList.remove('active');
      clearError();

      // 전역 상태 업데이트
      if (window.AppState) window.AppState.currentUser = employee;

      // RBAC 메뉴 렌더링
      renderNavMenu(_currentRole);

      // 콜백 실행
      _emit('login', employee, _currentRole);

      if (window.showToast) {
        const jwtLabel = MockAPI.getToken() ? '🔐 JWT 보안 인증' : '🔒 로컬 인증';
        const roleLabel = _currentRole === 'admin' ? '👑 관리자' : '👤 직원';
        window.showToast('👋 원오피스 로그인 성공', `${employee.name} ${employee.title}님 환영합니다! (${roleLabel} · ${jwtLabel})`, 'success');
      }
    };

    btnSubmit.addEventListener('click', _submitLogin);
    if (loginOTP) loginOTP.addEventListener('keypress', e => { if (e.key === 'Enter') _submitLogin(); });

    // ── 로그아웃 버튼 ────────────────────────────────────────────────
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        MockAPI.clearToken(); // JWT 토큰 삭제
        clearSession();
        _currentRole = 'employee';
        if (loginOverlay) loginOverlay.classList.add('active');
        loginStep1.style.display = 'flex';
        loginStep2.style.display = 'none';
        loginStep3.style.display = 'none';
        if (loginCompanyCode) loginCompanyCode.value = '';
        if (loginEmail)    loginEmail.value = '';
        if (loginPassword) loginPassword.value = '';
        if (loginOTP)      loginOTP.value = '';
        _emit('logout');
      });
    }
  }

  // ── Public API ───────────────────────────────────────────────────
  return {
    /**
     * 로그인 UI 초기화 (DOMContentLoaded 시 호출)
     */
    init() {
      _initLoginUI();
    },

    /**
     * 저장된 세션으로 자동 로그인 복원
     * @returns {object|null} 복원된 직원 객체 또는 null
     */
    async restoreSession() {
      const savedStr = localStorage.getItem('ex_logged_user');
      const savedRole = localStorage.getItem('oneoffice_current_role') || 'employee';
      if (!savedStr) return null;
      try {
        const parsed = JSON.parse(savedStr);
        const employees = await CloudDB.get('employees', MockAPI.getDefaultEmployees());
        const employee = employees.find(e => e.id === parsed.id) || parsed;
        _currentRole = savedRole;
        renderNavMenu(_currentRole);
        if (window.AppState) window.AppState.currentUser = employee;
        return { employee, role: savedRole };
      } catch {
        localStorage.removeItem('ex_logged_user');
        return null;
      }
    },

    /** 현재 사용자 역할 */
    getRole() { return _currentRole; },

    /** 관리자 여부 */
    isAdmin() { return _currentRole === 'admin'; },

    /** 로그인 여부 */
    isLoggedIn() { return !!localStorage.getItem('ex_logged_user'); },

    /** 현재 세션 정보 */
    getSession,

    /** 비밀번호로 역할 결정 */
    getRoleByPassword,

    /** RBAC 사이드바 렌더링 */
    renderNavMenu,

    /** 보안 로그 기록 */
    logSecurity: _logSecurity,

    /**
     * 로그인/로그아웃 이벤트 리스너 등록
     * @param {'login'|'logout'} event
     * @param {Function} callback
     */
    on(event, callback) {
      if (event === 'login')  _onLoginCallbacks.push(callback);
      if (event === 'logout') _onLogoutCallbacks.push(callback);
    },

    MENU_DEFINITIONS,
  };
})();
