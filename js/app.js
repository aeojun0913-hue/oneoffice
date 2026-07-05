/**
 * 🚀 app.js — OneOffice 앱 부트스트랩 & 전역 상태 조율 (Entry Point)
 *
 * 역할:
 *   1. 전역 AppState 초기화 및 관리
 *   2. MockAPI로 앱 상태 로드 (서버 우선 → LocalStorage fallback)
 *   3. AuthModule 초기화 & 세션 복원
 *   4. 각 기능 모듈 init() 순서대로 호출
 *   5. 3초 주기 실시간 동기화 (채팅/마켓/보안로그)
 *   6. 공통 UI 함수 (Toast, OTP, 사이드바 등) 전역 노출
 *
 * 로드 순서 (index.html에서):
 *   cloudDB.js → mockAPI.js → authModule.js →
 *   salaryModule.js → welfareModule.js → calendarModule.js → app.js
 *
 * 의존성: 위 6개 모듈 전부
 */

// ═══════════════════════════════════════════════════════════════════════
// 🌐 전역 상태 (AppState) — 모든 모듈이 이 객체를 읽고 씁니다
// ═══════════════════════════════════════════════════════════════════════
window.AppState = {
  currentUser:     null,   // 로그인 중인 직원 객체
  employees:       [],     // 전체 직원 목록
  events:          [],     // 캘린더 이벤트
  chatLogs:        {},     // 채팅 로그 { channel: [msg, ...] }
  welfarePoints:   {},     // 복지 포인트 { userId: amount }
  fleaMarketItems: [],     // 플리마켓 상품
  registryEvents:  [],     // 경조사 이벤트
  securityLogs:    [],     // 보안 감사 로그
  reports:         [],     // 업무 보고
  activeChatTarget: 'bot', // 현재 활성 채팅 채널
};

// ═══════════════════════════════════════════════════════════════════════
// 🔔 공통 UI 유틸리티 (전역 노출)
// ═══════════════════════════════════════════════════════════════════════

/** Toast 알림 표시 */
window.showToast = function(title, text, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed; top:20px; right:20px; z-index:10000; display:flex; flex-direction:column; gap:8px;';
    document.body.appendChild(container);

    const style = document.createElement('style');
    style.textContent = `
      @keyframes toastSlideIn  { from { transform:translateX(120%); opacity:0; } to { transform:translateX(0); opacity:1; } }
      @keyframes toastSlideOut { from { transform:translateX(0); opacity:1; } to { transform:translateX(120%); opacity:0; } }
    `;
    document.head.appendChild(style);
  }

  const borderColor = { success:'var(--success)', warning:'var(--warning)', danger:'var(--danger)' }[type] || 'var(--secondary)';
  const iconClass   = type === 'success' ? 'fa-circle-check' : 'fa-circle-info';
  const iconColor   = type === 'success' ? 'var(--success)' : 'var(--secondary)';

  const toast = document.createElement('div');
  toast.style.cssText = `padding:12px 18px; border-radius:10px; background:rgba(19,23,34,0.9);
    backdrop-filter:blur(10px); border-left:4px solid ${borderColor};
    border-top:1px solid var(--border-color); border-right:1px solid var(--border-color);
    border-bottom:1px solid var(--border-color); color:white;
    box-shadow:0 4px 15px rgba(0,0,0,0.25); animation:toastSlideIn 0.3s ease forwards;
    display:flex; flex-direction:column; gap:4px; min-width:260px; max-width:340px;`;
  toast.innerHTML = `
    <div style="font-weight:700; font-size:0.88rem; display:flex; align-items:center; gap:6px;">
      <i class="fa-solid ${iconClass}" style="color:${iconColor}"></i>
      <span>${title}</span>
    </div>
    <div style="font-size:0.8rem; color:var(--text-muted);">${text}</div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastSlideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
};

/** OTP 보안 코드 토스트 */
window.showSecurityOTPToast = function(otp) {
  window.showToast(
    '🔓 2단계 보안 코드 (OTP)',
    `사내 기기 전송 완료: <strong style="color:var(--warning); font-size:1rem; font-family:monospace; letter-spacing:2px;">${otp.substring(0,3)}-${otp.substring(3,6)}</strong>`,
    'warning'
  );
};

// ═══════════════════════════════════════════════════════════════════════
// 🔄 상태 동기화 (서버 → AppState 반영)
// ═══════════════════════════════════════════════════════════════════════
async function _syncState() {
  const data = await MockAPI.loadAppState();
  if (!data) return false;

  AppState.employees       = data.employees       || AppState.employees;
  AppState.events          = data.calendarEvents  || AppState.events;
  AppState.chatLogs        = data.chatLogs        || AppState.chatLogs;
  AppState.welfarePoints   = data.welfarePoints   || AppState.welfarePoints;
  AppState.fleaMarketItems = data.fleaMarketItems || AppState.fleaMarketItems;
  AppState.registryEvents  = data.registryEvents  || AppState.registryEvents;
  AppState.reports         = data.reports         || AppState.reports;
  AppState.securityLogs    = data.securityLogs    || AppState.securityLogs;

  // 현재 사용자 정보 최신화
  if (AppState.currentUser) {
    const fresh = AppState.employees.find(e => e.id === AppState.currentUser.id);
    if (fresh) AppState.currentUser = fresh;
  }

  return true;
}

// 전역으로도 노출 (하위 호환)
window.syncState = _syncState;

// ═══════════════════════════════════════════════════════════════════════
// 🖥️ 현재 사용자 UI 전체 업데이트
// ═══════════════════════════════════════════════════════════════════════
function _updateUIForCurrentUser() {
  const user = AppState.currentUser;
  if (!user) return;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setEl('currentUserName',  user.name);
  setEl('currentUserRole',  `${user.dept} · ${user.title}`);
  setEl('headerGreeting',   `안녕하세요, ${user.name} ${user.title.split(' ')[0]}님!`);

  const avatarDiv = document.getElementById('currentUserAvatar');
  if (avatarDiv) avatarDiv.textContent = user.initial || user.name[0];

  // 남은 연차 - 캘린더 이벤트에서 사용 일수 집계 (실시간 차감)
  const _todayStr = new Date().toISOString().split('T')[0];
  const _usedDays = (AppState.events || []).filter(e =>
    e.employeeId === user.id && e.type === 'leave' && e.start <= _todayStr
  ).reduce((sum, e) => sum + (Number(e.leaveDays) || 0), 0);
  const _remain = Math.max(0, 15 - _usedDays);
  setEl('statLeaveDays', (_remain % 1 === 0 ? _remain : _remain.toFixed(1)) + '일');

  // 복지 포인트
  const points = AppState.welfarePoints[String(user.id)] || 0;
  setEl('dashWelfarePoints', points.toLocaleString() + '원');
  const bar = document.getElementById('dashPointsBar');
  if (bar) bar.style.width = Math.min(100, (points / 100000) * 100) + '%';

  // 프로필 편집 모달 값
  ['profileNameInput',   user.name,
   'profileStatusInput', user.status,
   'profileMBTIInput',   user.mbti      || '',
   'profileStyleInput',  user.workStyle  || '',
   'profileEmailInput',  user.email,
   'profilePhoneInput',  user.phone,
   'profileDeptInput',   user.dept      || '',
   'profileTitleInput',  user.title     || '',
  ].reduce((_, __, i, arr) => {
    if (i % 2 === 0) {
      const el = document.getElementById(arr[i]);
      if (el) el.value = arr[i + 1];
    }
  }, null);

  const modalAvatar = document.getElementById('modalAvatar');
  if (modalAvatar) modalAvatar.textContent = user.initial || user.name[0];
}

window.updateUIForCurrentUser = _updateUIForCurrentUser;

// ═══════════════════════════════════════════════════════════════════════
// 📊 공통 렌더 함수 (전역 노출 — 각 모듈 & 탭 이동 시 호출)
// ═══════════════════════════════════════════════════════════════════════

/** 보안 감사 로그 테이블 렌더링 */
window.renderSecurityAuditLogs = function() {
  const tbody = document.getElementById('securityAuditLogBody');
  if (!tbody) return;
  const logs = AppState.securityLogs;
  if (!logs || logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">보안 감사 로그가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = logs.slice(0, 15).map(log => {
    const d = new Date(log.timestamp);
    const ts= `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    const color = log.action.includes('실패') || log.action.includes('차단') ? 'var(--danger)'
                : log.action.includes('로그인') || log.action.includes('성공') ? 'var(--secondary)'
                : log.action.includes('선물') || log.action.includes('포인트') ? 'var(--warning)'
                : 'var(--text-main)';
    return `<tr style="border-bottom:1px solid var(--border-color);">
      <td style="padding:10px;color:var(--text-muted);font-size:0.75rem;">${ts}</td>
      <td style="padding:10px;font-weight:700;">${log.userName}</td>
      <td style="padding:10px;color:var(--text-muted);font-size:0.75rem;">${log.ip}</td>
      <td style="padding:10px;color:${color};font-weight:600;">${log.action}</td>
      <td style="padding:10px;line-height:1.4;">${log.detail}</td>
    </tr>`;
  }).join('');
};

/** 채팅 메시지 렌더링 */
window.renderChatMessages = function() {
  const chatWindow = document.getElementById('chatWindow');
  if (!chatWindow) return;
  const logs = AppState.chatLogs[AppState.activeChatTarget] || [];
  chatWindow.innerHTML = logs.map(msg => {
    const isSent = msg.sender === 'sent';
    return `<div class="chat-bubble bubble-${isSent ? 'sent' : 'received'}" style="align-self:${isSent ? 'flex-end' : 'flex-start'}; max-width:75%;">
      ${!isSent ? `<div style="font-size:0.72rem;color:var(--secondary);font-weight:700;margin-bottom:4px;">${msg.senderName || 'System'}</div>` : ''}
      <div style="white-space:pre-wrap;line-height:1.5;">${msg.text}</div>
    </div>`;
  }).join('');
  chatWindow.scrollTop = chatWindow.scrollHeight;
};

