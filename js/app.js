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

  // 남은 연차 (상태 메시지에서 숫자 파싱)
  const leaveMatch = (user.status || '').match(/\d+(\.\d+)?/);
  const leaveDays  = leaveMatch ? leaveMatch[0] : '15';
  setEl('statLeaveDays', leaveDays + '일');

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

  // ── 2. AuthModule 초기화 (로그인 UI + 세션 복원) ──────────────────
  AuthModule.init();

  const restored = AuthModule.restoreSession();
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
      AppState.activeChatTarget = String(emp.id);
      document.querySelector('.nav-item[data-tab="messenger"]')?.click();
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
  const profileBtn  = document.getElementById('userProfileBtn');
  const profileModal= document.getElementById('profileModal');
  if (profileBtn && profileModal) {
    profileBtn.addEventListener('click', () => profileModal.classList.add('active'));
  }
  const form = document.getElementById('profileEditForm');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!AppState.currentUser) return;
      AppState.currentUser.name      = document.getElementById('profileNameInput')?.value   || AppState.currentUser.name;
      AppState.currentUser.status    = document.getElementById('profileStatusInput')?.value || AppState.currentUser.status;
      AppState.currentUser.mbti      = document.getElementById('profileMBTIInput')?.value   || '';
      AppState.currentUser.workStyle = document.getElementById('profileStyleInput')?.value  || '';
      AppState.currentUser.email     = document.getElementById('profileEmailInput')?.value  || AppState.currentUser.email;
      AppState.currentUser.phone     = document.getElementById('profilePhoneInput')?.value  || AppState.currentUser.phone;

      // CloudDB에 업데이트
      const idx = AppState.employees.findIndex(e => e.id === AppState.currentUser.id);
      if (idx !== -1) AppState.employees[idx] = { ...AppState.employees[idx], ...AppState.currentUser };
      CloudDB.set('employees', AppState.employees);
      localStorage.setItem('ex_logged_user', JSON.stringify(AppState.currentUser));

      profileModal?.classList.remove('active');
      _updateUIForCurrentUser();
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

// AI 오피스 탭 스위칭
function _initAIOffice() {
  document.querySelectorAll('#aioffice .ai-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#aioffice .ai-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ai-sub-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.getAttribute('data-aitab'));
      if (target) target.classList.add('active');
    });
  });
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

/** 내 일정 목록 렌더링 */
function _renderMyEventsList() {
  const list = document.getElementById('myEventsList');
  if (!list) return;
  const userId = AppState.currentUser?.id;
  const myEvts = AppState.events.filter(e => e.employeeId === userId).slice(-5).reverse();
  if (myEvts.length === 0) {
    list.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);text-align:center;padding:10px;">등록된 일정이 없습니다.</div>`;
    return;
  }
  list.innerHTML = myEvts.map(evt => {
    const typeLabel = evt.title?.match(/\[(.+)\]/)?.[1] || '일정';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:8px;font-size:0.8rem;cursor:pointer;"
         onclick="window.openEventEdit('${evt.id}')">
      <div>
        <span style="background:${evt.color||'var(--primary)'};color:white;padding:2px 6px;border-radius:4px;font-size:0.7rem;font-weight:700;">${typeLabel}</span>
        <span style="margin-left:6px;color:var(--text-muted);">${evt.start}${evt.end && evt.end !== evt.start ? ' ~ ' + evt.end : ''}</span>
      </div>
      <i class="fa-solid fa-pen" style="color:var(--text-muted);font-size:0.75rem;"></i>
    </div>`;
  }).join('');
}

/** 이벤트 수정 모달 열기 */
window.openEventEdit = function(eventId) {
  const evt = AppState.events.find(e => e.id === eventId);
  if (!evt) return;
  const typeLabel = evt.title?.match(/\[(.+)\]/)?.[1] || '기타';
  document.getElementById('editEventId').value     = evt.id;
  document.getElementById('editLeaveType').value   = typeLabel;
  document.getElementById('editLeaveStart').value  = evt.start;
  document.getElementById('editLeaveEnd').value    = evt.end || evt.start;
  document.getElementById('editLeaveReason').value = evt.reason || '';
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
  document.getElementById('dmPanelAvatar').textContent = empName[0];
  document.getElementById('dmPanelName').textContent   = empName;

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

// 조직도 구성원 "메시지 보내기" 버튼 패치
const _origShowMemberDetail = window.showMemberDetail;
window.showMemberDetail = function(empId) {
  _origShowMemberDetail(empId);
  const emp = AppState.employees.find(e => e.id === empId);
  if (!emp) return;
  const chatBtn = document.getElementById('detailModalChatBtn');
  if (chatBtn) {
    const newBtn = chatBtn.cloneNode(true);
    chatBtn.parentNode.replaceChild(newBtn, chatBtn);
    newBtn.addEventListener('click', () => {
      document.getElementById('memberDetailModal')?.classList.remove('active');
      window.openDMPanel(emp.id, emp.name);
    });
  }
};

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
// 🔄 _initAllFeatures 확장 — 새 기능 추가 init
// ═══════════════════════════════════════════════════════════════════════
const _origInitAllFeatures = _initAllFeatures;
// 기존 _initAllFeatures에 새 기능 추가
const _patchedInit = function() {
  _initCalendarEditFeatures();
  _initFloatingMessengerBubble();
  // 업무보고 탭에 템플릿 버튼 삽입
  _injectReportTemplateButtons();
  _renderMyEventsList();
};

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

// DOMContentLoaded 후 패치 실행을 위해 AuthModule.on('login') 이후에 추가 실행
document.addEventListener('DOMContentLoaded', () => {
  // login 이벤트 후 추가 기능 초기화
  const _origLoginCb = AuthModule._loginCallbacks || [];
  AuthModule.on?.('login', () => setTimeout(_patchedInit, 500));
  // 세션 복원 후에도 실행
  setTimeout(() => {
    if (AppState.currentUser) _patchedInit();
  }, 1000);
});
