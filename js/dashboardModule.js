/**
 * dashboardModule.js
 * 다우오피스 스타일 대시보드 관리 시스템
 * - 다중 대시보드 탭
 * - 편집 모드 (⚙️)
 * - 가젯 추가/삭제/드래그&드롭
 * - 4가지 레이아웃
 * - 가젯별 설정
 */

window.DashboardModule = (function () {

  // =====================================================
  // 가젯 라이브러리 정의 (다우오피스 27종 + 독점 기능)
  // =====================================================
  const GADGET_LIBRARY = [
    {
      id: 'approval', category: '업무',
      name: '결재 대기함', icon: 'fa-file-circle-check', iconColor: '#d97706',
      desc: '미결 결재 문서 목록 및 진행 상태',
      defaultWidth: 1
    },
    {
      id: 'calendar', category: '업무',
      name: '일정·캘린더', icon: 'fa-calendar-days', iconColor: '#3b5bdb',
      desc: '미니 캘린더와 오늘의 일정 목록',
      defaultWidth: 1
    },
    {
      id: 'attendance', category: '근태',
      name: '팀 근무 현황', icon: 'fa-circle-dot', iconColor: '#059669',
      desc: '실시간 팀원 출퇴근 현황',
      defaultWidth: 1
    },
    {
      id: 'notice', category: '소통',
      name: '공지사항', icon: 'fa-bullhorn', iconColor: '#7c3aed',
      desc: '전사·부서별 최신 공지사항',
      defaultWidth: 1
    },
    {
      id: 'leave', category: '근태',
      name: '내 연차·휴가', icon: 'fa-umbrella-beach', iconColor: '#0ea5e9',
      desc: '잔여 연차, 사용 내역, 유형별 현황',
      defaultWidth: 1
    },
    {
      id: 'feed', category: '소통',
      name: '사내 소식 피드', icon: 'fa-rss', iconColor: '#d97706',
      desc: '실시간 사내 뉴스와 동호회 소식',
      defaultWidth: 1
    },
    {
      id: 'today-profile', category: '개인',
      name: '투데이 프로필', icon: 'fa-id-card', iconColor: '#3b5bdb',
      desc: '내 프로필 + 오늘 메일·일정·결재 요약',
      defaultWidth: 1
    },
    {
      id: 'quickmenu', category: '개인',
      name: '퀵 메뉴', icon: 'fa-bolt', iconColor: '#f59e0b',
      desc: '주요 기능 빠른 실행 바로가기 모음',
      defaultWidth: 1
    },
    {
      id: 'notifications', category: '개인',
      name: '최근 알림', icon: 'fa-bell', iconColor: '#dc2626',
      desc: '메일·게시판·캘린더 알림 목록',
      defaultWidth: 1
    },
    {
      id: 'birthday', category: '소통',
      name: '이달의 생일', icon: 'fa-cake-candles', iconColor: '#ec4899',
      desc: '이번달 임직원 생일 목록',
      defaultWidth: 1
    },
    {
      id: 'todo', category: '업무',
      name: 'ToDO+', icon: 'fa-list-check', iconColor: '#059669',
      desc: '할 일 목록 카드 형태로 관리',
      defaultWidth: 1
    },
    {
      id: 'hr-news', category: '인사',
      name: '인사 소식', icon: 'fa-user-tie', iconColor: '#6366f1',
      desc: '인사발령·승진·신규입사 공고',
      defaultWidth: 1
    },
    {
      id: 'welfare', category: '복지',
      name: '복지포인트', icon: 'fa-gift', iconColor: '#d97706',
      desc: '잔여 복지포인트 및 신청 현황',
      defaultWidth: 1
    },
    {
      id: 'lunch', category: '복지',
      name: '오늘의 점심', icon: 'fa-utensils', iconColor: '#059669',
      desc: '구내식당 메뉴 및 점심 투표',
      defaultWidth: 1
    },
    {
      id: 'expense', category: '업무',
      name: '내 경비 관리', icon: 'fa-receipt', iconColor: '#0ea5e9',
      desc: '월별 법인카드·영수증 내역',
      defaultWidth: 1
    },
    {
      id: 'login-log', category: '보안',
      name: '최근 로그인 기록', icon: 'fa-shield-halved', iconColor: '#7c3aed',
      desc: '최근 로그인 시간·장소·디바이스',
      defaultWidth: 1
    },
    {
      id: 'report-todo', category: '업무',
      name: '작성할 보고', icon: 'fa-file-pen', iconColor: '#d97706',
      desc: '작성 대기 중인 업무 보고 목록',
      defaultWidth: 1
    },
    {
      id: 'html-editor', category: '커스텀',
      name: 'HTML 편집기', icon: 'fa-code', iconColor: '#475569',
      desc: 'HTML로 자유롭게 콘텐츠 작성',
      defaultWidth: 2
    },
    {
      id: 'ai-summary', category: 'AI',
      name: 'AI 업무 요약', icon: 'fa-wand-magic-sparkles', iconColor: '#3b5bdb',
      desc: 'AI가 오늘의 업무·이슈를 자동 요약',
      defaultWidth: 2
    },
  ];

  // 레이아웃 옵션 (다우오피스 4종)
  const LAYOUTS = [
    { id: '3col', name: '3열', icon: '⊞', cols: 3 },
    { id: '2col', name: '2열', icon: '▪▪', cols: 2 },
    { id: '1-2col', name: '1+2열', icon: '▪▪▪', cols: '1-2' },
    { id: '1col', name: '1열', icon: '▪', cols: 1 },
  ];

  // 상태
  let state = {
    dashboards: [
      {
        id: 'main',
        name: '메인 대시보드',
        layout: '3col',
        gadgets: ['approval', 'calendar', 'attendance', 'notice', 'leave', 'feed']
      }
    ],
    activeDashId: 'main',
    editMode: false,
    dragSrcIndex: null,
  };

  // localStorage에서 복원
  function loadState() {
    try {
      const saved = localStorage.getItem('oo_dashboards');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.dashboards && parsed.dashboards.length > 0) {
          state.dashboards = parsed.dashboards;
          state.activeDashId = parsed.activeDashId || parsed.dashboards[0].id;
        }
      }
    } catch (e) { /* ignore */ }
  }

  function saveState() {
    localStorage.setItem('oo_dashboards', JSON.stringify({
      dashboards: state.dashboards,
      activeDashId: state.activeDashId,
    }));
  }

  function getActiveDash() {
    return state.dashboards.find(d => d.id === state.activeDashId) || state.dashboards[0];
  }

  // =====================================================
  // DOM 빌더 헬퍼
  // =====================================================
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // =====================================================
  // 대시보드 관리 바 렌더링
  // =====================================================
  function renderManagerBar() {
    let bar = document.getElementById('dashManagerBar');
    if (!bar) {
      bar = el('div', 'dash-manager-bar');
      bar.id = 'dashManagerBar';
      // dashboard 섹션 바로 앞에 삽입
      const dashSection = document.getElementById('dashboard');
      if (dashSection) dashSection.parentNode.insertBefore(bar, dashSection);
    }

    bar.innerHTML = '';

    // 탭들
    const tabsWrap = el('div', 'dash-tabs-wrap');
    state.dashboards.forEach(dash => {
      const tab = el('button', 'dash-tab' + (dash.id === state.activeDashId ? ' active' : ''));
      tab.dataset.dashId = dash.id;

      if (state.editMode && dash.id === state.activeDashId) {
        // 편집모드: 이름 인라인 수정
        const input = document.createElement('input');
        input.type = 'text';
        input.value = dash.name;
        input.className = 'dash-tab-name-input';
        input.addEventListener('change', (e) => {
          dash.name = e.target.value.trim() || dash.name;
          saveState();
          renderManagerBar();
        });
        tab.appendChild(input);
      } else {
        tab.textContent = dash.name;
        tab.addEventListener('click', () => {
          state.activeDashId = dash.id;
          state.editMode = false;
          saveState();
          render();
        });
      }
      tabsWrap.appendChild(tab);
    });

    // ➕ 추가 버튼
    const addBtn = el('button', 'dash-tab-add', '<i class="fa-solid fa-plus"></i>');
    addBtn.title = '새 대시보드 추가';
    addBtn.addEventListener('click', addDashboard);
    tabsWrap.appendChild(addBtn);

    bar.appendChild(tabsWrap);

    // 우측 액션 버튼들
    const actions = el('div', 'dash-actions');

    if (state.editMode) {
      // 레이아웃 선택
      const layoutWrap = el('div', 'layout-picker');
      const dash = getActiveDash();
      LAYOUTS.forEach(lay => {
        const btn = el('button', 'layout-btn' + (dash.layout === lay.id ? ' active' : ''), lay.icon);
        btn.title = lay.name + ' 레이아웃';
        btn.addEventListener('click', () => {
          dash.layout = lay.id;
          saveState();
          render();
        });
        layoutWrap.appendChild(btn);
      });
      actions.appendChild(layoutWrap);

      // 편집 완료
      const doneBtn = el('button', 'btn-edit-done', '<i class="fa-solid fa-check"></i> 편집 완료');
      doneBtn.addEventListener('click', () => {
        state.editMode = false;
        saveState();
        render();
      });
      actions.appendChild(doneBtn);

      // 대시보드 삭제
      if (state.dashboards.length > 1) {
        const delBtn = el('button', 'btn-dash-delete', '<i class="fa-solid fa-trash"></i> 삭제');
        delBtn.addEventListener('click', deleteDashboard);
        actions.appendChild(delBtn);
      }
    } else {
      // 편집 모드 진입 버튼
      const editBtn = el('button', 'btn-edit-mode', '<i class="fa-solid fa-gear"></i> 편집');
      editBtn.addEventListener('click', () => {
        state.editMode = true;
        render();
      });
      actions.appendChild(editBtn);
    }

    bar.appendChild(actions);
  }

  // =====================================================
  // 가젯 선택 패널 (편집 모드에서 보임)
  // =====================================================
  function renderGadgetPicker() {
    let picker = document.getElementById('gadgetPickerPanel');
    if (!picker) {
      picker = el('div', 'gadget-picker-panel');
      picker.id = 'gadgetPickerPanel';
      const dashSection = document.getElementById('dashboard');
      if (dashSection) dashSection.parentNode.insertBefore(picker, dashSection.nextSibling || dashSection);
    }

    if (!state.editMode) {
      picker.style.display = 'none';
      return;
    }

    picker.style.display = 'block';
    picker.innerHTML = '<div class="picker-title"><i class="fa-solid fa-puzzle-piece"></i> 가젯 추가 — 원하는 가젯을 클릭하세요</div>';

    const categories = [...new Set(GADGET_LIBRARY.map(g => g.category))];
    const dash = getActiveDash();

    categories.forEach(cat => {
      const catDiv = el('div', 'picker-category');
      const catLabel = el('div', 'picker-cat-label', cat);
      catDiv.appendChild(catLabel);

      const gadgetsRow = el('div', 'picker-gadgets-row');
      GADGET_LIBRARY.filter(g => g.category === cat).forEach(g => {
        const isAdded = dash.gadgets.includes(g.id);
        const item = el('div', 'picker-gadget-item' + (isAdded ? ' added' : ''));
        item.innerHTML = `
          <div class="picker-gadget-icon" style="color:${g.iconColor}">
            <i class="fa-solid ${g.icon}"></i>
          </div>
          <div class="picker-gadget-name">${g.name}</div>
          ${isAdded ? '<div class="picker-gadget-check"><i class="fa-solid fa-check"></i></div>' : ''}
        `;
        item.title = g.desc;
        if (!isAdded) {
          item.addEventListener('click', () => {
            dash.gadgets.push(g.id);
            saveState();
            render();
          });
        } else {
          item.style.cursor = 'default';
        }
        gadgetsRow.appendChild(item);
      });
      catDiv.appendChild(gadgetsRow);
      picker.appendChild(catDiv);
    });
  }

  // =====================================================
  // 가젯 그리드 렌더링
  // =====================================================
  function renderGadgetGrid() {
    const dashSection = document.getElementById('dashboard');
    if (!dashSection) return;

    // 기존 가젯 그리드 제거 후 재생성
    let grid = document.getElementById('dynamicGadgetGrid');
    if (!grid) {
      grid = el('div', '');
      grid.id = 'dynamicGadgetGrid';
      dashSection.insertBefore(grid, dashSection.querySelector('.welfare-mini-grid') || null);
    }

    const dash = getActiveDash();

    // 레이아웃 클래스 결정
    const layoutMap = {
      '3col': 'gadget-grid gadget-grid-3',
      '2col': 'gadget-grid gadget-grid-2',
      '1-2col': 'gadget-grid gadget-grid-1-2',
      '1col': 'gadget-grid gadget-grid-1',
    };
    grid.className = layoutMap[dash.layout] || 'gadget-grid gadget-grid-3';

    grid.innerHTML = '';

    if (dash.gadgets.length === 0) {
      grid.innerHTML = `
        <div class="gadget-empty-state" style="grid-column:1/-1">
          <i class="fa-solid fa-puzzle-piece" style="font-size:2.5rem; color:var(--border-color); margin-bottom:12px;"></i>
          <div style="font-size:0.92rem; color:var(--text-muted); font-weight:600;">가젯이 없습니다</div>
          <div style="font-size:0.8rem; color:var(--text-dark); margin-top:4px;">⚙️ 편집 버튼을 눌러 원하는 가젯을 추가하세요</div>
        </div>`;
      return;
    }

    dash.gadgets.forEach((gadgetId, idx) => {
      const gadgetDef = GADGET_LIBRARY.find(g => g.id === gadgetId);
      if (!gadgetDef) return;

      const gadgetEl = buildGadgetElement(gadgetDef, idx, dash);
      grid.appendChild(gadgetEl);
    });

    // 편집 모드: 드래그&드롭 활성화
    if (state.editMode) {
      setupDragDrop(grid, dash);
    }
  }

  // =====================================================
  // 개별 가젯 빌더
  // =====================================================
  function buildGadgetElement(def, idx, dash) {
    const wrapper = el('div', 'gadget' + (state.editMode ? ' gadget-edit-mode' : ''));
    wrapper.dataset.gadgetId = def.id;
    wrapper.dataset.idx = idx;
    if (state.editMode) {
      wrapper.setAttribute('draggable', 'true');
    }

    // 헤더
    const header = el('div', 'gadget-header');
    const title = el('div', 'gadget-title');
    title.innerHTML = `<i class="fa-solid ${def.icon}" style="color:${def.iconColor}"></i> ${def.name}`;

    const actions = el('div', 'gadget-actions');

    if (state.editMode) {
      // 드래그 핸들
      const dragHandle = el('button', 'gadget-action-btn gadget-drag-handle', '<i class="fa-solid fa-grip-vertical"></i>');
      dragHandle.title = '드래그하여 위치 변경';
      actions.appendChild(dragHandle);

      // 설정 버튼
      const settingBtn = el('button', 'gadget-action-btn', '<i class="fa-solid fa-gear"></i>');
      settingBtn.title = '가젯 설정';
      settingBtn.addEventListener('click', (e) => { e.stopPropagation(); openGadgetSettings(def, idx); });
      actions.appendChild(settingBtn);

      // 삭제 버튼
      const delBtn = el('button', 'gadget-action-btn gadget-delete-btn', '<i class="fa-solid fa-trash"></i>');
      delBtn.title = '가젯 삭제';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dash.gadgets.splice(idx, 1);
        saveState();
        render();
      });
      actions.appendChild(delBtn);
    } else {
      // 일반 모드: 링크 버튼 (탭 이동)
      if (def.id === 'approval') {
        const link = el('button', 'gadget-action-btn', '<i class="fa-solid fa-arrow-up-right-from-square"></i>');
        link.setAttribute('data-tab', 'approval');
        link.title = '결재함 열기';
        actions.appendChild(link);
      } else if (def.id === 'calendar') {
        const link = el('button', 'gadget-action-btn', '<i class="fa-solid fa-arrow-up-right-from-square"></i>');
        link.setAttribute('data-tab', 'calendar');
        link.title = '캘린더 열기';
        actions.appendChild(link);
      } else if (def.id === 'leave') {
        const link = el('button', 'gadget-action-btn', '<i class="fa-solid fa-plus"></i>');
        link.setAttribute('data-tab', 'calendar');
        link.title = '연차 신청';
        actions.appendChild(link);
      }
    }

    header.appendChild(title);
    header.appendChild(actions);
    wrapper.appendChild(header);

    // 바디
    const body = el('div', 'gadget-body');
    body.innerHTML = buildGadgetBody(def.id);
    wrapper.appendChild(body);

    // 푸터
    const footer = buildGadgetFooter(def.id);
    if (footer) wrapper.appendChild(footer);

    return wrapper;
  }

  // =====================================================
  // 가젯 바디 컨텐츠 빌더
  // =====================================================
  function buildGadgetBody(id) {
    switch (id) {
      case 'approval':
        return `
          <div class="approval-gadget-item"><div class="approval-doc-icon icon-blue"><i class="fa-solid fa-file-alt"></i></div><div><div class="approval-doc-title">2026년 7월 출장 신청서</div><div class="approval-doc-meta">홍길동 대리 · 07/05 제출</div></div><span class="approval-status-badge status-pending">검토 대기</span></div>
          <div class="approval-gadget-item"><div class="approval-doc-icon icon-green"><i class="fa-solid fa-umbrella-beach"></i></div><div><div class="approval-doc-title">연차 사용 신청 (7/14~7/15)</div><div class="approval-doc-meta">김태희 사원 · 07/04 제출</div></div><span class="approval-status-badge status-review">승인 중</span></div>
          <div class="approval-gadget-item"><div class="approval-doc-icon icon-purple"><i class="fa-solid fa-cart-shopping"></i></div><div><div class="approval-doc-title">사무용품 구매 요청서</div><div class="approval-doc-meta">이민정 과장 · 07/03 제출</div></div><span class="approval-status-badge status-pending">검토 대기</span></div>
          <div class="approval-gadget-item"><div class="approval-doc-icon icon-cyan"><i class="fa-solid fa-receipt"></i></div><div><div class="approval-doc-title">법인카드 사용 내역 보고</div><div class="approval-doc-meta">박지수 대리 · 07/02 제출</div></div><span class="approval-status-badge status-pending">검토 대기</span></div>`;

      case 'calendar':
        return `
          <div class="mini-cal-header"><span class="mini-cal-month" id="miniCalMonthLabel">${_getMonthLabel()}</span><div style="display:flex;gap:4px;"><button class="gadget-action-btn" id="miniCalPrev"><i class="fa-solid fa-chevron-left"></i></button><button class="gadget-action-btn" id="miniCalNext"><i class="fa-solid fa-chevron-right"></i></button></div></div>
          <div class="mini-cal-grid" id="miniCalGrid"></div>
          <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">오늘 일정</div>
          <div class="today-schedule"><div class="schedule-item"><span class="schedule-time">14:00</span><span class="schedule-title-text">개발팀 주간 회의</span></div><div class="schedule-item" style="border-left-color:var(--success);"><span class="schedule-time" style="color:var(--success);">16:30</span><span class="schedule-title-text">고객사 화상 미팅</span></div></div>`;

      case 'attendance':
        return `<div id="teamAttendGadget"><div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;"><i class="fa-solid fa-spinner fa-spin"></i> 근무 현황 로딩 중...</div></div>`;

      case 'notice':
        return `
          <div class="notice-gadget-item"><span class="notice-category notice-cat-all">전사</span><div><div class="notice-title">2026 하반기 워크숍 안내 (7/25~26 제주)</div><div class="notice-date">2026.07.04</div></div></div>
          <div class="notice-gadget-item"><span class="notice-category notice-cat-hr">인사</span><div><div class="notice-title">7월 급여 지급 예정일 변경 안내</div><div class="notice-date">2026.07.03</div></div></div>
          <div class="notice-gadget-item"><span class="notice-category notice-cat-it">IT</span><div><div class="notice-title">보안 패치 적용 안내 (7/7 새벽 2~4시)</div><div class="notice-date">2026.07.02</div></div></div>
          <div class="notice-gadget-item"><span class="notice-category notice-cat-gen">일반</span><div><div class="notice-title">사내 구내식당 7월 주간 메뉴 게시</div><div class="notice-date">2026.06.30</div></div></div>`;

      case 'leave':
        return `
          <div class="leave-gadget-summary">
            <div class="leave-summary-box"><div class="leave-summary-val" style="color:var(--primary);">18</div><div class="leave-summary-label">총 연차</div></div>
            <div class="leave-summary-box"><div class="leave-summary-val" style="color:var(--success);">15</div><div class="leave-summary-label">잔여 연차</div></div>
            <div class="leave-summary-box"><div class="leave-summary-val" style="color:var(--warning);">3</div><div class="leave-summary-label">사용 연차</div></div>
          </div>
          <div class="leave-bar-container">
            <div class="leave-bar-row"><span class="leave-bar-label">연차</span><div class="leave-bar-track"><div class="leave-bar-fill" style="width:83%;background:var(--primary);"></div></div><span class="leave-bar-val">15일</span></div>
            <div class="leave-bar-row"><span class="leave-bar-label">반차</span><div class="leave-bar-track"><div class="leave-bar-fill" style="width:100%;background:var(--success);"></div></div><span class="leave-bar-val">2일</span></div>
          </div>
          <div style="margin-top:10px;padding:8px;background:rgba(59,91,219,0.04);border-radius:8px;border:1px solid rgba(59,91,219,0.1);font-size:0.75rem;color:var(--text-muted);">
            <div style="color:var(--primary);font-weight:600;margin-bottom:3px;"><i class="fa-solid fa-clock-rotate-left"></i> 최근 사용</div>
            <div>06/20 (금) · 연차 1일</div><div>06/04 (수) · 반차 오전</div>
          </div>`;

      case 'feed':
        return `<div class="feed-list" id="dashboardFeedList" style="max-height:200px;"></div>`;

      case 'today-profile': {
        const user = window.AppState?.currentUser;
        const name = user?.name || '홍길동';
        const dept = user?.department || '개발팀';
        const rank = user?.rank || '대리';
        const initials = name.charAt(0);
        return `
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
            <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--secondary));display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:700;color:white;flex-shrink:0;">${initials}</div>
            <div>
              <div style="font-size:1rem;font-weight:700;color:var(--text-main);">${name}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">${dept} · ${rank}</div>
              <div class="sidebar-status-badge" style="margin-top:4px;"><div class="sidebar-status-dot"></div><span>업무 중</span></div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
            ${[
              { icon:'fa-envelope', label:'받은 메일', val:'6', color:'var(--primary)' },
              { icon:'fa-calendar-check', label:'오늘 일정', val:'2', color:'var(--success)' },
              { icon:'fa-file-circle-check', label:'결재 대기', val:'3', color:'var(--warning)' },
              { icon:'fa-plane', label:'잔여 연차', val:'15', color:'var(--secondary)' },
            ].map(item => `
              <div style="text-align:center;padding:10px 6px;border-radius:9px;border:1px solid var(--border-color);background:#f8fafc;cursor:pointer;transition:all 0.18s;" onmouseover="this.style.background='var(--primary-light)'" onmouseout="this.style.background='#f8fafc'">
                <div style="font-size:1.2rem;color:${item.color};margin-bottom:4px;"><i class="fa-solid ${item.icon}"></i></div>
                <div style="font-size:1.1rem;font-weight:700;color:var(--text-main);">${item.val}</div>
                <div style="font-size:0.62rem;color:var(--text-muted);">${item.label}</div>
              </div>`).join('')}
          </div>`;
      }

      case 'quickmenu':
        return `
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
            ${[
              { icon:'fa-pen-to-square', label:'보고 작성', tab:'reports', color:'#3b5bdb' },
              { icon:'fa-file-circle-check', label:'결재 진행', tab:'approval', color:'#d97706' },
              { icon:'fa-calendar-plus', label:'일정 등록', tab:'calendar', color:'#059669' },
              { icon:'fa-comment-dots', label:'메신저', tab:'messenger', color:'#0ea5e9' },
              { icon:'fa-wallet', label:'급여 조회', tab:'payroll', color:'#7c3aed' },
              { icon:'fa-gift', label:'복지 신청', tab:'welfare', color:'#ec4899' },
              { icon:'fa-receipt', label:'경비 등록', tab:'expense', color:'#f59e0b' },
              { icon:'fa-wand-magic-sparkles', label:'AI 도구', tab:'aioffice', color:'#6366f1' },
            ].map(item => `
              <div class="quickmenu-item" data-tab="${item.tab}" style="text-align:center;padding:12px 6px;border-radius:10px;border:1px solid var(--border-color);cursor:pointer;transition:all 0.18s;background:#f8fafc;" onmouseover="this.style.background='var(--primary-light)';this.style.borderColor='rgba(59,91,219,0.25)'" onmouseout="this.style.background='#f8fafc';this.style.borderColor='var(--border-color)'">
                <div style="font-size:1.3rem;color:${item.color};margin-bottom:5px;"><i class="fa-solid ${item.icon}"></i></div>
                <div style="font-size:0.7rem;color:var(--text-main);font-weight:600;">${item.label}</div>
              </div>`).join('')}
          </div>`;

      case 'notifications':
        return `
          <div class="notice-gadget-item"><span class="notice-category notice-cat-all" style="background:rgba(220,38,38,0.08);color:var(--danger);border-color:rgba(220,38,38,0.2);">결재</span><div><div class="notice-title">[홍길동] 출장 신청서가 승인되었습니다</div><div class="notice-date">방금 전</div></div></div>
          <div class="notice-gadget-item"><span class="notice-category notice-cat-hr">메일</span><div><div class="notice-title">김팀장: 이번 주 금요일 회의 건 확인 부탁드립니다</div><div class="notice-date">10분 전</div></div></div>
          <div class="notice-gadget-item"><span class="notice-category notice-cat-it">캘린더</span><div><div class="notice-title">오늘 14:00 개발팀 주간 회의 30분 전 알림</div><div class="notice-date">13:30</div></div></div>
          <div class="notice-gadget-item"><span class="notice-category notice-cat-gen">게시판</span><div><div class="notice-title">[전사] 하반기 워크숍 참가 신청 마감 내일까지</div><div class="notice-date">어제</div></div></div>`;

      case 'birthday': {
        const months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
        const now = new Date();
        return `
          <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);margin-bottom:10px;">🎂 ${now.getMonth()+1}월 생일자</div>
          ${[
            { name:'김태희', dept:'마케팅팀', date:'7/8', day:'화' },
            { name:'이민정', dept:'기획팀', date:'7/15', day:'화' },
            { name:'박지수', dept:'개발팀', date:'7/21', day:'월' },
            { name:'최현우', dept:'영업팀', date:'7/28', day:'월' },
          ].map((p, i) => `
            <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1f5f9;">
              <div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#ec4899,#f97316);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;color:white;flex-shrink:0;">${p.name.charAt(0)}</div>
              <div style="flex-grow:1;">
                <div style="font-size:0.83rem;font-weight:600;color:var(--text-main);">${p.name}</div>
                <div style="font-size:0.7rem;color:var(--text-muted);">${p.dept}</div>
              </div>
              <div style="text-align:right;font-size:0.75rem;">
                <div style="font-weight:700;color:#ec4899;">${p.date}</div>
                <div style="color:var(--text-dark);">${p.day}요일</div>
              </div>
            </div>`).join('')}`;
      }

      case 'todo':
        return `
          <div id="todoGadgetList">
            ${[
              { text:'분기 보고서 초안 작성', done:false, due:'오늘' },
              { text:'신규 API 연동 테스트', done:false, due:'7/8' },
              { text:'팀 회의록 공유', done:true, due:'완료' },
              { text:'예산 계획서 검토', done:false, due:'7/10' },
            ].map((t, i) => `
              <div class="todo-item">
                <div class="todo-check ${t.done ? 'checked' : ''}" onclick="this.classList.toggle('checked');this.nextElementSibling.classList.toggle('done');">${t.done ? '<i class="fa-solid fa-check"></i>' : ''}</div>
                <span class="todo-text ${t.done ? 'done' : ''}">${t.text}</span>
                <span class="todo-due" style="color:${t.due==='오늘'?'var(--danger)':t.due==='완료'?'var(--success)':'var(--text-dark)'};">${t.due}</span>
              </div>`).join('')}
          </div>
          <button onclick="const li=document.createElement('div');li.className='todo-item';li.innerHTML='<div class=\\'todo-check\\'></div><input type=\\'text\\'  placeholder=\\'새 할 일 입력...\\'  style=\\'border:none;outline:none;font-size:0.82rem;flex-grow:1;font-family:var(--font-main);\\' /><span class=\\'todo-due\\'></span>';document.getElementById('todoGadgetList').appendChild(li);li.querySelector('input').focus();" style="width:100%;margin-top:8px;padding:7px;border:1px dashed var(--border-color);border-radius:7px;background:transparent;cursor:pointer;font-size:0.78rem;color:var(--text-muted);font-family:var(--font-main);">
            <i class="fa-solid fa-plus"></i> 할 일 추가
          </button>`;

      case 'hr-news':
        return `
          ${[
            { type:'발령', text:'홍길동 대리 → 개발2팀 선임 승진 발령', date:'2026.07.01' },
            { type:'입사', text:'신입사원 박지수 · 김민준 입사', date:'2026.07.01' },
            { type:'퇴직', text:'이상호 부장 7월 31일부로 퇴직 예정', date:'2026.06.28' },
          ].map(n => `
            <div class="notice-gadget-item">
              <span class="notice-category notice-cat-hr">${n.type}</span>
              <div><div class="notice-title">${n.text}</div><div class="notice-date">${n.date}</div></div>
            </div>`).join('')}`;

      case 'welfare':
        return `
          <div style="text-align:center;margin-bottom:14px;">
            <div style="font-size:1.8rem;font-weight:700;color:var(--warning);">450,000원</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">올해 잔여 복지포인트</div>
          </div>
          <div class="points-progress" style="height:8px;"><div class="points-bar" style="width:45%;"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-muted);margin-top:6px;">
            <span>사용: 550,000원</span><span>한도: 1,000,000원</span>
          </div>
          <button class="welfare-action-btn" data-tab="welfare" style="margin-top:12px;width:100%;"><i class="fa-solid fa-star"></i> 복지 혜택 신청</button>`;

      case 'lunch':
        return `<div id="dashLunchMenu"></div><button class="welfare-action-btn" data-tab="welfare" style="margin-top:8px;width:100%;"><i class="fa-solid fa-vote-yea"></i> 점심 투표 참여</button>`;

      case 'expense':
        return `
          <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:0.78rem;color:var(--text-muted);">7월 총 경비</span>
              <span style="font-size:1.1rem;font-weight:700;color:var(--text-main);">₩347,500</span>
            </div>
            <div class="points-progress"><div class="points-bar" style="width:35%;background:linear-gradient(to right,var(--secondary),var(--primary));"></div></div>
          </div>
          ${[
            { cat:'법인카드', amt:'210,000', icon:'fa-credit-card', color:'var(--primary)' },
            { cat:'영수증', amt:'87,500', icon:'fa-receipt', color:'var(--warning)' },
            { cat:'유류비', amt:'50,000', icon:'fa-gas-pump', color:'var(--success)' },
          ].map(e => `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;">
              <div style="width:28px;height:28px;border-radius:7px;background:${e.color}18;display:flex;align-items:center;justify-content:center;color:${e.color};font-size:0.8rem;"><i class="fa-solid ${e.icon}"></i></div>
              <span style="flex-grow:1;font-size:0.82rem;color:var(--text-main);">${e.cat}</span>
              <span style="font-size:0.82rem;font-weight:700;color:var(--text-main);">₩${e.amt}</span>
            </div>`).join('')}`;

      case 'login-log':
        return `
          ${[
            { device:'Chrome · Windows', ip:'121.138.x.x', time:'오늘 09:02', ok:true },
            { device:'Safari · iPhone', ip:'211.234.x.x', time:'어제 18:45', ok:true },
            { device:'Chrome · Windows', ip:'121.138.x.x', time:'2026.07.04', ok:true },
          ].map(l => `
            <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1f5f9;">
              <div style="width:8px;height:8px;border-radius:50%;background:${l.ok?'var(--success)':'var(--danger)'};flex-shrink:0;"></div>
              <div style="flex-grow:1;">
                <div style="font-size:0.82rem;color:var(--text-main);">${l.device}</div>
                <div style="font-size:0.7rem;color:var(--text-muted);">${l.ip}</div>
              </div>
              <span style="font-size:0.7rem;color:var(--text-dark);">${l.time}</span>
            </div>`).join('')}`;

      case 'report-todo':
        return `
          ${[
            { title:'7월 1주차 업무 보고', due:'오늘', status:'작성 필요' },
            { title:'Q2 성과 회고 보고', due:'7/10', status:'작성 필요' },
          ].map(r => `
            <div style="padding:10px 12px;background:#f8fafc;border-radius:8px;border:1px solid var(--border-color);margin-bottom:8px;">
              <div style="font-size:0.85rem;font-weight:600;color:var(--text-main);margin-bottom:4px;">${r.title}</div>
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:0.72rem;color:${r.due==='오늘'?'var(--danger)':'var(--text-muted)'};">마감: ${r.due}</span>
                <button data-tab="reports" style="font-size:0.72rem;padding:3px 10px;border-radius:5px;border:1px solid var(--primary);background:var(--primary-light);color:var(--primary);cursor:pointer;">보고 작성</button>
              </div>
            </div>`).join('')}`;

      case 'html-editor':
        return `<div contenteditable="true" style="min-height:120px;font-size:0.85rem;color:var(--text-main);outline:none;line-height:1.6;" placeholder="HTML 또는 텍스트를 입력하세요...">
          <p><strong>📌 팀 공지</strong></p>
          <p>이번 주 금요일 팀 회식이 있습니다. 참석 여부를 알려주세요!</p>
        </div>`;

      case 'ai-summary':
        return `
          <div style="padding:12px;background:rgba(59,91,219,0.04);border:1px solid rgba(59,91,219,0.12);border-radius:10px;margin-bottom:10px;">
            <div style="font-size:0.72rem;color:var(--primary);font-weight:700;margin-bottom:6px;"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 오늘의 업무 브리핑</div>
            <div style="font-size:0.82rem;color:var(--text-main);line-height:1.6;">
              오늘 결재 대기 <strong>3건</strong>이 있습니다. 14:00 개발팀 회의가 예정되어 있으며, 주간 보고 작성이 필요합니다. 김태희 사원의 연차 신청 검토를 완료해주세요.
            </div>
          </div>
          <button onclick="this.textContent='AI 요약 중...';setTimeout(()=>this.textContent='🔄 다시 요약하기',1500)" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border-color);background:#f8fafc;cursor:pointer;font-size:0.78rem;color:var(--text-muted);font-family:var(--font-main);">🔄 다시 요약하기</button>`;

      default:
        return `<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:0.85rem;">${GADGET_LIBRARY.find(g=>g.id===id)?.desc || '가젯'}</div>`;
    }
  }

  function buildGadgetFooter(id) {
    const footerMap = {
      'approval': { text:'전체 결재함', tab:'approval' },
      'calendar': { text:'전체 캘린더', tab:'calendar' },
      'notice': { text:'전체 공지 보기', tab:null },
      'leave': { text:'연차 신청', tab:'calendar' },
      'feed': { text:'전체 피드', tab:null },
      'attendance': { text:'조직도 보기', tab:'directory' },
      'expense': { text:'경비 관리', tab:'expense' },
    };

    const info = footerMap[id];
    if (!info) return null;

    const footer = el('div', 'gadget-footer');
    const link = el('a', 'gadget-more-link');
    link.innerHTML = `${info.text} <i class="fa-solid fa-chevron-right" style="font-size:0.65rem;"></i>`;
    if (info.tab) link.setAttribute('data-tab', info.tab);
    footer.appendChild(link);
    return footer;
  }

  // =====================================================
  // 드래그&드롭 설정
  // =====================================================
  function setupDragDrop(grid, dash) {
    const gadgets = grid.querySelectorAll('.gadget');

    gadgets.forEach((gadget, idx) => {
      gadget.addEventListener('dragstart', (e) => {
        state.dragSrcIndex = idx;
        gadget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', idx);
      });

      gadget.addEventListener('dragend', () => {
        gadget.classList.remove('dragging');
        grid.querySelectorAll('.gadget').forEach(g => g.classList.remove('drag-over'));
      });

      gadget.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        grid.querySelectorAll('.gadget').forEach(g => g.classList.remove('drag-over'));
        gadget.classList.add('drag-over');
      });

      gadget.addEventListener('drop', (e) => {
        e.preventDefault();
        const srcIdx = state.dragSrcIndex;
        const destIdx = idx;
        if (srcIdx !== null && srcIdx !== destIdx) {
          const arr = dash.gadgets;
          const [removed] = arr.splice(srcIdx, 1);
          arr.splice(destIdx, 0, removed);
          state.dragSrcIndex = null;
          saveState();
          render();
        }
      });
    });
  }

  // =====================================================
  // 가젯 설정 모달
  // =====================================================
  function openGadgetSettings(def, idx) {
    let modal = document.getElementById('gadgetSettingsModal');
    if (!modal) {
      modal = el('div', 'modal-overlay');
      modal.id = 'gadgetSettingsModal';
      modal.innerHTML = `
        <div class="modal-content" style="max-width:420px;">
          <div class="modal-header">
            <h3 style="font-size:1.05rem;font-weight:700;" id="gadgetSettingsTitle">가젯 설정</h3>
            <button class="modal-close" id="gadgetSettingsClose">&times;</button>
          </div>
          <div id="gadgetSettingsBody"></div>
          <div style="display:flex;gap:10px;margin-top:18px;">
            <button class="btn-primary" id="gadgetSettingsSave" style="flex:2;">저장</button>
            <button class="btn-secondary" id="gadgetSettingsCancel" style="flex:1;">취소</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      document.getElementById('gadgetSettingsClose').onclick = () => modal.classList.remove('active');
      document.getElementById('gadgetSettingsCancel').onclick = () => modal.classList.remove('active');
      document.getElementById('gadgetSettingsSave').onclick = () => {
        window.DashboardModule.showToast('가젯 설정이 저장되었습니다.', 'success');
        modal.classList.remove('active');
      };
    }

    document.getElementById('gadgetSettingsTitle').textContent = `⚙️ ${def.name} 설정`;
    document.getElementById('gadgetSettingsBody').innerHTML = `
      <div class="form-group">
        <label>가젯 제목</label>
        <input type="text" class="form-control" value="${def.name}">
      </div>
      <div class="form-group" style="margin-top:12px;">
        <label>새로고침 주기</label>
        <select class="form-control">
          <option>수동 새로고침</option>
          <option selected>1분</option>
          <option>5분</option>
          <option>10분</option>
          <option>30분</option>
        </select>
      </div>
      <div class="form-group" style="margin-top:12px;">
        <label>목록 출력 개수</label>
        <select class="form-control">
          <option>5개</option>
          <option selected>10개</option>
          <option>20개</option>
          <option>50개</option>
        </select>
      </div>`;

    modal.classList.add('active');
  }

  // =====================================================
  // 대시보드 추가/삭제
  // =====================================================
  function addDashboard() {
    const id = 'dash_' + Date.now();
    state.dashboards.push({
      id,
      name: `대시보드 ${state.dashboards.length + 1}`,
      layout: '3col',
      gadgets: []
    });
    state.activeDashId = id;
    state.editMode = true;
    saveState();
    render();
  }

  function deleteDashboard() {
    if (state.dashboards.length <= 1) {
      window.DashboardModule.showToast('마지막 대시보드는 삭제할 수 없습니다.', 'error');
      return;
    }
    if (!confirm(`"${getActiveDash().name}" 대시보드를 삭제하시겠습니까?`)) return;
    state.dashboards = state.dashboards.filter(d => d.id !== state.activeDashId);
    state.activeDashId = state.dashboards[0].id;
    state.editMode = false;
    saveState();
    render();
  }

  // =====================================================
  // 전체 렌더링
  // =====================================================
  function render() {
    renderManagerBar();
    renderGadgetPicker();
    renderGadgetGrid();
    // 퀵메뉴 탭 이동 바인딩
    setTimeout(() => {
      document.querySelectorAll('.quickmenu-item[data-tab], [data-tab]').forEach(el => {
        if (!el._tabBound) {
          el._tabBound = true;
          el.addEventListener('click', (e) => {
            const tabId = el.getAttribute('data-tab');
            if (tabId) {
              const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
              if (navItem) navItem.click();
            }
          });
        }
      });
      // 미니 캘린더 초기화
      if (typeof window.initMiniCalendar === 'function') window.initMiniCalendar();
      // 근태 가젯 업데이트
      if (typeof window.renderAttendGadget === 'function') window.renderAttendGadget();
    }, 50);
  }

  function _getMonthLabel() {
    const d = new Date();
    return `${d.getFullYear()}년 ${d.getMonth()+1}월`;
  }

  function showToast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    }
  }

  // =====================================================
  // 초기화
  // =====================================================
  function init() {
    loadState();
    // 기존 stats-grid 위에 대시보드 관리 바 삽입
    render();
  }

  return { init, render, showToast };

})();