/** 플리마켓 아이템 렌더링 */
window.renderMarketItems = function() {
  const grid = document.getElementById('marketItemsGrid');
  if (!grid) return;
  const searchVal = (document.getElementById('marketSearch')?.value || '').toLowerCase();
  const activeCat = document.querySelector('#marketCategoryFilters button.active')?.getAttribute('data-category') || 'all';
  const filtered  = AppState.fleaMarketItems.filter(item => {
    const matchSearch = !searchVal || item.title.toLowerCase().includes(searchVal) || (item.description||'').toLowerCase().includes(searchVal);
    const matchCat    = activeCat === 'all' || item.category === activeCat;
    return matchSearch && matchCat;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column:span 3;text-align:center;padding:40px;color:var(--text-muted);">조회 조건에 맞는 상품이 없습니다. 🛍️</div>`;
    return;
  }

  grid.innerHTML = filtered.map(item => {
    const isMyItem    = item.sellerId === AppState.currentUser?.id;
    const statusColor = item.status === '판매중' ? 'var(--success)' : item.status === '예약중' ? 'var(--warning)' : 'var(--text-muted)';
    return `<div class="welfare-benefit-card glass glass-interactive" style="flex-direction:column;align-items:stretch;padding:14px;gap:10px;border-radius:14px;min-height:350px;">
      <div style="position:relative;width:100%;height:160px;overflow:hidden;border-radius:10px;">
        <img src="${item.image}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='https://images.unsplash.com/photo-1546213290-e1b7610339e5?w=400&q=80'">
        <span class="nav-badge" style="position:absolute;top:10px;left:10px;background:${statusColor};font-size:0.7rem;color:white;">${item.status}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-grow:1;">
        <div style="font-weight:700;font-size:0.95rem;">${item.title}</div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--secondary);">${Number(item.price).toLocaleString()}원</div>
        <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;flex-grow:1;">${item.description}</div>
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-muted);border-top:1px dashed var(--border-color);padding-top:8px;margin-top:8px;">
          <span>👤 ${item.sellerName}</span><span>📅 ${item.date}</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        ${isMyItem
          ? `<select class="form-control" style="padding:6px;font-size:0.78rem;" onchange="updateMarketItemStatus('${item.id}',this.value)">
               <option ${item.status==='판매중'?'selected':''}>판매중</option>
               <option ${item.status==='예약중'?'selected':''}>예약중</option>
               <option ${item.status==='판매완료'?'selected':''}>판매완료</option>
             </select>`
          : `<button class="btn-primary" style="flex-grow:1;padding:8px;font-size:0.8rem;" onclick="startMarketInquiry('${item.id}',${item.sellerId},'${item.title}')">
               <i class="fa-solid fa-comments"></i> 구매 문의하기
             </button>`
        }
      </div>
    </div>`;
  }).join('');
};

/** 경조사 이벤트 렌더링 */
window.renderRegistryEvents = function() {
  const list = document.getElementById('registryEventsList');
  if (!list) return;
  const events = AppState.registryEvents;
  if (events.length === 0) {
    list.innerHTML = `<div class="glass" style="padding:40px;text-align:center;color:var(--text-muted);">현재 등록된 경조사 일정이 없습니다.</div>`;
  } else {
    list.innerHTML = events.map(evt => {
      const isSelf  = AppState.currentUser?.id === evt.employeeId;
      const icon    = evt.eventType === 'birthday' ? 'fa-cake-candles' : evt.eventType === 'wedding' ? 'fa-bell' : 'fa-baby';
      const color   = evt.eventType === 'birthday' ? 'var(--warning)' : evt.eventType === 'wedding' ? 'var(--accent)' : 'var(--secondary)';
      return `<div class="glass" style="padding:20px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-radius:14px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:16px;">
          <div style="width:50px;height:50px;border-radius:50%;border:1px solid var(--border-color);display:flex;align-items:center;justify-content:center;font-size:1.4rem;color:${color};">
            <i class="fa-solid ${icon}"></i>
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <strong style="font-size:1.1rem;">${evt.employeeName}</strong>
              ${evt.isToday ? `<span class="nav-badge" style="background:var(--danger);font-size:0.65rem;">TODAY</span>` : ''}
            </div>
            <div style="font-weight:700;color:${color};font-size:0.9rem;margin-top:4px;">${evt.eventTitle}</div>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">${evt.description}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          ${isSelf
            ? `<span style="font-size:0.82rem;color:var(--text-muted);padding:8px;">본인 경조사 🎂</span>`
            : `<button class="btn-secondary" style="padding:8px 14px;font-size:0.8rem;" onclick="openCongratsModal('${evt.id}',${evt.employeeId},'${evt.employeeName}','${evt.eventTitle}')"><i class="fa-solid fa-envelope"></i> 축전 메시지</button>
               <button class="btn-primary" style="padding:8px 14px;font-size:0.8rem;" onclick="openGiftModal('${evt.id}',${evt.employeeId},'${evt.employeeName}','${evt.eventTitle}')"><i class="fa-solid fa-gift"></i> 선물 발송</button>`
          }
        </div>
      </div>`;
    }).join('');
  }

  // 대시보드 미니 위젯
  const dashList = document.getElementById('dashboardRegistryList');
  if (dashList) {
    const todayEvts = events.filter(e => e.isToday);
    dashList.innerHTML = todayEvts.length === 0
      ? `<div style="font-size:0.82rem;color:var(--text-muted);text-align:center;padding:10px;width:100%;">오늘 예정된 사내 경조사가 없습니다. 🍰</div>`
      : todayEvts.map(evt => `
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.85rem;padding:6px 0;border-bottom:1px dashed var(--border-color);width:100%;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-weight:700;">${evt.employeeName}</span>
              <span style="color:var(--accent);font-weight:600;">${evt.eventTitle.split(' ').slice(1).join(' ')}</span>
            </div>
            <span style="font-size:0.75rem;color:var(--text-muted);">오늘</span>
          </div>`).join('');
  }
};

/** 마켓 상품 상태 변경 */
window.updateMarketItemStatus = async function(itemId, newStatus) {
  const res = await MockAPI.fetchDataFromServer(`/api/market/${itemId}/status`, 'POST',
    { status: newStatus, userName: AppState.currentUser?.name });
  if (res !== null) {
    const item = AppState.fleaMarketItems.find(i => i.id === itemId);
    if (item) item.status = newStatus;
    CloudDB.set('fleaMarketItems', AppState.fleaMarketItems);
  }
  window.showToast('🛍️ 상품 상태 변경', `상품 상태가 '${newStatus}'(으)로 변경되었습니다.`, 'success');
  window.renderMarketItems();
};

/** 마켓 구매 문의 → 메신저 DM으로 이동 */
window.startMarketInquiry = function(itemId, sellerId, itemTitle) {
  AppState.activeChatTarget = String(sellerId);
  const chatMsg = `안녕하세요! 중고 플리마켓에 올리신 **'${itemTitle}'** 물품에 대해 문의드립니다. 아직 판매 중이신가요? 🛍️`;
  MockAPI.saveChatMessage(String(sellerId), 'sent', AppState.currentUser?.name, chatMsg);
  const msgTabBtn = document.querySelector('.nav-item[data-tab="messenger"]');
  if (msgTabBtn) msgTabBtn.click();
};

// ═══════════════════════════════════════════════════════════════════════
// 🎉 경조사 모달 (전역 함수)
// ═══════════════════════════════════════════════════════════════════════
window.openCongratsModal = function(eventId, employeeId, name, eventTitle) {
  const modal = document.getElementById('congratsCardModal');
  if (!modal) return;
  modal.setAttribute('data-event-id', eventId);
  modal.setAttribute('data-receiver-id', employeeId);
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('congratsTargetName',  name);
  setEl('congratsTargetEvent', eventTitle);

  const templates = [
    '기쁜 날 진심으로 축하드립니다! 하시는 모든 일 번창하시길 바라며 즐거운 하루 되세요.',
    '생일 축하드려요! 🎂 오늘 하루 맛있는 것도 많이 드시고 최고의 해피데이가 되시길 응원합니다.',
    '결혼을 진심으로 축하드립니다! 🎉 두 분의 앞날에 늘 행복과 기쁨이 충만하길 기원하겠습니다.',
    '득남/득녀 소식 정말 축하드립니다! 👶 새로운 천사와 함께 더 큰 행복이 가정에 가득하시길 바랍니다.',
  ];
  const tplDiv = document.getElementById('congratsTemplates');
  if (tplDiv) {
    tplDiv.innerHTML = templates.map((tpl, i) => `
      <button class="quick-prompt-btn" style="padding:6px 10px;font-size:0.72rem;margin-bottom:4px;" title="${tpl}"
              onclick="document.getElementById('congratsMessageText').value = this.title">추천 문구 ${i+1}</button>
    `).join('');
  }
  const msgEl = document.getElementById('congratsMessageText');
  if (msgEl) msgEl.value = templates[0];
  modal.classList.add('active');
};

window.openGiftModal = function(eventId, employeeId, name, eventTitle) {
  const modal = document.getElementById('registryGiftModal');
  if (!modal) return;
  modal.setAttribute('data-event-id', eventId);
  modal.setAttribute('data-receiver-id', employeeId);
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('giftTargetName',  name);
  setEl('giftTargetEvent', eventTitle);
  const pts = AppState.welfarePoints[String(AppState.currentUser?.id)] || 0;
  setEl('senderWelfarePointsDisplay', pts.toLocaleString() + 'p');
  modal.classList.add('active');
};

// ═══════════════════════════════════════════════════════════════════════
// 🏁 DOMContentLoaded — 앱 부트스트랩
// ═══════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // ── 1. 앱 상태 로드 (서버 or CloudDB) ─────────────────────────────
  const data = await MockAPI.loadAppState();
  if (data) {
    AppState.employees       = data.employees       || [];
    AppState.events          = data.calendarEvents  || [];
    AppState.chatLogs        = data.chatLogs        || {};
    AppState.welfarePoints   = data.welfarePoints   || {};
    AppState.fleaMarketItems = data.fleaMarketItems || [];
    AppState.registryEvents  = data.registryEvents  || [];
    AppState.reports         = data.reports         || [];
    AppState.securityLogs    = data.securityLogs    || [];
  }

  // ── 2. 테마 조절 초기화 (시력 보호용 화이트 모드 토글) ──────────────
  const body = document.body;
  const themeBtn = document.getElementById('themeToggleBtn');
  const savedTheme = localStorage.getItem('oneoffice_theme');

  const setLightTheme = (isLight) => {
    if (isLight) {
      body.classList.add('light-theme');
      if (themeBtn) themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i> <span>다크 모드</span>';
      localStorage.setItem('oneoffice_theme', 'light');
    } else {
      body.classList.remove('light-theme');
      if (themeBtn) themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i> <span>화이트 모드</span>';
      localStorage.setItem('oneoffice_theme', 'dark');
    }
  };

  if (savedTheme === 'light') {
    setLightTheme(true);
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const isCurrentlyLight = body.classList.contains('light-theme');
      setLightTheme(!isCurrentlyLight);
    });
  }

  // ── 3. AuthModule 초기화 (로그인 UI + 세션 복원) ──────────────────
  AuthModule.init();

  const restored = await AuthModule.restoreSession();
  if (restored) {
    // 세션 복원 성공 → 대시보드 바로 표시
    AppState.currentUser = restored.employee;
    document.getElementById('loginOverlay')?.classList.remove('active');
    _updateUIForCurrentUser();
    _initAllFeatures();
  } else {
    // 로그인 필요
    document.getElementById('loginOverlay')?.classList.add('active');
    // 로그인 성공 콜백
    AuthModule.on('login', (employee, role) => {
      AppState.currentUser = employee;
      _updateUIForCurrentUser();
      _initAllFeatures();

      // 로그인 후 초기 렌더
      window.renderRegistryEvents();
      window.renderChatMessages();
      window.renderSecurityAuditLogs();
    });
  }

  // ── 3. 전역 시계 ───────────────────────────────────────────────────
  const clock = document.getElementById('globalClock');
  if (clock) {
    const updateClock = () => { clock.textContent = new Date().toTimeString().split(' ')[0]; };
    updateClock();
    setInterval(updateClock, 1000);
  }

  // ── 4. 날씨 위젯 ───────────────────────────────────────────────────
  MockAPI.fetchWeatherData().then(w => {
    const codes = {
      맑음: 'fa-sun', 구름조금: 'fa-cloud-sun', 안개: 'fa-smog',
      비: 'fa-cloud-showers-heavy', 눈: 'fa-snowflake', 소나기: 'fa-cloud-rain', 뇌우: 'fa-cloud-bolt',
    };
    const code = w.weathercode || 0;
    const desc = code >= 95 ? '뇌우' : code >= 80 ? '소나기' : code >= 71 ? '눈'
               : code >= 51 ? '비'   : code >= 45 ? '안개'   : code >= 1  ? '구름조금' : '맑음';
    const icon = codes[desc] || 'fa-sun';
    const widget = document.getElementById('weatherWidget');
    if (widget) widget.innerHTML = `<i class="fa-solid ${icon}"></i><span>서울시, ${desc} ${Math.round(w.temperature)}°C</span>`;
  });

  // ── 5. 모달 닫기 버튼 바인딩 ────────────────────────────────────────
  const modalCloseMap = {
    'profileModalClose':        'profileModal',
    'memberDetailModalClose':   'memberDetailModal',
    'floatingChatClose':        null,  // 특수 처리
    'congratsCardClose':        'congratsCardModal',
    'registryGiftClose':        'registryGiftModal',
    'marketRegisterClose':      'marketRegisterModal',
  };
  Object.entries(modalCloseMap).forEach(([btnId, modalId]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (modalId) {
      btn.addEventListener('click', () => document.getElementById(modalId)?.classList.remove('active'));
    }
  });

  // 플로팅 채팅창 닫기
  const floatingClose = document.getElementById('floatingChatClose');
  const floatingWindow= document.getElementById('floatingChatWindow');
  if (floatingClose && floatingWindow) {
    floatingClose.addEventListener('click', () => floatingWindow.classList.remove('active'));
  }
  const floatingBtn = document.getElementById('floatingBtn');
  if (floatingBtn && floatingWindow) {
    floatingBtn.addEventListener('click', () => floatingWindow.classList.toggle('active'));
  }

  // ── 6. 주기적 동기화 (3초마다 — 채팅/마켓/보안로그 변경 감지) ─────
  setInterval(async () => {
    if (!AppState.currentUser) return;

    const prevChatLen  = (AppState.chatLogs[AppState.activeChatTarget] || []).length;
    const prevMktLen   = AppState.fleaMarketItems.length;
    const prevLogLen   = AppState.securityLogs.length;

    await _syncState();

    const curChatLen = (AppState.chatLogs[AppState.activeChatTarget] || []).length;
    if (prevChatLen !== curChatLen)        window.renderChatMessages();
    if (prevMktLen  !== AppState.fleaMarketItems.length) window.renderMarketItems();
    if (prevLogLen  !== AppState.securityLogs.length)    window.renderSecurityAuditLogs();

    _updateUIForCurrentUser();
  }, 3000);
});

// ═══════════════════════════════════════════════════════════════════════
// 🔧 기능 모듈 일괄 초기화 (로그인 후 1회 실행)
// ═══════════════════════════════════════════════════════════════════════
function _initAllFeatures() {
  // 각 모듈 초기화
  CalendarModule.init();
  SalaryModule.init();
  WelfareModule.init();

  // 대시보드
  _renderDashboard();

  // 조직도
  _initDirectory();

  // 메신저
  _initMessenger();

  // 프로필 편집
  _initProfileEdit();

  // 플리마켓 필터 & 검색
  _initMarket();

  // 경조사 탭
  _initRegistry();

  // AI 오피스 (탭 스위칭)
  _initAIOffice();

  // 출퇴근 기록 버튼
  _initAttendance();

  // 결재 탭
  _initApproval();

  // 업무 보고 탭
  _initReports();

  // 기분 체크
  _initMoodCheck();

  // 추가 패치 기능 직접 초기화 (통합)
  _initCalendarEditFeatures();
  _initFloatingMessengerBubble();
  _injectReportTemplateButtons();
  _renderMyEventsList();
  _initWelfareMapInterceptor();

  // ✨ 신규 기능 초기화
  _initTeamAttendance();
  _initSVGOrgChart();
  _initAICopilot();

  // 초기 렌더
  _updateUIForCurrentUser();
  window.renderRegistryEvents();
  window.renderMarketItems();
}

// 대시보드 렌더
function _renderDashboard() {
  const feedList = document.getElementById('dashboardFeedList');
  if (feedList) {
    feedList.innerHTML = `
      <div class="feed-item" style="border-left:3px solid var(--success);">
        <div style="font-size:0.75rem;color:var(--text-muted);">방금 전 · 알림</div>
        <div style="font-size:0.85rem;margin-top:2px;"><strong>OneOffice</strong> 사내 인트라넷이 정식 오픈되었습니다.</div>
      </div>
      <div class="feed-item" style="border-left:3px solid var(--secondary);">
        <div style="font-size:0.75rem;color:var(--text-muted);">1시간 전 · 안내</div>
        <div style="font-size:0.85rem;margin-top:2px;">사내 플리마켓 & 실시간 경조사 선물 발송 기능이 출시되었습니다! 🛍️</div>
      </div>`;
  }
  window.renderRegistryEvents();
}

