/**
 * 📅 calendarModule.js — 업무 캘린더 & 연차 신청 모듈
 *
 * 담당 기능:
 *   - 월간 캘린더 렌더링 (이전/다음 달 이동)
 *   - 날짜 클릭 → 연차 신청 폼 자동 연동
 *   - 연차/휴가 신청 (서버 + CloudDB 동시 저장)
 *   - 이벤트 색상 코딩 (연차/반차/기타)
 *   - 오늘 날짜 하이라이트
 *
 * 의존성: cloudDB.js, mockAPI.js
 *
 * 사용법:
 *   CalendarModule.init()    // DOMContentLoaded 시 호출
 *   CalendarModule.render()  // 현재 월 캘린더 렌더링
 */

window.CalendarModule = (() => {
  let _currentDate = new Date(2026, 6, 1); // 현재 표시 중인 년/월

  // ── 캘린더 렌더링 ─────────────────────────────────────────────────
  /**
   * 월간 캘린더를 DOM에 렌더링합니다.
   */
  function render() {
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const year  = _currentDate.getFullYear();
    const month = _currentDate.getMonth();

    // 헤더: 년/월 업데이트
    const title = document.getElementById('calendarMonthYear');
    if (title) title.textContent = `${year}년 ${month + 1}월`;

    // ① 요일 헤더
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    weekdays.forEach((label, idx) => {
      const header = document.createElement('div');
      header.style.cssText = 'text-align:center; font-size:0.8rem; font-weight:700; color:var(--text-muted); padding:8px 0;';
      header.textContent = label;
      if (idx === 0) header.style.color = 'var(--danger)';
      if (idx === 6) header.style.color = 'var(--secondary)';
      grid.appendChild(header);
    });

    // ② 이전 달 빈 칸 (padding)
    const firstDay        = new Date(year, month, 1).getDay();
    const prevMonthDays   = new Date(year, month, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
      const cell = document.createElement('div');
      cell.style.cssText = 'min-height:86px; background:rgba(255,255,255,0.01); border:1px solid var(--border-color); border-radius:8px; padding:6px; opacity:0.25; display:flex; flex-direction:column;';
      cell.innerHTML = `<span style="font-size:0.85rem; color:var(--text-muted);">${prevMonthDays - i}</span>`;
      grid.appendChild(cell);
    }

    // ③ 이번 달 날짜
    const numDays       = new Date(year, month + 1, 0).getDate();
    const today         = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const events        = window.AppState?.events || [];

    for (let d = 1; d <= numDays; d++) {
      const dateStr    = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isTodayCell= isCurrentMonth && today.getDate() === d;
      const dayOfWeek  = new Date(year, month, d).getDay();

      const cell = document.createElement('div');
      cell.style.cssText = `
        min-height:88px; background:rgba(255,255,255,0.02);
        border:1px solid var(--border-color); border-radius:8px;
        padding:8px; display:flex; flex-direction:column; gap:4px;
        transition:all 0.2s; cursor:pointer;
      `;
      if (isTodayCell) {
        cell.style.borderColor = 'var(--primary)';
        cell.style.background  = 'rgba(99,102,241,0.06)';
      }

      // 날짜 숫자
      let numColor = 'var(--text-main)';
      if (dayOfWeek === 0) numColor = 'var(--danger)';
      if (dayOfWeek === 6) numColor = 'var(--secondary)';

      let html = isTodayCell
        ? `<span style="color:white; background:var(--primary); width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.8rem; font-weight:700;">${d}</span>`
        : `<span style="color:${numColor}; font-weight:700; font-size:0.85rem;">${d}</span>`;

      // 이날의 이벤트 표시
      const dayEvts = events.filter(e => e.start === dateStr || (dateStr >= e.start && dateStr <= (e.end || e.start)));
      dayEvts.forEach(evt => {
        html += `<div style="background:${evt.color || 'var(--primary)'}; color:white; font-size:0.68rem; padding:3px 6px; border-radius:4px; font-weight:600; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; box-shadow:0 2px 5px rgba(0,0,0,0.15);" title="${evt.title}">${evt.title}</div>`;
      });

      cell.innerHTML = html;

      // 날짜 클릭 → 연차 신청 폼 자동 입력
      cell.addEventListener('click', () => {
        const leaveStart = document.getElementById('leaveStart');
        const leaveEnd   = document.getElementById('leaveEnd');
        if (leaveStart) leaveStart.value = dateStr;
        if (leaveEnd)   leaveEnd.value   = dateStr;

        // 선택 하이라이트
        document.querySelectorAll('.calendar-cell').forEach(c => {
          if (!c.classList.contains('today')) {
            c.style.borderColor = 'var(--border-color)';
            c.style.background  = 'rgba(255,255,255,0.02)';
          }
        });
        if (!isTodayCell) {
          cell.style.borderColor = 'var(--primary)';
          cell.style.background  = 'rgba(99,102,241,0.06)';
        }
      });

      grid.appendChild(cell);
    }
  }

  // ── 월 이동 ────────────────────────────────────────────────────────
  function prevMonth() {
    _currentDate.setMonth(_currentDate.getMonth() - 1);
    render();
  }

  function nextMonth() {
    _currentDate.setMonth(_currentDate.getMonth() + 1);
    render();
  }

  // ── 연차 신청 ────────────────────────────────────────────────────
  /**
   * 연차/휴가 신청 처리
   * @param {string} start    시작일 (YYYY-MM-DD)
   * @param {string} end      종료일
   * @param {string} type     '연차' | '반차' | '기타'
   * @param {string} reason   사유
   */
  async function applyLeave(start, end, type, reason) {
    const user = window.AppState?.currentUser;
    if (!user) return;

    const color = type === '연차' ? '#a855f7' : type === '반차' ? '#06b6d4' : '#6366f1';
    const title = `${user.name} [${type}]`;

    // 연차 일수 계산
    const dStart   = new Date(start);
    const dEnd     = new Date(end || start);
    const diffDays = Math.ceil(Math.abs(dEnd - dStart) / (1000 * 60 * 60 * 24)) + 1;
    const leaveDays= type === '반차' ? 0.5 : diffDays;

    // MockAPI로 저장 (서버 + CloudDB)
    const newEvent = await MockAPI.saveCalendarEvent({
      title, start, end: end || start,
      type: 'leave', color, employeeId: user.id, leaveDays,
    });

    // 전역 상태 업데이트
    if (window.AppState) window.AppState.events.push(newEvent);

    render();

    if (window.showToast) window.showToast('✈️ 휴가/일정 승인 요청', '일정 승인 요청이 성공적으로 상신되었습니다.', 'success');
    return newEvent;
  }

  // ── 모듈 초기화 ─────────────────────────────────────────────────
  function init() {
    // 이전/다음 달 버튼 (기존 이벤트 제거 후 재등록)
    const prevBtn = document.getElementById('prevMonthBtn');
    const nextBtn = document.getElementById('nextMonthBtn');
    if (prevBtn) {
      const newPrev = prevBtn.cloneNode(true);
      prevBtn.parentNode.replaceChild(newPrev, prevBtn);
      newPrev.addEventListener('click', prevMonth);
    }
    if (nextBtn) {
      const newNext = nextBtn.cloneNode(true);
      nextBtn.parentNode.replaceChild(newNext, nextBtn);
      newNext.addEventListener('click', nextMonth);
    }

    // 오늘 날짜 기본값 설정
    const todayIso = new Date().toISOString().split('T')[0];
    const leaveStart = document.getElementById('leaveStart');
    const leaveEnd   = document.getElementById('leaveEnd');
    if (leaveStart) leaveStart.value = todayIso;
    if (leaveEnd)   leaveEnd.value   = todayIso;

    // 연차 신청 폼
    const leaveForm = document.getElementById('leaveRequestForm');
    if (leaveForm) {
      const newForm = leaveForm.cloneNode(true);
      leaveForm.parentNode.replaceChild(newForm, leaveForm);

      newForm.addEventListener('submit', async e => {
        e.preventDefault();
        const start  = document.getElementById('leaveStart')?.value;
        const end    = document.getElementById('leaveEnd')?.value || start;
        const type   = document.getElementById('leaveType')?.value || '연차';
        const reason = document.getElementById('leaveReason')?.value?.trim() || '';
        if (!start || !reason) return;

        await applyLeave(start, end, type, reason);

        newForm.reset();
        if (document.getElementById('leaveStart')) document.getElementById('leaveStart').value = todayIso;
        if (document.getElementById('leaveEnd'))   document.getElementById('leaveEnd').value   = todayIso;
      });
    }

    render();
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    init,
    render,
    prevMonth,
    nextMonth,
    applyLeave,
    /** 현재 표시 날짜 접근자 */
    get currentDate() { return _currentDate; },
  };
})();
