/**
 * 🎁 welfareModule.js — 복지 포털 통합 모듈
 *
 * 담당 기능:
 *   - 복지 포인트 잔액 조회 / 더치페이 / 송금
 *   - 동호회 가입/탈퇴 (CloudDB 영속 저장)
 *   - 통근버스 노선 목록 조회 / 신청 / Admin 전용 관리
 *   - 직원 계정 생성/삭제 (Admin 전용)
 *   - 경조사 선물 발송
 *
 * 의존성: cloudDB.js, mockAPI.js, authModule.js
 *
 * 사용법:
 *   WelfareModule.init()          // DOMContentLoaded 시 호출
 *   WelfareModule.renderBusRoutes() // 버스 노선 렌더링
 */

window.WelfareModule = (() => {
  // ── 기본 버스 노선 데이터 ─────────────────────────────────────────
  const DEFAULT_BUS_ROUTES = [
    { id:'bus1', name:'A노선 (강남행)',    stops:'강남역 → 선릉역 → 역삼역 → 사무실',   time:'08:30', seats:40, registered:12 },
    { id:'bus2', name:'B노선 (홍대행)',    stops:'홍대입구 → 합정 → 마포 → 사무실',     time:'08:45', seats:30, registered:8  },
    { id:'bus3', name:'C노선 (신도림행)', stops:'신도림역 → 구로디지털단지 → 사무실', time:'08:15', seats:50, registered:22 },
  ];

  async function _getBusRoutes() {
    return await CloudDB.get('busRoutes', DEFAULT_BUS_ROUTES);
  }

  // ── 버스 노선 렌더링 ─────────────────────────────────────────────
  async function renderBusRouteList() {
    const list = document.getElementById('busRouteAdminList');
    if (!list) return;
    const routes = await _getBusRoutes();
    const isAdmin = AuthModule.isAdmin();

    list.innerHTML = routes.map(r => `
      <div class="bus-route-card" style="justify-content:space-between; align-items:center;">
        <div class="bus-route-badge">${r.name}</div>
        <div class="bus-route-info" style="flex:1; margin:0 12px;">
          <div class="bus-route-name">${r.stops}</div>
          <div class="bus-route-loc">출발: ${r.time} | 정원: ${r.seats}명 | 신청: ${r.registered}명</div>
        </div>
        ${isAdmin
          ? `<button class="btn-secondary" style="padding:6px 12px;font-size:0.78rem;" onclick="WelfareModule.deleteBusRoute('${r.id}')">
               <i class="fa-solid fa-trash"></i> 삭제
             </button>`
          : `<button class="btn-primary" style="padding:6px 12px;font-size:0.78rem;" onclick="WelfareModule.applyBusRoute('${r.id}', '${r.name}')">
               <i class="fa-solid fa-bus"></i> 신청
             </button>`
        }
      </div>
    `).join('');
  }

  /** 버스 노선 신청 (Employee) */
  async function applyBusRoute(id, name) {
    const user = window.AppState?.currentUser;
    if (!user) return;
    const memberships = await CloudDB.get('busApplied', {});
    if (memberships[user.id] === id) {
      if (window.showToast) window.showToast('이미 신청됨', `이미 [${name}] 노선을 신청하셨습니다.`, 'warning');
      return;
    }
    memberships[user.id] = id;
    await CloudDB.set('busApplied', memberships);

    // 신청자 수 업데이트
    const routes = await _getBusRoutes();
    const idx = routes.findIndex(r => r.id === id);
    if (idx !== -1) { routes[idx].registered += 1; await CloudDB.set('busRoutes', routes); }

    await AuthModule.logSecurity(user.name, '버스 노선 신청', `[${name}] 통근버스 신청 완료`);
    if (window.showToast) window.showToast('🚌 버스 신청 완료', `[${name}] 노선 탑승 신청이 완료되었습니다.`, 'success');
    renderBusRouteList();
  }

  /** 버스 노선 추가 (Admin only) */
  async function addBusRoute(name, stops, time) {
    if (!AuthModule.isAdmin()) return;
    const routes = await _getBusRoutes();
    routes.push({ id: 'bus' + Date.now(), name, stops, time, seats:40, registered:0 });
    await CloudDB.set('busRoutes', routes);
    renderBusRouteList();
    if (window.showToast) window.showToast('🚌 노선 추가 완료', `[${name}] 노선이 등록되었습니다.`, 'success');
  }

  /** 버스 노선 삭제 (Admin only) */
  async function deleteBusRoute(id) {
    if (!AuthModule.isAdmin()) return;
    const routes = (await _getBusRoutes()).filter(r => r.id !== id);
    await CloudDB.set('busRoutes', routes);
    renderBusRouteList();
    if (window.showToast) window.showToast('삭제 완료', '버스 노선이 삭제되었습니다.', 'info');
  }

  // ── 직원 계정 관리 (Admin 전용) ───────────────────────────────────
  function renderEmpManageList() {
    const list = document.getElementById('empManageList');
    if (!list) return;
    const employees = window.AppState?.employees || [];
    list.innerHTML = employees.map(emp => `
      <div class="employee-card glass glass-interactive">
        <div class="emp-avatar">${emp.initial || emp.name[0]}</div>
        <div class="emp-info" style="flex:1;">
          <div class="emp-name">${emp.name}</div>
          <div class="emp-title-dept">${emp.dept} · ${emp.title}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${emp.email}</div>
        </div>
        <button class="btn-secondary" style="padding:6px 10px;font-size:0.75rem;"
                onclick="WelfareModule.removeEmployee(${emp.id})">
          <i class="fa-solid fa-user-minus"></i>
        </button>
      </div>
    `).join('');
  }

  async function createEmployee(name, dept, title, email, phone) {
    if (!AuthModule.isAdmin()) return;
    if (!name || !email) { if (window.showToast) window.showToast('입력 오류', '이름과 이메일은 필수입니다.', 'warning'); return; }

    const newEmp = {
      id: Date.now(), name, dept, title, email, phone,
      joinDate: new Date().toISOString().slice(0,10),
      status: `${title} 신규 입사 🎉`,
      initial: name[0], mbti: '?', workStyle: '협의 중',
    };

    if (window.AppState) window.AppState.employees.push(newEmp);
    await CloudDB.set('employees', window.AppState?.employees || []);

    // 복지 포인트 초기 지급
    const pts = await CloudDB.get('welfarePoints', {});
    pts[String(newEmp.id)] = 50000;
    await CloudDB.set('welfarePoints', pts);
    if (window.AppState) window.AppState.welfarePoints = pts;

    await AuthModule.logSecurity(window.AppState?.currentUser?.name || 'Admin', '직원 계정 생성',
      `신규 직원 [${name}] 계정 생성 및 초기 복지포인트 50,000p 지급`);

    renderEmpManageList();
    if (window.renderSecurityAuditLogs) window.renderSecurityAuditLogs();
    if (window.showToast) window.showToast('✅ 직원 계정 생성', `${name}님 계정 생성 (초기 복지포인트 50,000p)`, 'success');
  }

  async function removeEmployee(id) {
    if (!AuthModule.isAdmin()) return;
    if (!confirm('정말 이 직원 계정을 삭제하시겠습니까?')) return;
    const emp = window.AppState?.employees.find(e => e.id === id);
    if (window.AppState) window.AppState.employees = window.AppState.employees.filter(e => e.id !== id);
    await CloudDB.set('employees', window.AppState?.employees || []);
    await AuthModule.logSecurity(window.AppState?.currentUser?.name || 'Admin', '직원 계정 삭제',
      `직원 [${emp?.name}] 계정 삭제 처리`);
    renderEmpManageList();
    if (window.renderSecurityAuditLogs) window.renderSecurityAuditLogs();
    if (window.showToast) window.showToast('삭제 완료', `${emp?.name}님 계정이 삭제되었습니다.`, 'warning');
  }

  // ── 복지 포인트 ──────────────────────────────────────────────────
  function renderPointsDisplay(userId) {
    const pts = CloudDB.get('welfarePoints', {});
    const balance = pts[String(userId)] || 0;
    const dashEl  = document.getElementById('dashWelfarePoints');
    const barEl   = document.getElementById('dashPointsBar');
    if (dashEl) dashEl.textContent = balance.toLocaleString() + '원';
    if (barEl)  barEl.style.width = Math.min(100, (balance / 100000) * 100) + '%';
    return balance;
  }

  async function transferPoints(senderId, receiverId, amount, message) {
    const result = await MockAPI.transferWelfarePoints(senderId, receiverId, amount, message);
    if (result.success) {
      if (window.AppState) window.AppState.welfarePoints = CloudDB.get('welfarePoints', {});
      AuthModule.logSecurity(window.AppState?.currentUser?.name || '?', '복지 포인트 송금',
        `${amount.toLocaleString()}원 → 직원 ID ${receiverId}`);
    }
    return result;
  }

  // ── 동호회 ──────────────────────────────────────────────────────
  async function joinClub(userId, clubId, clubName) {
    const result = await MockAPI.joinClub(userId, clubId, clubName);
    AuthModule.logSecurity(window.AppState?.currentUser?.name || '?', '동호회 가입',
      `[${clubName}] 동호회 가입 완료`);
    if (window.showToast) window.showToast('🎉 동호회 가입 완료', `[${clubName}] 동호회에 가입했습니다.`, 'success');
    return result;
  }

  function getClubMemberships(userId) {
    const memberships = CloudDB.get('clubMemberships', {});
    return memberships[userId] || [];
  }

  // ── Admin 전용 패널 초기화 ────────────────────────────────────────
  function _initAdminPanels() {
    // 버스 노선 추가 버튼
    const addBusBtn = document.getElementById('btnAddBusRoute');
    if (addBusBtn) {
      addBusBtn.addEventListener('click', () => {
        const name  = (document.getElementById('busRouteName')?.value || '').trim();
        const stops = (document.getElementById('busRouteStops')?.value || '').trim();
        const time  = document.getElementById('busRouteTime')?.value || '08:30';
        if (!name || !stops) { if (window.showToast) window.showToast('입력 오류', '노선명과 경유지를 입력하세요.', 'warning'); return; }
        addBusRoute(name, stops, time);
        ['busRouteName','busRouteStops'].forEach(id => {
          const el = document.getElementById(id); if (el) el.value = '';
        });
      });
    }

    // 직원 생성 버튼
    const createEmpBtn = document.getElementById('btnCreateEmployee');
    if (createEmpBtn) {
      createEmpBtn.addEventListener('click', async () => {
        const name  = (document.getElementById('newEmpName')?.value || '').trim();
        const dept  = (document.getElementById('newEmpDept')?.value || '').trim();
        const title = (document.getElementById('newEmpTitle')?.value || '').trim();
        const email = (document.getElementById('newEmpEmail')?.value || '').trim();
        const phone = (document.getElementById('newEmpPhone')?.value || '').trim();
        await createEmployee(name, dept, title, email, phone);
        ['newEmpName','newEmpDept','newEmpTitle','newEmpEmail','newEmpPhone'].forEach(id => {
          const el = document.getElementById(id); if (el) el.value = '';
        });
      });
    }
  }

  // ── 모듈 초기화 ─────────────────────────────────────────────────
  async function init() {
    await renderBusRouteList();
    renderEmpManageList();

    if (AuthModule.isAdmin()) {
      _initAdminPanels();
    }
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    init,
    renderBusRouteList,
    renderEmpManageList,
    applyBusRoute,
    addBusRoute,
    deleteBusRoute,
    createEmployee,
    removeEmployee,
    renderPointsDisplay,
    transferPoints,
    joinClub,
    getClubMemberships,
  };
})();