// 조직도 초기화
function _initDirectory() {
  const grid = document.getElementById('directoryGrid');
  if (!grid) return;
  const gradients = [
    'linear-gradient(135deg,var(--primary),var(--secondary))',
    'linear-gradient(135deg,var(--secondary),var(--accent))',
    'linear-gradient(135deg,var(--accent),var(--primary))',
    'linear-gradient(135deg,var(--success),var(--secondary))',
  ];
  function renderEmps(list) {
    grid.innerHTML = (list || AppState.employees).map(emp => `
      <div class="employee-card glass glass-interactive" onclick="showMemberDetail(${emp.id})">
        <div class="emp-avatar" style="background:${gradients[emp.id % gradients.length]}">${emp.initial || emp.name[0]}</div>
        <div>
          <div class="emp-name">${emp.name}</div>
          <div class="emp-title-dept">${emp.dept} · ${emp.title}</div>
          <div style="font-size:0.75rem;color:var(--secondary);margin-top:4px;">${emp.status}</div>
          <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap;">
            ${emp.mbti      ? `<span class="mbti-badge">${emp.mbti}</span>` : ''}
            ${emp.workStyle ? `<span class="style-badge">${emp.workStyle}</span>` : ''}
          </div>
        </div>
      </div>`).join('');
  }
  renderEmps();

  document.querySelectorAll('.filter-bar .btn-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-bar .btn-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const dept = btn.getAttribute('data-filter');
      renderEmps(dept === 'all' ? null : AppState.employees.filter(e => e.dept === dept));
    });
  });

  // 실시간 직원 검색 (directorySearch)
  const dirSearch = document.getElementById('directorySearch');
  if (dirSearch) {
    let _dST;
    dirSearch.addEventListener('input', () => {
      clearTimeout(_dST);
      _dST = setTimeout(() => {
        const q = dirSearch.value.toLowerCase().trim();
        const ad = document.querySelector('.filter-bar .btn-filter.active')?.getAttribute('data-filter') || 'all';
        let list = ad === 'all' ? AppState.employees : AppState.employees.filter(e => e.dept === ad);
        if (q) list = list.filter(e =>
          e.name.toLowerCase().includes(q) || e.dept.toLowerCase().includes(q) ||
          e.title.toLowerCase().includes(q) || (e.mbti||'').toLowerCase().includes(q));
        renderEmps(list.length ? list : AppState.employees);
      }, 150);
    });
  }

  document.querySelectorAll('.org-node').forEach(node => {
    node.addEventListener('click', () => {
      const emp = AppState.employees.find(e => e.id === Number(node.getAttribute('data-emp-id')));
      if (emp) window.showMemberDetail(emp.id);
    });
  });
}

window.showMemberDetail = function(empId) {
  const emp   = AppState.employees.find(e => e.id === empId);
  if (!emp) return;
  const modal = document.getElementById('memberDetailModal');
  if (!modal) return;
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('detailModalAvatar',    emp.initial || emp.name[0]);
  setEl('detailModalName',      emp.name);
  setEl('detailModalTitleDept', `${emp.dept} · ${emp.title}`);
  setEl('detailModalEmail',     emp.email);
  setEl('detailModalPhone',     emp.phone);
  setEl('detailModalJoinDate',  emp.joinDate);
  setEl('detailModalStatus',    emp.status);
  setEl('detailModalMBTI',      emp.mbti      || 'N/A');
  setEl('detailModalWorkStyle', emp.workStyle || 'N/A');

  const chatBtn = document.getElementById('detailModalChatBtn');
  if (chatBtn) {
    const newBtn = chatBtn.cloneNode(true);
    chatBtn.parentNode.replaceChild(newBtn, chatBtn);
    newBtn.addEventListener('click', () => {
      modal.classList.remove('active');
      window.openDMPanel(emp.id, emp.name);
    });
  }
  modal.classList.add('active');
};

// 메신저 초기화
function _initMessenger() {
  const channelItems = document.querySelectorAll('.chat-channel-item');
  channelItems.forEach(item => {
    item.addEventListener('click', () => {
      channelItems.forEach(c => c.classList.remove('active'));
      item.classList.add('active');
      AppState.activeChatTarget = item.getAttribute('data-chat-target');
      window.renderChatMessages();
    });
  });

  const sendBtn = document.getElementById('chatSendBtn');
  const input   = document.getElementById('chatInput');
  const sendMsg = async () => {
    const text = input?.value.trim();
    if (!text || !AppState.currentUser) return;
    const target = AppState.activeChatTarget;
    const msg = await MockAPI.saveChatMessage(target, 'sent', AppState.currentUser.name, text);
    if (!AppState.chatLogs[target]) AppState.chatLogs[target] = [];
    AppState.chatLogs[target].push(msg);
    if (input) input.value = '';
    window.renderChatMessages();

    // Bot 자동 응답
    if (target === 'bot') {
      setTimeout(async () => {
        const aiText = await MockAPI.generateWithAI(text);
        const botMsg = await MockAPI.saveChatMessage('bot', 'received', 'AI Assistant', aiText);
        if (!AppState.chatLogs['bot']) AppState.chatLogs['bot'] = [];
        AppState.chatLogs['bot'].push(botMsg);
        window.renderChatMessages();
      }, 1200);
    }
  };
  if (sendBtn) sendBtn.addEventListener('click', sendMsg);
  if (input)   input.addEventListener('keypress', e => { if (e.key === 'Enter') sendMsg(); });
}

// 프로필 편집
function _initProfileEdit() {
  // 좌측 하단 프로필 영역(currentUserBtn) 클릭 시 모달이 정상적으로 열리도록 바인딩
  const profileBtn  = document.getElementById('currentUserBtn');
  const profileModal= document.getElementById('profileModal');
  if (profileBtn && profileModal) {
    profileBtn.addEventListener('click', () => profileModal.classList.add('active'));
  }
  const form = document.getElementById('profileEditForm');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      AppState.currentUser.name      = document.getElementById('profileNameInput')?.value   || AppState.currentUser.name;
      AppState.currentUser.status    = document.getElementById('profileStatusInput')?.value || AppState.currentUser.status;
      AppState.currentUser.mbti      = document.getElementById('profileMBTIInput')?.value   || '';
      AppState.currentUser.workStyle = document.getElementById('profileStyleInput')?.value  || '';
      AppState.currentUser.email     = document.getElementById('profileEmailInput')?.value  || AppState.currentUser.email;
      AppState.currentUser.phone     = document.getElementById('profilePhoneInput')?.value  || AppState.currentUser.phone;
      AppState.currentUser.dept      = document.getElementById('profileDeptInput')?.value   || AppState.currentUser.dept;
      AppState.currentUser.title     = document.getElementById('profileTitleInput')?.value  || AppState.currentUser.title;

      // CloudDB에 업데이트 (비동기 대기 추가)
      const idx = AppState.employees.findIndex(e => e.id === AppState.currentUser.id);
      if (idx !== -1) AppState.employees[idx] = { ...AppState.employees[idx], ...AppState.currentUser };
      await CloudDB.set('employees', AppState.employees);
      localStorage.setItem('ex_logged_user', JSON.stringify(AppState.currentUser));

      profileModal?.classList.remove('active');
      _updateUIForCurrentUser();
      // 조직도가 있을 경우 리렌더링
      if (window.renderRegistryEvents) {
        const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'all';
        const filtered = activeFilter === 'all' ? AppState.employees : AppState.employees.filter(emp => emp.dept === activeFilter);
        const grid = document.getElementById('directoryGrid');
        if (grid) {
          const gradients = [
            'linear-gradient(135deg,var(--primary),var(--secondary))',
            'linear-gradient(135deg,var(--secondary),var(--accent))',
            'linear-gradient(135deg,var(--accent),var(--primary))',
            'linear-gradient(135deg,var(--success),var(--secondary))',
          ];
          grid.innerHTML = filtered.map(emp => `
            <div class="employee-card glass glass-interactive" onclick="showMemberDetail(${emp.id})">
              <div class="emp-avatar" style="background:${gradients[emp.id % gradients.length]}">${emp.initial || emp.name[0]}</div>
              <div>
                <div style="font-weight:700;font-size:0.95rem;">${emp.name}</div>
                <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">${emp.dept} · ${emp.title}</div>
              </div>
            </div>
          `).join('');
        }
      }
      window.showToast('✅ 프로필 업데이트', '변경사항이 저장되었습니다.', 'success');
    });
  }
}

// 플리마켓 초기화
function _initMarket() {
  document.querySelectorAll('#marketCategoryFilters button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#marketCategoryFilters button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      window.renderMarketItems();
    });
  });
  const search = document.getElementById('marketSearch');
  if (search) search.addEventListener('input', window.renderMarketItems);

  const openBtn  = document.getElementById('btnOpenRegisterMarket');
  const modal    = document.getElementById('marketRegisterModal');
  if (openBtn && modal) openBtn.addEventListener('click', () => modal.classList.add('active'));

  const form = document.getElementById('marketRegisterForm');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const title       = document.getElementById('marketItemTitle')?.value.trim();
      const category    = document.getElementById('marketItemCategory')?.value;
      const price       = document.getElementById('marketItemPrice')?.value;
      const description = document.getElementById('marketItemDesc')?.value.trim();
      const image       = document.getElementById('marketItemImage')?.value.trim();
      if (!title || !price || !description) { alert('제목, 가격, 설명을 모두 입력해주세요.'); return; }

      const newItem = {
        id: 'item' + Date.now(), title, category, price: Number(price),
        sellerId: AppState.currentUser.id,
        sellerName: AppState.currentUser.name + ' (' + AppState.currentUser.title.split(' ')[0] + ')',
        description, image, status: '판매중',
        date: new Date().toISOString().slice(0,10),
      };
      AppState.fleaMarketItems.unshift(newItem);
      CloudDB.set('fleaMarketItems', AppState.fleaMarketItems);
      await MockAPI.fetchDataFromServer('/api/market', 'POST', newItem);

      window.showToast('🛍️ 마켓 물품 등록', `'${title}'이 마켓에 등록되었습니다.`, 'success');
      modal?.classList.remove('active');
      form.reset();
      window.renderMarketItems();
    });
  }
}

// 경조사 탭 초기화
function _initRegistry() {
  const congratsModal = document.getElementById('congratsCardModal');
  document.getElementById('btnSendCongratsMessage')?.addEventListener('click', async () => {
    const text       = document.getElementById('congratsMessageText')?.value.trim();
    const receiverId = congratsModal?.getAttribute('data-receiver-id');
    const receiverName = document.getElementById('congratsTargetName')?.textContent;
    if (!text) return;
    await MockAPI.saveChatMessage(String(receiverId), 'sent', AppState.currentUser?.name, text);
    congratsModal?.classList.remove('active');
    window.showToast('💌 축전 발송 완료', `${receiverName}님께 축하 메시지를 보냈습니다.`, 'success');
  });

  const giftModal = document.getElementById('registryGiftModal');
  document.getElementById('btnSendGiftAndMessage')?.addEventListener('click', async () => {
    const receiverId   = giftModal?.getAttribute('data-receiver-id');
    const receiverName = document.getElementById('giftTargetName')?.textContent;
    const selectedOpt  = document.querySelector('input[name="giftOption"]:checked');
    if (!selectedOpt) { alert('기프티콘 선물을 선택해주세요.'); return; }
    const points   = Number(selectedOpt.getAttribute('data-points'));
    const giftName = selectedOpt.getAttribute('data-name');
    const msg      = document.getElementById('giftMessageText')?.value.trim() || `${giftName} 선물을 보냅니다! 축하드려요 🎉`;

    const result = await WelfareModule.transferPoints(AppState.currentUser?.id, Number(receiverId), points, msg);
    if (!result.success) { alert('보유 복지 포인트가 부족합니다.'); return; }

    giftModal?.classList.remove('active');
    _updateUIForCurrentUser();
    window.showToast('🎁 선물 발송 성공', `${receiverName}님께 ${giftName} 기프티콘을 발송했습니다.`, 'success');
  });
}

// AI 오피스 탭 스위칭 & 7대 기능 비동기 바인딩
function _initAIOffice() {
  // 탭 변경 리스너
  document.querySelectorAll('#aioffice .ai-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#aioffice .ai-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ai-sub-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.getAttribute('data-aitab'));
      if (target) target.classList.add('active');
    });
  });

  // 1on1 면담용 직원 목록 옵션 동적 렌더링
  const oneonSelect = document.getElementById('oneonEmpSelect');
  if (oneonSelect) {
    const list = AppState.employees || [];
    oneonSelect.innerHTML = '<option value="">직원을 선택하세요...</option>' + 
      list.map(e => `<option value="${e.id}">${e.name} (${e.dept} · ${e.title})</option>`).join('');
  }

  // 1. 📊 AI 엑셀 분석
  const loadSampleBtn = document.getElementById('loadSampleDataBtn');
  const genReportBtn = document.getElementById('generateReportBtn');
  const excelInput   = document.getElementById('excelDataInput');
  const excelOutput  = document.getElementById('aiReportOutput');

  if (loadSampleBtn && excelInput) {
    loadSampleBtn.addEventListener('click', () => {
      const list = AppState.employees || [];
      const csvLines = ['이름,부서,직급,MBTI,소통방식'];
      list.forEach(e => {
        csvLines.push(`${e.name},${e.dept},${e.title},${e.mbti || '?'},${e.workStyle || '?'}`);
      });
      excelInput.value = csvLines.join('\n');
      window.showToast('📊 데이터 로드 완료', '사내 직원 명부 정보를 CSV 데이터로 불러왔습니다.', 'success');
    });
  }

  if (genReportBtn && excelInput && excelOutput) {
    genReportBtn.addEventListener('click', async () => {
      const val = excelInput.value.trim();
      if (!val) { window.showToast('입력 오류', '분석할 CSV 데이터를 입력해주세요.', 'warning'); return; }

      excelOutput.innerHTML = '<div style="text-align:center;padding:30px;"><i class="fa-solid fa-spinner fa-spin fa-2xl"></i><div style="margin-top:14px;font-size:0.85rem;">인공지능이 데이터를 다차원으로 분석하는 중...</div></div>';
      genReportBtn.disabled = true;

      try {
        const prompt = `다음은 사내 임직원 데이터(CSV 포맷)입니다. 이 데이터를 심도있게 분석하고 보고서 형태로 작성해줘.\n데이터:\n${val}\n\n보고서 양식(마크다운):\n- 1. 조직 통계 요약 (부서별 인원 분포 등)\n- 2. 구성원 성향(MBTI/소통 스타일) 특이사항 및 트렌드\n- 3. 추천 조율 방안 및 관리자 조언`;
        const aiText = await MockAPI.generateWithAI(prompt);
        excelOutput.innerHTML = `<div style="white-space:pre-wrap; font-size:0.88rem; line-height:1.7;">${aiText}</div>`;
        window.showToast('🤖 AI 분석 완료', '데이터 분석 보고서 작성이 완료되었습니다.', 'success');
      } catch (err) {
        excelOutput.innerHTML = '<div style="color:var(--danger);">보고서 생성 중 오류가 발생했습니다. 다시 시도해 주세요.</div>';
      } finally {
        genReportBtn.disabled = false;
      }
    });
  }

  // 2. 🖵 PPT 자동 생성
  const genPPTBtn = document.getElementById('generatePPTBtn');
  const pptTitleInput = document.getElementById('pptTitle');
  const pptContentInput = document.getElementById('pptContent');
  const slideViewer = document.getElementById('slideViewer');
  const downloadSlidesBtn = document.getElementById('downloadSlidesBtn');

  if (genPPTBtn && pptTitleInput && pptContentInput && slideViewer) {
    genPPTBtn.addEventListener('click', async () => {
      const title = pptTitleInput.value.trim();
      const content = pptContentInput.value.trim();
      if (!title || !content) { window.showToast('입력 오류', '제목과 내용을 입력해 주세요.', 'warning'); return; }

      slideViewer.innerHTML = '<div style="text-align:center;padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2xl"></i><div style="margin-top:14px;font-size:0.85rem;">AI 슬라이드 레이아웃을 생성 중...</div></div>';
      genPPTBtn.disabled = true;
      if (downloadSlidesBtn) downloadSlidesBtn.style.display = 'none';

      try {
        const prompt = `다음 발표 내용을 바탕으로 3장의 PPT 슬라이드 구성안을 JSON 배열 형식으로만 작성해줘. JSON 코드 이외의 다른 인사말이나 설명 텍스트는 절대 포함하지 말아줘.
출력 포맷 예시:
[
  {"num": 1, "title": "슬라이드 1 제목", "bullets": ["핵심 포인트 1", "핵심 포인트 2"], "layout": "메인 타이틀 레이아웃"},
  {"num": 2, "title": "슬라이드 2 제목", "bullets": ["상세 요약 1", "상세 요약 2"], "layout": "2컬럼 대조 구조"},
  {"num": 3, "title": "슬라이드 3 제목", "bullets": ["결론 및 액션 플랜 1", "결론 및 액션 플랜 2"], "layout": "결론 강조 레이아웃"}
]

발표 제목: ${title}
발표 내용: ${content}`;

        const aiText = await MockAPI.generateWithAI(prompt);
        // JSON 추출 강화 (앞뒤로 텍스트가 섞여 있어도 대괄호 배열 영역만 추출)
        const startIdx = aiText.indexOf('[');
        const endIdx = aiText.lastIndexOf(']') + 1;
        if (startIdx === -1 || endIdx === -1) {
          throw new Error('정상적인 슬라이드 JSON 배열이 포함되어 있지 않습니다.');
        }
        const cleanJSON = aiText.substring(startIdx, endIdx);
        const slides = JSON.parse(cleanJSON);

        let slidesHTML = '';
        slides.forEach(slide => {
          slidesHTML += `
            <div class="glass" style="padding:20px; border-radius:12px; border:1px solid var(--border-color); display:flex; flex-direction:column; gap:10px; background:linear-gradient(135deg, rgba(255,255,255,0.01), rgba(255,255,255,0.03)); position:relative; min-height:180px;">
              <span style="position:absolute; bottom:14px; right:20px; font-size:1.4rem; font-weight:800; opacity:0.1;">SLIDE ${slide.num}</span>
              <div style="font-size:0.75rem; font-weight:700; color:var(--secondary); text-transform:uppercase; letter-spacing:1px;"><i class="fa-solid fa-layer-group"></i> ${slide.layout}</div>
              <h4 style="font-size:1.05rem; font-weight:700; color:var(--text-main); margin-top:4px;">${slide.title}</h4>
              <ul style="margin-left:18px; color:var(--text-muted); font-size:0.85rem; display:flex; flex-direction:column; gap:6px; margin-top:8px;">
                ${slide.bullets.map(b => `<li>${b}</li>`).join('')}
              </ul>
            </div>
          `;
        });
        slideViewer.innerHTML = slidesHTML;
        if (downloadSlidesBtn) downloadSlidesBtn.style.display = 'inline-block';
        window.showToast('🤖 AI PPT 완성', '3장의 슬라이드 초안 레이아웃이 완성되었습니다.', 'success');
      } catch (err) {
        console.error(err);
        slideViewer.innerHTML = '<div style="color:var(--danger);padding:20px;text-align:center;">슬라이드 생성 중 실패했습니다. 올바른 텍스트 구조로 다시 시도해 주세요.</div>';
      } finally {
        genPPTBtn.disabled = false;
      }
    });

    if (downloadSlidesBtn) {
      downloadSlidesBtn.addEventListener('click', () => {
        window.print();
      });
    }

    // exportToPPTBtn: 슬라이드를 HTML 파일로 내보내기
    const exportToPPTBtn = document.getElementById('exportToPPTBtn');
    if (exportToPPTBtn) {
      exportToPPTBtn.addEventListener('click', () => {
        const slides = slideViewer?.innerHTML;
        if (!slides || !slides.trim()) {
          window.showToast?.('⚠️ 슬라이드 없음', '먼저 슬라이드를 생성해주세요.', 'warning');
          return;
        }
        const title = pptTitleInput?.value?.trim() || 'OneOffice_슬라이드';
        const blob = new Blob([
          '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>' + title + '</title>' +
          '<style>body{font-family:sans-serif;background:#0f1117;color:#f1f5f9;padding:40px}' +
          '.slide{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:24px;margin-bottom:24px;page-break-after:always;}</style></head>' +
          '<body><h1 style="color:#6366f1;margin-bottom:24px;">' + title + '</h1>' + slides + '</body></html>'
        ], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = title.replace(/\s+/g,'_') + '.html';
        a.click();
        URL.revokeObjectURL(a.href);
        window.showToast?.('📥 내보내기 완료', title + '.html 파일이 저장되었습니다.', 'success');
      });
    }
  }

  // 3. ✍️ 결재 초안 작성기
  const genDraftBtn = document.getElementById('generateDraftBtn');
  const draftDocType = document.getElementById('draftDocType');
  const draftSituation = document.getElementById('draftSituation');
  const draftOutput = document.getElementById('draftDocOutput');
  const printDraftBtn = document.getElementById('printDraftBtn');

  if (genDraftBtn && draftDocType && draftSituation && draftOutput) {
    // 퀵 프롬프트 예제 클릭 리스너 연결
    document.querySelectorAll('#ai-draft .quick-prompt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-prompt');
        const type = btn.getAttribute('data-type');
        if (draftDocType) draftDocType.value = type;
        if (draftSituation) draftSituation.value = prompt;
      });
    });

    genDraftBtn.addEventListener('click', async () => {
      const type = draftDocType.value;
      const sit  = draftSituation.value.trim();
      if (!sit) { window.showToast('입력 오류', '상황 설명을 입력해 주세요.', 'warning'); return; }

      draftOutput.innerHTML = '<div style="text-align:center;padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2xl"></i><div style="margin-top:14px;font-size:0.85rem;">정형 규격 기안서를 작성 중...</div></div>';
      genDraftBtn.disabled = true;
      if (printDraftBtn) printDraftBtn.style.display = 'none';

      try {
        const prompt = `다음 상황 정보를 바탕으로 공식 비즈니스용 '${type}' 기안서 초안을 작성해줘. 
문서 번호, 기안 일자, 기안자(홍길동 대리), 제목, 기안 목적, 세부 상세 내역, 예산/비용 처리가 포함된 정형화된 공문서 규격에 알맞게 작성해줘.\n상황 설명:\n${sit}`;
        const aiText = await MockAPI.generateWithAI(prompt);
        draftOutput.innerHTML = `
          <div style="padding:20px; border:1px solid var(--border-color); border-radius:8px; background:rgba(255,255,255,0.01); font-family:monospace; white-space:pre-wrap; font-size:0.85rem; line-height:1.8;">
            ${aiText}
          </div>
          <div style="margin-top:14px; display:flex; justify-content:flex-end;">
            <button class="btn-primary" style="padding:6px 12px; font-size:0.78rem;" onclick="window.showToast('📄 상신 완료', 'AI가 작성한 기안서가 결재 문서함으로 연동 상신되었습니다.', 'success')"><i class="fa-solid fa-file-export"></i> 결재선 연동 상신</button>
          </div>
        `;
        if (printDraftBtn) printDraftBtn.style.display = 'inline-block';
        window.showToast('🤖 AI 기안서 완성', '기안 초안 작성이 완료되었습니다.', 'success');
      } catch (err) {
        draftOutput.innerHTML = '<div style="color:var(--danger);">초안 생성 도중 오류가 발생했습니다.</div>';
      } finally {
        genDraftBtn.disabled = false;
      }
    });

    if (printDraftBtn) {
      printDraftBtn.addEventListener('click', () => {
        const printContent = draftOutput.innerHTML;
        const orig = document.body.innerHTML;
        document.body.innerHTML = `
          <div style="padding:50px; background:white; color:black; font-family:monospace; line-height:1.8;">
            ${printContent}
          </div>
        `;
        window.print();
        document.body.innerHTML = orig;
        window.location.reload(); // 복구
      });
    }
  }

  // 4. ⚖️ AI 노무 컨설턴트 (챗봇)
  const hrSendBtn = document.getElementById('hrChatSend');
  const hrInput   = document.getElementById('hrChatInput');
  const hrWindow  = document.getElementById('hrChatWindow');

  if (hrWindow) {
    // 퀵 질문 클릭 매핑
    document.querySelectorAll('#ai-hr .hr-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-q');
        if (hrInput) { hrInput.value = q; hrSendBtn?.click(); }
      });
    });

    const sendHRChat = async () => {
      const txt = hrInput.value.trim();
      if (!txt) return;

      // 사용자 말풍선 추가
      const userBubble = document.createElement('div');
      userBubble.className = 'chat-bubble bubble-sent';
      userBubble.style.margin = '10px 0';
      userBubble.innerHTML = `<span style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:3px;">나</span>${txt}`;
      hrWindow.appendChild(userBubble);
      hrInput.value = '';
      hrWindow.scrollTop = hrWindow.scrollHeight;

      // AI 대기 말풍선 추가
      const aiBubble = document.createElement('div');
      aiBubble.className = 'chat-bubble bubble-received';
      aiBubble.style.margin = '10px 0';
      aiBubble.innerHTML = `<span style="font-size:0.75rem;color:var(--secondary);display:block;margin-bottom:3px;">AI 노무 컨설턴트</span><i class="fa-solid fa-spinner fa-spin"></i> 노무 법령 검토 중...`;
      hrWindow.appendChild(aiBubble);
      hrWindow.scrollTop = hrWindow.scrollHeight;

      try {
        const prompt = `당신은 대한민국 고용노동법에 정통한 일류 노무사입니다. 다음 질문에 대해 현행 법 규정과 가이드를 친절하고 알기 쉽게 답변해 주세요. 만약 계산이 필요한 질문(주휴수당 등)의 경우 자세한 계산식도 표기해줘.\n질문: ${txt}`;
        const aiText = await MockAPI.generateWithAI(prompt);
        aiBubble.innerHTML = `<span style="font-size:0.75rem;color:var(--secondary);display:block;margin-bottom:3px;">AI 노무 컨설턴트</span><div style="white-space:pre-wrap;line-height:1.6;font-size:0.85rem;">${aiText}</div>`;
      } catch (err) {
        aiBubble.innerHTML = `<span style="font-size:0.75rem;color:var(--secondary);display:block;margin-bottom:3px;">AI 노무 컨설턴트</span>노무 상담 연결 실패. 다시 전송해 주세요.`;
      }
      hrWindow.scrollTop = hrWindow.scrollHeight;
    };

    if (hrSendBtn) hrSendBtn.addEventListener('click', sendHRChat);
    if (hrInput) hrInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendHRChat(); });
  }

  // 5. 🎙️ AI 회의록 요약
  const genMeetingBtn = document.getElementById('generateMeetingBtn');
  const meetingInput  = document.getElementById('meetingDataInput');
  const meetingOutput = document.getElementById('meetingReportOutput');

  if (genMeetingBtn && meetingInput && meetingOutput) {
    genMeetingBtn.addEventListener('click', async () => {
      const val = meetingInput.value.trim();
      if (!val) { window.showToast('입력 오류', '요약할 회의록 텍스트를 입력해주세요.', 'warning'); return; }

      meetingOutput.innerHTML = '<div style="text-align:center;padding:30px;"><i class="fa-solid fa-spinner fa-spin fa-2xl"></i><div style="margin-top:14px;font-size:0.85rem;">AI가 대화록의 의제와 결정 사항을 매핑하는 중...</div></div>';
      genMeetingBtn.disabled = true;

      try {
        const prompt = `다음 회의 원시 대화 기록을 요약하여 공식 회의록 보고서를 작성해줘.
포함해야 할 사항:
1. 회의 안건 (Agenda)
2. 대화 요약 및 의제 분석
3. 결정된 주요 사항 (Key Decisions)
4. 담당자별 할 일 목록 (Action Items)

대화 기록:\n${val}`;
        const aiText = await MockAPI.generateWithAI(prompt);
        meetingOutput.innerHTML = `<div style="white-space:pre-wrap; font-size:0.88rem; line-height:1.7;">${aiText}</div>`;
        window.showToast('🤖 회의록 요약 완료', '공식 회의록 요약 보고서 작성이 완료되었습니다.', 'success');
      } catch (err) {
        meetingOutput.innerHTML = '<div style="color:var(--danger);">회의록 요약 중 오류가 발생했습니다.</div>';
      } finally {
        genMeetingBtn.disabled = false;
      }
    });
  }

  // 6. 📢 AI 마케팅 카피라이터
  const genMarketingBtn = document.getElementById('generateMarketingBtn');
  const marketingKwInput = document.getElementById('marketingKeyword');
  const marketingDetailInput = document.getElementById('marketingDetail');
  const marketingOutput = document.getElementById('marketingOutput');

  if (genMarketingBtn && marketingKwInput && marketingDetailInput && marketingOutput) {
    genMarketingBtn.addEventListener('click', async () => {
      const kw = marketingKwInput.value.trim();
      const det = marketingDetailInput.value.trim();
      if (!kw) { window.showToast('입력 오류', '핵심 제품명/소재를 입력해 주세요.', 'warning'); return; }

      marketingOutput.innerHTML = '<div style="text-align:center;padding:30px;"><i class="fa-solid fa-spinner fa-spin fa-2xl"></i><div style="margin-top:14px;font-size:0.85rem;">최적의 광고 마케팅 카피 문구를 추천받는 중...</div></div>';
      genMarketingBtn.disabled = true;

      try {
        const prompt = `다음 핵심 키워드와 특징 정보를 조합하여, 
1) 공식 보도자료 첫 문장 헤드라인
2) 인스타그램 홍보용 트렌디한 감성 카피 3가지 시안
3) 링크드인(비즈니스용) 설득형 카피 1가지 시안을 각각 작성해줘. 해시태그와 적절한 이모티콘도 포함해줘.

핵심 소재: ${kw}
세부 특징: ${det}`;

        const aiText = await MockAPI.generateWithAI(prompt);
        marketingOutput.innerHTML = `<div style="white-space:pre-wrap; font-size:0.88rem; line-height:1.7;">${aiText}</div>`;
        window.showToast('🤖 카피 생성 완료', '마케팅 카피 추천 리스트가 생성되었습니다.', 'success');
      } catch (err) {
        marketingOutput.innerHTML = '<div style="color:var(--danger);">카피 문구 생성 도중 오류가 발생했습니다.</div>';
      } finally {
        genMarketingBtn.disabled = false;
      }
    });
  }

  // 7. 👥 1on1 면담 코치
  const genOneonBtn = document.getElementById('generateOneonBtn');
  const oneonRecent = document.getElementById('oneonRecentWork');
  const oneonOutput = document.getElementById('oneonOutput');

  if (genOneonBtn && oneonSelect && oneonRecent && oneonOutput) {
    genOneonBtn.addEventListener('click', async () => {
      const empId = oneonSelect.value;
      const detail = oneonRecent.value.trim();
      if (!empId) { window.showToast('선택 오류', '면담 대상 직원을 선택해 주세요.', 'warning'); return; }

      const emp = AppState.employees.find(e => String(e.id) === String(empId));
      if (!emp) return;

      oneonOutput.innerHTML = '<div style="text-align:center;padding:30px;"><i class="fa-solid fa-spinner fa-spin fa-2xl"></i><div style="margin-top:14px;font-size:0.85rem;">직원 성향과 MBTI 데이터를 융합하여 코칭 질문지를 생성 중...</div></div>';
      genOneonBtn.disabled = true;

      try {
        const prompt = `당신은 최고 수준의 HR 팀장 코치입니다. 면담 대상 직원의 인사 프로필 정보를 바탕으로 1대1 면담 준비 질문지와 가이드를 작성해줘.
대상 직원 이름: ${emp.name}
소속 부서: ${emp.dept}
직급: ${emp.title}
MBTI 성향: ${emp.mbti || '알 수 없음'}
소통 및 업무 성향: ${emp.workStyle || '알 수 없음'}
최근 업무 상태/특이사항: ${detail || '특이사항 없음'}

가이드 필수 항목:
1. 대상 직원의 성향(MBTI/소통 방식) 특징 해석 및 면담 시 마음을 여는 아이스브레이커 질문 3가지
2. 직무 상황 피드백 제공 요령
3. 관리자를 위한 코칭 및 격려 조언`;

        const aiText = await MockAPI.generateWithAI(prompt);
        oneonOutput.innerHTML = `<div style="white-space:pre-wrap; font-size:0.88rem; line-height:1.7;">${aiText}</div>`;
        window.showToast('🤖 1on1 가이드 완성', `${emp.name}님과의 면담 코칭 가이드가 완성되었습니다.`, 'success');
      } catch (err) {
        oneonOutput.innerHTML = '<div style="color:var(--danger);">가이드 생성 도중 오류가 발생했습니다.</div>';
      } finally {
        genOneonBtn.disabled = false;
      }
    });
  }
}

// 출퇴근 버튼
function _initAttendance() {
  let clockInTime = null;
  const clockInBtn  = document.getElementById('clockInBtn');
  const clockOutBtn = document.getElementById('clockOutBtn');
  const clockStatus = document.getElementById('clockStatus');
  if (clockInBtn) {
    clockInBtn.addEventListener('click', () => {
      clockInTime = new Date();
      if (clockStatus) clockStatus.textContent = `출근: ${clockInTime.toTimeString().split(' ')[0]}`;
      window.showToast('🟢 출근 완료', `${clockInTime.toTimeString().split(' ')[0]} 출근이 기록되었습니다.`, 'success');
    });
  }
  if (clockOutBtn) {
    clockOutBtn.addEventListener('click', () => {
      const now = new Date();
      const worked = clockInTime ? Math.round((now - clockInTime) / 60000) : 0;
      if (clockStatus) clockStatus.textContent = `퇴근: ${now.toTimeString().split(' ')[0]} (근무 ${worked}분)`;
      window.showToast('🔴 퇴근 완료', `${now.toTimeString().split(' ')[0]} 퇴근이 기록되었습니다.`, 'info');
    });
  }
}

// 결재 탭 초기화
function _initApproval() {
  const form = document.getElementById('approvalForm') || document.querySelector('#approval form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      window.showToast('📄 결재 상신 완료', '결재 문서가 상신되었습니다.', 'success');
    });
  }
}

// 업무 보고 탭 초기화
function _initReports() {
  const submitBtn = document.getElementById('submitReportBtn');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const title   = document.getElementById('reportTitle')?.value.trim();
      const content = document.getElementById('reportContent')?.value.trim();
      if (!title || !content) { window.showToast('입력 오류', '제목과 내용을 입력해주세요.', 'warning'); return; }

      const report = await MockAPI.saveReport({
        title, content, authorId: AppState.currentUser?.id,
        authorName: AppState.currentUser?.name, date: new Date().toISOString().slice(0,10),
      });
      AppState.reports.unshift(report);
      window.showToast('📊 보고 제출 완료', '업무 보고가 성공적으로 제출되었습니다.', 'success');
    });
  }
}

// 기분 체크 초기화
function _initMoodCheck() {
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.showToast('😊 기분 체크 완료', '오늘의 감정 상태가 기록되었습니다.', 'success');
    });
  });
  const chart = document.getElementById('moodTrendChart');
  if (chart) {
    chart.innerHTML = `<svg viewBox="0 0 300 100" style="width:100%;height:100px;">
      <polyline fill="none" stroke="var(--success)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
                points="20,80 60,65 100,50 140,75 180,45 220,55 260,35"/>
      ${[20,60,100,140,180,220,260].map((x,i)=>`<circle cx="${x}" cy="${[80,65,50,75,45,55,35][i]}" r="4" fill="var(--success)"/>`).join('')}
    </svg>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 📅 캘린더 이벤트 수정/삭제 기능
// ═══════════════════════════════════════════════════════════════════════
function _initCalendarEditFeatures() {
  // 수정 모달 닫기
  document.getElementById('eventEditClose')?.addEventListener('click', () => {
    document.getElementById('eventEditModal')?.classList.remove('active');
  });

  // 이벤트 저장
  document.getElementById('btnSaveEventEdit')?.addEventListener('click', () => {
    const eventId = document.getElementById('editEventId')?.value;
    const type    = document.getElementById('editLeaveType')?.value;
    const start   = document.getElementById('editLeaveStart')?.value;
    const end     = document.getElementById('editLeaveEnd')?.value;
    const reason  = document.getElementById('editLeaveReason')?.value;
    if (!eventId || !start) return;

    const idx = AppState.events.findIndex(e => e.id === eventId);
    if (idx !== -1) {
      AppState.events[idx] = { ...AppState.events[idx], type, start, end: end || start, reason };
      CloudDB.set('calendarEvents', AppState.events);
      CalendarModule.render();
      _renderMyEventsList();
      document.getElementById('eventEditModal')?.classList.remove('active');
      window.showToast('✅ 일정 수정 완료', '캘린더 일정이 수정되었습니다.', 'success');
    }
  });

  // 이벤트 삭제
  document.getElementById('btnDeleteEvent')?.addEventListener('click', () => {
    const eventId = document.getElementById('editEventId')?.value;
    if (!eventId) return;
    AppState.events = AppState.events.filter(e => e.id !== eventId);
    CloudDB.set('calendarEvents', AppState.events);
    CalendarModule.render();
    _renderMyEventsList();
    document.getElementById('eventEditModal')?.classList.remove('active');
    window.showToast('🗑️ 일정 삭제 완료', '캘린더 일정이 삭제되었습니다.', 'info');
  });
}

/** 내 일정 목록 렌더링 (전역 노출 — calendarModule.js에서도 호출 가능) */
function _renderMyEventsList() {
  const list = document.getElementById('myEventsList');
  if (!list) return;
  const userId = AppState.currentUser?.id;
  const myEvts = AppState.events
    .filter(e => e.employeeId === userId)
    .sort((a, b) => (b.start || '').localeCompare(a.start || ''))
    .slice(0, 8);

  if (myEvts.length === 0) {
    list.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);text-align:center;padding:16px;">등록된 일정이 없습니다.</div>`;
    return;
  }

  list.innerHTML = myEvts.map(evt => {
    const typeLabel = evt.title?.match(/\[(.+)\]/)?.[1] || '일정';
    const dateRange = evt.end && evt.end !== evt.start
      ? `${evt.start} ~ ${evt.end}`
      : evt.start;
    const isPending = evt.id?.startsWith('tmp_');
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:8px;font-size:0.8rem;cursor:pointer;transition:background 0.2s;"
         onmouseover="this.style.background='rgba(255,255,255,0.04)'"
         onmouseout="this.style.background='rgba(255,255,255,0.02)'"
         onclick="window.openEventEdit('${evt.id}')">
      <div style="display:flex;flex-direction:column;gap:3px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="background:${evt.color||'var(--primary)'};color:white;padding:2px 7px;border-radius:4px;font-size:0.7rem;font-weight:700;">${typeLabel}</span>
          ${isPending ? '<span style="font-size:0.65rem;color:var(--warning);">저장 중...</span>' : ''}
        </div>
        <span style="color:var(--text-muted);font-size:0.75rem;">${dateRange}</span>
      </div>
      <i class="fa-solid fa-pen-to-square" style="color:var(--text-muted);font-size:0.75rem;flex-shrink:0;"></i>
    </div>`;
  }).join('');
}
// 전역 노출: calendarModule.js 등 외부 모듈에서도 직접 호출 가능
window._renderMyEventsList = _renderMyEventsList;

/** 이벤트 수정 모달 열기 */
window.openEventEdit = function(eventId) {
  const evt = AppState.events.find(e => e.id === eventId);
  if (!evt) return;
  const typeLabel = evt.title?.match(/\[(.+)\]/)?.[1] || '기타';
  { const _e = document.getElementById('editEventId'); if (_e) _e.value = evt.id; }
  { const _e = document.getElementById('editLeaveType'); if (_e) _e.value = typeLabel; }
  { const _e = document.getElementById('editLeaveStart'); if (_e) _e.value = evt.start; }
  { const _e = document.getElementById('editLeaveEnd'); if (_e) _e.value = evt.end || evt.start; }
  { const _e = document.getElementById('editLeaveReason'); if (_e) _e.value = evt.reason || ''; }
  document.getElementById('eventEditModal')?.classList.add('active');
};

// ═══════════════════════════════════════════════════════════════════════
// 💬 조직도 → 메시지 슬라이드 팝업 패널
// ═══════════════════════════════════════════════════════════════════════
window.openDMPanel = function(empId, empName) {
  let panel = document.getElementById('dmSlidePanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'dmSlidePanel';
    panel.className = 'dm-panel';
    panel.innerHTML = `
      <div class="dm-panel-header">
        <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--secondary),var(--accent));display:flex;align-items:center;justify-content:center;font-weight:700;color:white;" id="dmPanelAvatar">?</div>
        <div>
          <div style="font-weight:700;" id="dmPanelName">이름</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">DM 메시지</div>
        </div>
        <button onclick="document.getElementById('dmSlidePanel').classList.remove('open')" style="margin-left:auto;background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">&times;</button>
      </div>
      <div class="dm-panel-body" id="dmPanelMessages">
        <div style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:20px;">메시지를 입력해 대화를 시작하세요.</div>
      </div>
      <div class="dm-panel-footer">
        <input type="text" class="form-control" id="dmPanelInput" placeholder="메시지를 입력하세요..." style="flex:1;" onkeypress="if(event.key==='Enter')window.sendDMPanel()">
        <button class="btn-primary" style="padding:10px 16px;" onclick="window.sendDMPanel()"><i class="fa-solid fa-paper-plane"></i></button>
      </div>`;
    document.body.appendChild(panel);
  }
  const target = String(empId);
  panel._target = target;
  { const _e = document.getElementById('dmPanelAvatar'); if (_e) _e.textContent = empName[0]; }
  { const _e = document.getElementById('dmPanelName'); if (_e) _e.textContent = empName; }

  // 기존 메시지 로드
  const msgs = AppState.chatLogs[target] || [];
  const body = document.getElementById('dmPanelMessages');
  if (msgs.length > 0) {
    body.innerHTML = msgs.slice(-20).map(m => {
      const isSent = m.sender === 'sent';
      return `<div style="display:flex;flex-direction:column;align-items:${isSent?'flex-end':'flex-start'};margin-bottom:8px;">
        ${!isSent ? `<div style="font-size:0.72rem;color:var(--secondary);margin-bottom:2px;">${m.senderName||empName}</div>` : ''}
        <div style="max-width:80%;padding:10px 14px;border-radius:14px;font-size:0.85rem;line-height:1.5;${isSent?'background:linear-gradient(135deg,var(--primary),#4f46e5);color:white;':'background:rgba(255,255,255,0.05);border:1px solid var(--border-color);'}">${m.text}</div>
      </div>`;
    }).join('');
    body.scrollTop = body.scrollHeight;
  } else {
    body.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:20px;">메시지를 입력해 대화를 시작하세요.</div>`;
  }

  panel.classList.add('open');
  document.getElementById('dmPanelInput')?.focus();
};

window.sendDMPanel = async function() {
  const panel  = document.getElementById('dmSlidePanel');
  const input  = document.getElementById('dmPanelInput');
  const text   = input?.value.trim();
  if (!text || !panel?._target || !AppState.currentUser) return;
  const target = panel._target;

  const msg = await MockAPI.saveChatMessage(target, 'sent', AppState.currentUser.name, text);
  if (!AppState.chatLogs[target]) AppState.chatLogs[target] = [];
  AppState.chatLogs[target].push(msg);
  input.value = '';

  const body = document.getElementById('dmPanelMessages');
  const div  = document.createElement('div');
  div.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;margin-bottom:8px;';
  div.innerHTML = `<div style="max-width:80%;padding:10px 14px;border-radius:14px;font-size:0.85rem;line-height:1.5;background:linear-gradient(135deg,var(--primary),#4f46e5);color:white;">${text}</div>`;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  window.showToast('💬 메시지 전송', '메시지가 전송되었습니다.', 'success');
};

// 조직도 구성원 "메시지 보내기" 버튼 패치 (원본에 통합 완료)


// ═══════════════════════════════════════════════════════════════════════
// 📋 업무 보고 템플릿 기능
// ═══════════════════════════════════════════════════════════════════════
const REPORT_TEMPLATES = {
  daily: {
    title: '일일 업무 보고',
    content: `[${new Date().toISOString().slice(0,10)}] 일일 업무 보고

■ 오늘 완료한 업무
1. 
2. 
3. 

■ 진행 중인 업무
1. 
2. 

■ 내일 예정 업무
1. 
2. 

■ 특이사항 / 이슈
- 없음

보고자: ${AppState.currentUser?.name || ''}`,
  },
  weekly: {
    title: '주간 업무 보고',
    content: `[${new Date().toISOString().slice(0,10)} 주간] 주간 업무 보고

■ 이번 주 완료 업무
- 

■ 핵심 성과
- 

■ 다음 주 계획
- 

■ 이슈 / 리스크
- 없음

보고자: ${AppState.currentUser?.name || ''}`,
  },
  project: {
    title: '프로젝트 진행 보고',
    content: `프로젝트 진행 현황 보고

■ 프로젝트명: 
■ 보고일: ${new Date().toISOString().slice(0,10)}
■ 진행률: %

■ 금주 달성 사항
- 

■ 지연 항목 및 사유
- 없음

■ 다음 마일스톤
- 기한: 
- 목표: 

보고자: ${AppState.currentUser?.name || ''}`,
  },
};

window.applyReportTemplate = function(tplKey) {
  const tpl = REPORT_TEMPLATES[tplKey];
  if (!tpl) return;
  const title   = document.getElementById('reportTitle');
  const content = document.getElementById('reportContent');
  if (title)   title.value   = tpl.title;
  if (content) content.value = tpl.content;
  window.showToast('📋 템플릿 적용', `'${tpl.title}' 템플릿이 적용되었습니다.`, 'success');
};

window.generateAIReportDraft = async function() {
  const title   = document.getElementById('reportTitle')?.value.trim();
  const content = document.getElementById('reportContent');
  if (!content) return;
  const prompt  = title ? `업무보고서 '${title}' 초안을 작성해줘.` : '오늘의 업무 보고서 초안을 작성해줘.';
  content.value = '⏳ AI가 초안을 작성 중입니다...';
  const aiText = await MockAPI.generateWithAI(prompt);
  content.value = aiText || '초안 생성에 실패했습니다. 직접 작성해주세요.';
  window.showToast('🤖 AI 초안 완성', '업무 보고서 초안이 작성되었습니다.', 'success');
};

// ═══════════════════════════════════════════════════════════════════════
// 💬 플로팅 메신저 버블 (우하단)
// ═══════════════════════════════════════════════════════════════════════
function _initFloatingMessengerBubble() {
  // 버블이 이미 없으면 생성
  if (document.getElementById('messengerFab')) return;
  const fab = document.createElement('button');
  fab.id = 'messengerFab';
  fab.className = 'messenger-fab';
  fab.title = '사내 메신저';
  fab.innerHTML = `<i class="fa-solid fa-comments"></i>`;
  fab.addEventListener('click', () => {
    // 메신저 탭으로 이동
    document.querySelector('.nav-item[data-tab="messenger"]')?.click();
  });
  document.body.appendChild(fab);
}

// ═══════════════════════════════════════════════════════════════════════
// 🛍️ 플리마켓 찜하기 기능
// ═══════════════════════════════════════════════════════════════════════
window.toggleWishlist = function(itemId) {
  let wishes = JSON.parse(localStorage.getItem('oo_wishlist') || '[]');
  const idx  = wishes.indexOf(itemId);
  if (idx === -1) {
    wishes.push(itemId);
    window.showToast('💛 찜 추가', '관심 목록에 추가되었습니다.', 'success');
  } else {
    wishes.splice(idx, 1);
    window.showToast('🤍 찜 해제', '관심 목록에서 제거되었습니다.', 'info');
  }
  localStorage.setItem('oo_wishlist', JSON.stringify(wishes));
  window.renderMarketItems();
};

// 플리마켓 렌더 함수 패치 — 찜 기능 추가
const _origRenderMarket = window.renderMarketItems;
window.renderMarketItems = function() {
  const grid = document.getElementById('marketItemsGrid');
  if (!grid) return;
  const wishes    = JSON.parse(localStorage.getItem('oo_wishlist') || '[]');
  const searchVal = (document.getElementById('marketSearch')?.value || '').toLowerCase();
  const activeCat = document.querySelector('#marketCategoryFilters button.active')?.getAttribute('data-category') || 'all';
  const filtered  = AppState.fleaMarketItems.filter(item => {
    const matchSearch = !searchVal || item.title.toLowerCase().includes(searchVal) || (item.description||'').toLowerCase().includes(searchVal);
    const matchCat    = activeCat === 'all' || item.category === activeCat;
    return matchSearch && matchCat;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column:span 3;text-align:center;padding:40px;color:var(--text-muted);">조회 조건에 맞는 상품이 없습니다. 🛍️</div>`;
    return;
  }

  const isWished = (id) => wishes.includes(id);
  grid.innerHTML = filtered.map(item => {
    const isMyItem    = item.sellerId === AppState.currentUser?.id;
    const statusColor = item.status === '판매중' ? 'var(--success)' : item.status === '예약중' ? 'var(--warning)' : 'var(--text-muted)';
    const wished      = isWished(item.id);
    return `<div class="welfare-benefit-card glass glass-interactive" style="flex-direction:column;align-items:stretch;padding:14px;gap:10px;border-radius:14px;min-height:350px;">
      <div style="position:relative;width:100%;height:160px;overflow:hidden;border-radius:10px;">
        <img src="${item.image}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='https://images.unsplash.com/photo-1546213290-e1b7610339e5?w=400&q=80'">
        <span class="nav-badge" style="position:absolute;top:10px;left:10px;background:${statusColor};font-size:0.7rem;color:white;">${item.status}</span>
        <button onclick="window.toggleWishlist('${item.id}')" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.5);border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;color:${wished?'var(--danger)':'white'};font-size:0.9rem;" title="${wished?'찜 해제':'찜하기'}">
          <i class="fa-${wished?'solid':'regular'} fa-heart"></i>
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-grow:1;">
        <div style="font-weight:700;font-size:0.95rem;">${item.title}</div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--secondary);">${Number(item.price).toLocaleString()}원</div>
        <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;flex-grow:1;">${item.description}</div>
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-muted);border-top:1px dashed var(--border-color);padding-top:8px;margin-top:8px;">
          <span>👤 ${item.sellerName}</span><span>📅 ${item.date}</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        ${isMyItem
          ? `<select class="form-control" style="padding:6px;font-size:0.78rem;" onchange="updateMarketItemStatus('${item.id}',this.value)">
               <option ${item.status==='판매중'?'selected':''}>판매중</option>
               <option ${item.status==='예약중'?'selected':''}>예약중</option>
               <option ${item.status==='판매완료'?'selected':''}>판매완료</option>
             </select>`
          : `<button class="btn-primary" style="flex-grow:1;padding:8px;font-size:0.8rem;" onclick="startMarketInquiry('${item.id}',${item.sellerId},'${item.title}')">
               <i class="fa-solid fa-comments"></i> 구매 문의하기
             </button>`
        }
      </div>
    </div>`;
  }).join('');
};

// ═══════════════════════════════════════════════════════════════════════
// 🗺️ 카카오맵 연동 및 주변 맛집 검색 (동적 로딩 + GPS 위치 기반)
// ═══════════════════════════════════════════════════════════════════════
let kakaoMapInstance = null;
let kakaoMapMarkers  = [];
let _kakaoMapLoading = false;
let _kakaoUserLat    = 37.5006;  // 기본값: 역삼역
let _kakaoUserLng    = 127.0364;

// SDK 동적 로딩 Promise
function _loadKakaoSDK() {
  return new Promise((resolve, reject) => {
    if (window.kakao && window.kakao.maps && window.kakao.maps.Map) { resolve(); return; }
    if (window.kakao && window.kakao.maps) { kakao.maps.load(() => resolve()); return; }
    const existing = document.getElementById('kakaoMapScript');
    if (existing) {
      existing.addEventListener('load',  () => kakao.maps.load(() => resolve()));
      existing.addEventListener('error', () => reject(new Error('SDK 로드 오류')));
      return;
    }
    const script = document.createElement('script');
    script.id   = 'kakaoMapScript';
    script.type = 'text/javascript';
    script.src  = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=9a34a1ad6070f6cadb176a077cc450d7&libraries=services&autoload=false';
    script.onload  = () => kakao.maps.load(() => resolve());
    script.onerror = () => reject(new Error('Kakao SDK 스크립트 로드 실패 (도메인 등록·네트워크 확인)'));
    document.head.appendChild(script);
  });
}

// GPS 현재 위치 취득
function _getUserLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => resolve(null),
      { timeout: 6000, maximumAge: 60000 }
    );
  });
}

// 지도 렌더
function _renderKakaoMap(container, lat, lng) {
  _kakaoUserLat = lat;
  _kakaoUserLng = lng;
  const center = new kakao.maps.LatLng(lat, lng);
  kakaoMapInstance = new kakao.maps.Map(container, { center, level: 3 });
  const posMarker = new kakao.maps.Marker({ position: center, map: kakaoMapInstance });
  new kakao.maps.InfoWindow({
    content: '<div style="padding:5px 8px;color:#000;font-size:0.75rem;font-weight:700;white-space:nowrap;">📍 현재 위치</div>'
  }).open(kakaoMapInstance, posMarker);
  window.searchNearbyRestaurants();
}

// 지도 초기화 진입점
async function _initWelfareMap() {
  const container = document.getElementById('kakaoMapContainer');
  if (!container) return;
  if (kakaoMapInstance) { kakaoMapInstance.relayout(); return; }
  if (_kakaoMapLoading)  return;
  _kakaoMapLoading = true;

  container.innerHTML = `
    <div style="text-align:center;color:var(--text-muted);padding:20px;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size:2rem;margin-bottom:10px;color:var(--primary);display:block;"></i>
      <div style="font-size:0.85rem;">📍 위치 확인 중...</div>
    </div>`;

  try {
    await _loadKakaoSDK();
    // 강남역 좌표로 고정
    const lat = 37.4979;
    const lng = 127.0276;
    container.innerHTML = '';
    _renderKakaoMap(container, lat, lng);
    window.showToast?.('📍 강남역 기준', '강남역 주변 맛집을 검색합니다.', 'success');
  } catch (err) {
    console.error('[KakaoMap]', err);
    container.innerHTML = `
      <div style="text-align:center;color:var(--text-muted);padding:20px;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size:2rem;margin-bottom:10px;color:var(--warning);display:block;"></i>
        <div style="font-size:0.9rem;font-weight:700;margin-bottom:6px;">카카오맵 로드 실패</div>
        <div style="font-size:0.78rem;color:var(--text-muted);line-height:1.6;">${err.message}</div>
        <button onclick="kakaoMapInstance=null;_kakaoMapLoading=false;_initWelfareMap();"
          style="margin-top:12px;padding:8px 16px;background:var(--primary);color:white;border:none;border-radius:8px;cursor:pointer;font-size:0.8rem;">
          🔄 다시 시도
        </button>
      </div>`;
  } finally {
    _kakaoMapLoading = false;
  }
}

window.initWelfareMap = _initWelfareMap;

window.searchNearbyRestaurants = function() {
  if (!kakaoMapInstance || !window.kakao?.maps?.services) return;
  const input         = document.getElementById('restaurantSearchInput');
  const keyword       = input?.value.trim() || '맛집';
  const listContainer = document.getElementById('nearbyRestaurantList');

  kakaoMapMarkers.forEach(m => m.setMap(null));
  kakaoMapMarkers = [];

  if (listContainer) listContainer.innerHTML = `
    <div style="text-align:center;color:var(--text-muted);font-size:0.8rem;padding:16px;">
      <i class="fa-solid fa-spinner fa-spin"></i> 검색 중...
    </div>`;

  const ps = new kakao.maps.services.Places();
  ps.keywordSearch(keyword, (data, status) => {
    if (status === kakao.maps.services.Status.OK) {
      const bounds = new kakao.maps.LatLngBounds();
      let html = '';
      data.slice(0, 6).forEach((place, idx) => {
        const coords = new kakao.maps.LatLng(place.y, place.x);
        bounds.extend(coords);
        const marker = new kakao.maps.Marker({ position: coords, map: kakaoMapInstance });
        kakaoMapMarkers.push(marker);
        const iw = new kakao.maps.InfoWindow({
          content: `<div style="padding:5px 8px;color:#000;font-size:0.75rem;font-weight:700;white-space:nowrap;">${place.place_name}</div>`
        });
        kakao.maps.event.addListener(marker, 'click', () => iw.open(kakaoMapInstance, marker));
        const icons = ['🍚', '🍜', '☕', '🍔', '🥗', '🍕'];
        const dist  = place.distance ? ` · 📍${place.distance}m` : '';
        html += `
          <div class="welfare-benefit-card" onclick="window.focusOnMapPlace(${place.y},${place.x},'${place.place_name.replace(/'/g, "\\'") }',this)" style="cursor:pointer;">
            <div class="welfare-benefit-icon">${icons[idx % icons.length]}</div>
            <div class="welfare-benefit-info">
              <div class="welfare-benefit-name">${place.place_name}</div>
              <div class="welfare-benefit-desc">${place.category_group_name || '음식점'} · ${place.road_address_name || place.address_name}${dist}</div>
              ${place.phone ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">📞 ${place.phone}</div>` : ''}
            </div>
            <span class="welfare-benefit-badge" style="background:var(--secondary);color:white;white-space:nowrap;">이동</span>
          </div>`;
      });
      if (listContainer) listContainer.innerHTML = html || '<div style="text-align:center;padding:20px;color:var(--text-muted);">결과 없음</div>';
      kakaoMapInstance.setBounds(bounds);
    } else {
      if (listContainer) listContainer.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.8rem;padding:20px;">검색 결과가 없습니다. 다른 키워드를 입력해보세요.</div>`;
    }
  }, {
    location: new kakao.maps.LatLng(_kakaoUserLat, _kakaoUserLng),
    radius: 1000,
    sort: kakao.maps.services.SortBy.DISTANCE
  });
};

window.focusOnMapPlace = function(y, x, name, cardEl) {
  if (!kakaoMapInstance) return;
  kakaoMapInstance.setCenter(new kakao.maps.LatLng(y, x));
  kakaoMapInstance.setLevel(2);
  document.querySelectorAll('#nearbyRestaurantList .welfare-benefit-card').forEach(c => c.style.border = '');
  if (cardEl) cardEl.style.border = '2px solid var(--secondary)';
  window.showToast?.('📍 맛집 이동', `'${name}' 위치로 이동했습니다.`, 'info');
};



// ═══════════════════════════════════════════════════════════════════════
// 🔄 welfare map 인터셉터 및 보고서 템플릿
// ═══════════════════════════════════════════════════════════════════════

function _initWelfareMapInterceptor() {
  // 이벤트 위임 방식으로 nav-menu 부모에 한 번만 등록 (innerHTML 교체에도 안전)
  const navMenu = document.querySelector('.nav-menu');
  if (navMenu && !navMenu._kakaoInterceptorBound) {
    navMenu._kakaoInterceptorBound = true;
    navMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.nav-item');
      if (item && item.getAttribute('data-tab') === 'welfare') {
        setTimeout(_initWelfareMap, 200);
      }
    });
  }

  // 현재 복지 탭이 활성 상태인 경우 즉시 초기화 시도
  const welfareSection = document.getElementById('welfare');
  if (welfareSection && welfareSection.classList.contains('active')) {
    setTimeout(_initWelfareMap, 300);
  }
}

function _injectReportTemplateButtons() {
  const form = document.getElementById('submitReportBtn')?.parentElement;
  if (!form || document.getElementById('reportTemplateBtns')) return;
  const tplDiv = document.createElement('div');
  tplDiv.id = 'reportTemplateBtns';
  tplDiv.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;';
  tplDiv.innerHTML = `
    <div style="font-size:0.78rem;color:var(--text-muted);width:100%;margin-bottom:4px;font-weight:600;">📋 빠른 템플릿 적용</div>
    <button type="button" class="quick-prompt-btn" onclick="applyReportTemplate('daily')">📅 일일 보고</button>
    <button type="button" class="quick-prompt-btn" onclick="applyReportTemplate('weekly')">📊 주간 보고</button>
    <button type="button" class="quick-prompt-btn" onclick="applyReportTemplate('project')">🚀 프로젝트 보고</button>
    <button type="button" class="quick-prompt-btn" style="background:rgba(99,102,241,0.1);border-color:rgba(99,102,241,0.3);color:var(--primary);" onclick="generateAIReportDraft()"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 초안 작성</button>`;
  const titleInput = document.getElementById('reportTitle');
  if (titleInput) titleInput.parentElement.before(tplDiv);
}

// ═══════════════════════════════════════════════════════════════════════
// 👥 실시간 팀 근무 현황 위젯
// ═══════════════════════════════════════════════════════════════════════
function _initTeamAttendance() {
  // 2분류만: 출근중 / 부재중 (위치추적 없음, 캘린더 휴가 기반)
  const STATUS_COLORS = {
    '출근중': 'var(--success)',
    '부재중': 'var(--danger)',
  };

  function _getEmpStatus(emp) {
    const today = new Date().toISOString().split('T')[0];
    const evt   = AppState.events.find(e =>
      e.employeeId === emp.id &&
      e.start <= today && (e.end || e.start) >= today
    );
    if (!evt || evt.type !== 'leave') return '출근중';
    return '부재중'; // 오늘 휴가/부재 이벤트가 있으면 부재중

  }

  function _renderAttendance() {
    const grid  = document.getElementById('teamAttendanceGrid');
    const ltime = document.getElementById('attendanceLiveTime');
    if (!grid) return;
    const now = new Date();
    if (ltime) ltime.textContent = `🕐 ${now.toTimeString().split(' ')[0]} 기준 (30초마다 갱신)`;
    const emps = AppState.employees || [];
    let inCount = 0, outCount = 0;
    const gradients = [
      'linear-gradient(135deg,var(--primary),var(--secondary))',
      'linear-gradient(135deg,var(--secondary),var(--accent))',
      'linear-gradient(135deg,var(--accent),var(--primary))',
      'linear-gradient(135deg,var(--success),var(--secondary))',
    ];
    grid.innerHTML = emps.map(emp => {
      const status = _getEmpStatus(emp);
      const color  = STATUS_COLORS[status] || STATUS_COLORS['출근중'];
      if (status === '출근중') inCount++; else outCount++;
      return `
        <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;
          background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:12px;
          cursor:pointer;transition:all 0.2s;"
          onmouseover="this.style.background='rgba(255,255,255,0.05)'"
          onmouseout="this.style.background='rgba(255,255,255,0.02)'"
          onclick="window.showMemberDetail(${emp.id})" title="${emp.name} · ${emp.dept}">
          <div style="position:relative;">
            <div style="width:40px;height:40px;border-radius:50%;background:${gradients[emp.id % gradients.length]};
              display:flex;align-items:center;justify-content:center;font-weight:700;color:white;font-size:1rem;">
              ${emp.initial || emp.name[0]}
            </div>
            <span style="position:absolute;bottom:0;right:0;width:12px;height:12px;border-radius:50%;
              background:${color};border:2px solid var(--surface-dark);"></span>
          </div>
          <div style="font-size:0.72rem;font-weight:700;color:var(--text-main);text-align:center;
            max-width:62px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${emp.name}</div>
          <div style="font-size:0.65rem;color:${color};font-weight:600;text-align:center;">${status}</div>
        </div>`;
    }).join('');
    const tot = document.getElementById('attendCountTotal');
    const inn = document.getElementById('attendCountIn');
    const out = document.getElementById('attendCountOut');
    if (tot) tot.textContent = emps.length;
    if (inn) inn.textContent = inCount;
    if (out) out.textContent = outCount;
  }

  _renderAttendance();
  setInterval(_renderAttendance, 30000);
}

// ═══════════════════════════════════════════════════════════════════════
// 🌳 인터랙티브 SVG 조직도 (드래그/줌/클릭)
// ═══════════════════════════════════════════════════════════════════════
function _initSVGOrgChart() {
  const container = document.getElementById('svgOrgChart');
  if (!container || container._orgDone) return;
  container._orgDone = true;

  const emps = AppState.employees || [];
  if (emps.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">직원 데이터가 없습니다.</div>';
    return;
  }

  // 부서별 그룹화
  const deptMap = {};
  emps.forEach(e => { if (!deptMap[e.dept]) deptMap[e.dept] = []; deptMap[e.dept].push(e); });
  const depts = Object.keys(deptMap);
  // Tab-switch fix: clientWidth=0 when hidden, use ResizeObserver
  const W = container.clientWidth || 720;
  if (W < 50 && typeof ResizeObserver !== 'undefined') {
    container._orgDone = false;
    const _ro = new ResizeObserver(entries => {
      for (const e of entries) {
        if (e.contentRect.width > 50) {
          _ro.disconnect();
          container._orgDone = false;
          _initSVGOrgChart();
          break;
        }
      }
    });
    _ro.observe(container);
    return;
  }
  const H = 380;
  const NODE_W = 115, NODE_H = 56;
  const DEPT_COLORS = ['#6366f1','#06b6d4','#a855f7','#10b981','#f59e0b','#ef4444','#ec4899'];

  let scale = 1, panX = 0, panY = 10, dragging = false, startX, startY, lastPanX, lastPanY;

  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width','100%'); svg.setAttribute('height',H);
  svg.style.cssText = 'display:block;user-select:none;';
  container.appendChild(svg);

  const g = document.createElementNS('http://www.w3.org/2000/svg','g');
  svg.appendChild(g);

  function applyTransform() {
    g.setAttribute('transform', `translate(${panX},${panY}) scale(${scale})`);
  }

  // 위치 계산
  const deptXStep = W / (depts.length + 1);
  const positions = {};
  depts.forEach((dept, di) => {
    const dx = deptXStep * (di + 1);
    positions['d' + di] = { x: dx, y: 30, dept, color: DEPT_COLORS[di % DEPT_COLORS.length] };
    deptMap[dept].forEach((emp, ei) => {
      const ex = dx + (ei - (deptMap[dept].length - 1) / 2) * (NODE_W + 12);
      positions['e' + emp.id] = { x: ex, y: 160, emp, color: DEPT_COLORS[di % DEPT_COLORS.length] };
    });
  });

  // 연결선
  depts.forEach((dept, di) => {
    const dp = positions['d' + di];
    deptMap[dept].forEach(emp => {
      const ep = positions['e' + emp.id];
      const line = document.createElementNS('http://www.w3.org/2000/svg','path');
      line.setAttribute('d', `M${dp.x},${dp.y + 28} C${dp.x},${(dp.y + ep.y)/2} ${ep.x},${(dp.y + ep.y)/2} ${ep.x},${ep.y}`);
      line.setAttribute('stroke', dp.color);
      line.setAttribute('stroke-width','1.5');
      line.setAttribute('fill','none');
      line.setAttribute('opacity','0.35');
      g.appendChild(line);
    });
  });

  // 부서 노드
  depts.forEach((dept, di) => {
    const { x, y, color } = positions['d' + di];
    const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    bg.setAttribute('x', x - NODE_W/2); bg.setAttribute('y', y);
    bg.setAttribute('width', NODE_W); bg.setAttribute('height', 28);
    bg.setAttribute('rx', 9); bg.setAttribute('fill', color); bg.setAttribute('opacity','0.2');
    g.appendChild(bg);
    const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.setAttribute('x', x); txt.setAttribute('y', y + 19);
    txt.setAttribute('text-anchor','middle'); txt.setAttribute('fill', color);
    txt.setAttribute('font-size','11'); txt.setAttribute('font-weight','700');
    txt.textContent = dept;
    g.appendChild(txt);
  });

  // 직원 노드
  Object.values(positions).filter(p => p.emp).forEach(p => {
    const { x, y, emp, color } = p;
    // 배경 카드
    const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    bg.setAttribute('x', x - NODE_W/2); bg.setAttribute('y', y);
    bg.setAttribute('width', NODE_W); bg.setAttribute('height', NODE_H);
    bg.setAttribute('rx', 10); bg.setAttribute('fill','rgba(255,255,255,0.04)');
    bg.setAttribute('stroke', color); bg.setAttribute('stroke-width','1.5');
    g.appendChild(bg);
    // 아바타
    const avi = document.createElementNS('http://www.w3.org/2000/svg','circle');
    avi.setAttribute('cx', x - NODE_W/2 + 20); avi.setAttribute('cy', y + NODE_H/2);
    avi.setAttribute('r','14'); avi.setAttribute('fill', color);
    g.appendChild(avi);
    const it = document.createElementNS('http://www.w3.org/2000/svg','text');
    it.setAttribute('x', x - NODE_W/2 + 20); it.setAttribute('y', y + NODE_H/2 + 5);
    it.setAttribute('text-anchor','middle'); it.setAttribute('fill','white');
    it.setAttribute('font-size','11'); it.setAttribute('font-weight','700');
    it.textContent = emp.initial || emp.name[0];
    g.appendChild(it);
    // 이름
    const nt = document.createElementNS('http://www.w3.org/2000/svg','text');
    nt.setAttribute('x', x - NODE_W/2 + 38); nt.setAttribute('y', y + 20);
    nt.setAttribute('fill','#f1f5f9'); nt.setAttribute('font-size','11'); nt.setAttribute('font-weight','700');
    nt.textContent = emp.name;
    g.appendChild(nt);
    // 직급
    const tt = document.createElementNS('http://www.w3.org/2000/svg','text');
    tt.setAttribute('x', x - NODE_W/2 + 38); tt.setAttribute('y', y + 34);
    tt.setAttribute('fill','rgba(200,210,230,0.6)'); tt.setAttribute('font-size','9.5');
    tt.textContent = emp.title;
    g.appendChild(tt);
    // MBTI 배지
    if (emp.mbti) {
      const mb = document.createElementNS('http://www.w3.org/2000/svg','rect');
      mb.setAttribute('x', x - NODE_W/2 + 38); mb.setAttribute('y', y + 39);
      mb.setAttribute('width','32'); mb.setAttribute('height','13');
      mb.setAttribute('rx','4'); mb.setAttribute('fill', color); mb.setAttribute('opacity','0.3');
      g.appendChild(mb);
      const mt = document.createElementNS('http://www.w3.org/2000/svg','text');
      mt.setAttribute('x', x - NODE_W/2 + 54); mt.setAttribute('y', y + 50);
      mt.setAttribute('text-anchor','middle'); mt.setAttribute('fill', color);
      mt.setAttribute('font-size','8'); mt.setAttribute('font-weight','700');
      mt.textContent = emp.mbti;
      g.appendChild(mt);
    }
    // 투명 클릭 레이어
    const cl = document.createElementNS('http://www.w3.org/2000/svg','rect');
    cl.setAttribute('x', x - NODE_W/2); cl.setAttribute('y', y);
    cl.setAttribute('width', NODE_W); cl.setAttribute('height', NODE_H);
    cl.setAttribute('rx', 10); cl.setAttribute('fill','transparent');
    cl.style.cursor = 'pointer';
    cl.addEventListener('click', ev => {
      ev.stopPropagation();
      if (Math.abs(panX - lastPanX) < 4 && Math.abs(panY - lastPanY) < 4) {
        window.showMemberDetail(emp.id);
      }
    });
    g.appendChild(cl);
  });

  // 드래그 팬
  svg.addEventListener('mousedown', e => {
    dragging = true; startX = e.clientX; startY = e.clientY;
    lastPanX = panX; lastPanY = panY;
    svg.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    panX = lastPanX + (e.clientX - startX);
    panY = lastPanY + (e.clientY - startY);
    applyTransform();
  });
  window.addEventListener('mouseup', () => { dragging = false; svg.style.cursor = 'grab'; });

  // 줌 버튼
  document.getElementById('orgZoomIn') ?.addEventListener('click', () => { scale = Math.min(scale + 0.15, 2.5); applyTransform(); });
  document.getElementById('orgZoomOut')?.addEventListener('click', () => { scale = Math.max(scale - 0.15, 0.4); applyTransform(); });
  document.getElementById('orgReset')  ?.addEventListener('click', () => { scale = 1; panX = 0; panY = 10; applyTransform(); });

  // 마우스휠 줌
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    scale = Math.max(0.4, Math.min(2.5, scale + (e.deltaY < 0 ? 0.1 : -0.1)));
    applyTransform();
  }, { passive: false });

  applyTransform();
}

// ═══════════════════════════════════════════════════════════════════════
// 🤖 AI Copilot — 플로팅 채팅 컨텍스트 인식 명령 처리
// ═══════════════════════════════════════════════════════════════════════
function _initAICopilot() {
  const input   = document.getElementById('floatingChatInput');
  const sendBtn = document.getElementById('floatingChatSend');
  const body    = document.getElementById('floatingChatBody');
  if (!input || !sendBtn || !body) return;

  // 빠른 명령 버튼 클릭
  body.addEventListener('click', e => {
    const btn = e.target.closest('.ai-quick-cmd');
    if (!btn) return;
    input.value = btn.getAttribute('data-cmd') || '';
    sendBtn.click();
  });

  function _goTab(tabId) {
    document.querySelector(`.nav-item[data-tab="${tabId}"]`)?.click();
  }

  // 경량 마크다운 변환 (XSS 안전)
  function _md(text) {
    return text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/^#{1,3}\s+(.+)$m/gm,'<div style="font-weight:700;color:var(--secondary);margin:4px 0 2px;">$1</div>')
      .replace(/^[-•]\s+(.+)$/gm,'<div style="padding-left:10px;">• $1</div>')
      .replace(/\n/g,'<br>');
  }

  function _addBubble(text, side = 'received', asHtml = false) {
    const div = document.createElement('div');
    div.className = `chat-bubble bubble-${side}`;
    div.style.cssText = 'margin:6px 0;font-size:0.82rem;line-height:1.6;';
    if (side === 'sent') {
      div.textContent = text;
    } else {
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:0.72rem;color:var(--secondary);display:block;margin-bottom:4px;font-weight:700;';
      lbl.textContent = '🤖 AI Copilot';
      div.appendChild(lbl);
      const content = document.createElement('div');
      // AI 응답은 항상 마크다운 렌더링 적용
      content.innerHTML = _md(text);
      div.appendChild(content);
    }
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }

  async function _processCommand(txt) {
    const t = txt.trim();
    if (!t) return;
    _addBubble(t, 'sent');
    input.value = '';
    sendBtn.disabled = true;

    const loadDiv    = _addBubble('⏳ 처리 중...', 'received');
    const updateLoad = (msg) => { if (loadDiv.lastChild) loadDiv.lastChild.textContent = msg; };

    const lower = t.toLowerCase();
    const user  = AppState.currentUser;
    const today = new Date().toISOString().split('T')[0];

    try {
      // ── 연차/휴가 신청 ───────────────────────────────────────────
      const leaveMatch = lower.match(/(연차|오전반차|오후반차|재택근무|출장|외근|반차|병가)/);
      if (leaveMatch && (lower.includes('신청') || lower.includes('써줘') || lower.includes('등록') || lower.includes('쓸래'))) {
        const type = leaveMatch[1];
        let start  = today;
        const dateRx = t.match(/(\d{4}-\d{2}-\d{2})/);
        if (lower.includes('내일'))      { const d = new Date(); d.setDate(d.getDate()+1); start = d.toISOString().split('T')[0]; }
        else if (lower.includes('모레')) { const d = new Date(); d.setDate(d.getDate()+2); start = d.toISOString().split('T')[0]; }
        else if (dateRx)                 { start = dateRx[1]; }
        // 즉시 등록 대신 확인 UI 표시
        if (loadDiv.lastChild) {
          loadDiv.lastChild.innerHTML =
            '\uD83D\uDCCB <strong>[' + type + '] \uc2e0\uccad \ud655\uc778</strong><br><br>' +
            '\u2022 \uc77c\uc815: <strong>' + start + '</strong><br>' +
            '\u2022 \uc885\ub958: <strong>' + type + '</strong><br><br>\ub4f1\ub85d\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?';
        }
        const _cf = document.createElement('div');
        _cf.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
        const _ok = document.createElement('button');
        _ok.textContent = '\u2705 \ub4f1\ub85d';
        _ok.style.cssText = 'background:var(--success);color:white;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:700;';
        const _no = document.createElement('button');
        _no.textContent = '\u274c \ucde8\uc18c';
        _no.style.cssText = 'background:rgba(239,68,68,0.12);color:var(--danger);border:1px solid rgba(239,68,68,0.35);padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.8rem;';
        _ok.onclick = async () => {
          _cf.remove();
          if (loadDiv.lastChild) loadDiv.lastChild.innerHTML = '\u23F3 \ub4f1\ub85d \uc911...';
          _goTab('calendar');
          await CalendarModule.applyLeave(start, start, type, 'AI Copilot \uc2e0\uccad');
          if (loadDiv.lastChild) loadDiv.lastChild.innerHTML = '\u2705 [' + type + '] ' + start + ' \ub4f1\ub85d \uc644\ub8cc! \uce98\ub9b0\ub354\uc5d0\uc11c \ud655\uc778\ud558\uc138\uc694.';
          if (window.updateUIForCurrentUser) window.updateUIForCurrentUser();
        };
        _no.onclick = () => { _cf.remove(); if (loadDiv.lastChild) loadDiv.lastChild.innerHTML = '\ucde8\uc18c\ud588\uc2b5\ub2c8\ub2e4.'; };
        _cf.appendChild(_ok); _cf.appendChild(_no);
        loadDiv.appendChild(_cf);
        sendBtn.disabled = false;
        return;
      }

      // ── 업무 보고서 초안 ──────────────────────────────────────────
      const _isReportCmd = (lower.includes('보고서') || lower.includes('업무보고')) &&
                             (lower.includes('써') || lower.includes('작성') || lower.includes('초안') || lower.includes('만들'));
      if (_isReportCmd) {
        _goTab('reports');
        const type = lower.includes('주간') ? 'weekly' : lower.includes('프로젝트') ? 'project' : 'daily';
        window.applyReportTemplate(type);
        setTimeout(() => window.generateAIReportDraft?.(), 600);
        updateLoad(`📝 업무보고 탭에서 ${type === 'weekly' ? '주간' : type === 'project' ? '프로젝트' : '일일'} 보고서 AI 초안을 작성 중입니다...`);
        return;
      }

      // ── 직원 정보 조회 ──────────────────────────────────────────
      const empHit = AppState.employees.find(e => t.includes(e.name));
      if (empHit && (lower.includes('알려') || lower.includes('정보') || lower.includes('성향') || lower.includes('mbti'))) {
        updateLoad(
          `👤 ${empHit.name} (${empHit.dept} · ${empHit.title})\n` +
          `📧 ${empHit.email}\n📱 ${empHit.phone}\n` +
          `🧠 MBTI: ${empHit.mbti || 'N/A'} · ${empHit.workStyle || 'N/A'}\n` +
          `📅 입사일: ${empHit.joinDate}`
        );
        return;
      }

      // ── 조직도 이동 ──────────────────────────────────────────────
      if (lower.includes('조직도') || lower.includes('직원 목록') || lower.includes('팀 구성')) {
        _goTab('directory');
        updateLoad('🌳 조직도 탭으로 이동했습니다. SVG 조직도에서 직원 카드를 클릭하면 프로필을 볼 수 있어요!');
        return;
      }

      // ── Gemini AI 일반 답변 ──────────────────────────────────────
      const prompt = `당신은 OneOffice 사내 AI 비서입니다. 현재 로그인 사용자: ${
        user ? `${user.name} (${user.dept} · ${user.title})` : '알 수 없음'}.\n질문: ${t}`;
      const aiText = await MockAPI.generateWithAI(prompt);
      updateLoad(aiText || '답변을 가져오지 못했습니다.');

    } catch (err) {
      updateLoad('처리 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener('click', () => _processCommand(input.value));
  input.addEventListener('keypress', e => { if (e.key === 'Enter') _processCommand(input.value); });
}
