/**
 * 📅 calendarModule.js — 업무 캘린더 & 연차 신청 모듈 (v2 - 실시간 등록 수정)
 *
 * 담당 기능:
 *   - 월간 캘린더 렌더링 (이전/다음 달 이동)
 *   - 날짜 클릭 → 연차 신청 폼 자동 연동 + 시각적 하이라이트 + 폼 스크롤
 *   - 연차/휴가 신청 → 캘린더 즉시 반영 + 내 일정 목록 실시간 업데이트
 *   - 이벤트 색상 코딩 (타입별)
 *   - 오늘 날짜 하이라이트
 *
 * 의존성: cloudDB.js, mockAPI.js
 */

window.CalendarModule = (() => {
  let _currentDate  = new Date();   // 현재 표시 중인 년/월
  let _selectedDate = null;         // 현재 선택된 날짜 문자열 (YYYY-MM-DD)

  const TYPE_COLORS = {
    '연차':'#a855f7','오전반차':'#06b6d4','오후반차':'#0891b2',
    '병가':'#ef4444','경조사휴가':'#f59e0b','공가':'#10b981',
    '대체휴무':'#6366f1','재택근무':'#3b82f6','출장':'#f97316',
    '외근':'#84cc16','업무미팅':'#8b5cf6','교육':'#ec4899','기타':'#6366f1',
  };

  function render() {
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const year  = _currentDate.getFullYear();
    const month = _currentDate.getMonth();

    const title = document.getElementById('calendarMonthYear');
    if (title) title.textContent = `${year}년 ${month + 1}월`;

    ['일','월','화','수','목','금','토'].forEach((label, idx) => {
      const h = document.createElement('div');
      h.style.cssText = 'text-align:center; font-size:0.8rem; font-weight:700; color:var(--text-muted); padding:8px 0;';
      h.textContent = label;
      if (idx === 0) h.style.color = 'var(--danger)';
      if (idx === 6) h.style.color = 'var(--secondary)';
      grid.appendChild(h);
    });

    const firstDay      = new Date(year, month, 1).getDay();
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
      const cell = document.createElement('div');
      cell.style.cssText = 'min-height:86px; background:rgba(255,255,255,0.01); border:1px solid var(--border-color); border-radius:8px; padding:6px; opacity:0.25; display:flex; flex-direction:column;';
      cell.innerHTML = `<span style="font-size:0.85rem; color:var(--text-muted);">${prevMonthDays - i}</span>`;
      grid.appendChild(cell);
    }

    const numDays        = new Date(year, month + 1, 0).getDate();
    const today          = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const events         = window.AppState?.events || [];

    for (let d = 1; d <= numDays; d++) {
      const dateStr     = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isTodayCell = isCurrentMonth && today.getDate() === d;
      const isSelected  = _selectedDate === dateStr;
      const dayOfWeek   = new Date(year, month, d).getDay();

      const cell = document.createElement('div');
      cell.className    = 'calendar-cell';
      cell.dataset.date = dateStr;

      let border = 'var(--border-color)', bg = 'rgba(255,255,255,0.02)';
      if (isTodayCell) { cell.classList.add('today'); border = 'var(--primary)'; bg = 'rgba(99,102,241,0.06)'; }
      if (isSelected && !isTodayCell) { border = 'var(--secondary)'; bg = 'rgba(6,182,212,0.08)'; }
      if (isSelected &&  isTodayCell) { border = 'var(--primary)';   bg = 'rgba(99,102,241,0.12)'; }

      cell.style.cssText = `min-height:88px; background:${bg}; border:2px solid ${border}; border-radius:8px; padding:8px; display:flex; flex-direction:column; gap:4px; transition:all 0.2s; cursor:pointer;`;

      let numColor = 'var(--text-main)';
      if (dayOfWeek === 0) numColor = 'var(--danger)';
      if (dayOfWeek === 6) numColor = 'var(--secondary)';

      let html = isTodayCell
        ? `<span style="color:white;background:var(--primary);width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;">${d}</span>`
        : `<span style="color:${numColor};font-weight:700;font-size:0.85rem;">${d}</span>`;

      const dayEvts = events.filter(e => e.start === dateStr || (dateStr >= e.start && dateStr <= (e.end || e.start)));
      dayEvts.slice(0, 3).forEach(evt => {
        html += `<div style="background:${evt.color||'var(--primary)'};color:white;font-size:0.68rem;padding:3px 6px;border-radius:4px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${evt.title}">${evt.title}</div>`;
      });
      if (dayEvts.length > 3) html += `<div style="font-size:0.65rem;color:var(--text-muted);text-align:right;">+${dayEvts.length - 3}개 더</div>`;

      cell.innerHTML = html;

      cell.addEventListener('click', () => {
        _selectedDate = dateStr;
        const ls = document.getElementById('leaveStart');
        const le = document.getElementById('leaveEnd');
        if (ls) ls.value = dateStr;
        if (le) le.value = dateStr;
        render();
        const sidebar = document.querySelector('.leave-sidebar');
        if (sidebar) sidebar.scrollIntoView({ behavior:'smooth', block:'nearest' });
        setTimeout(() => { const lt = document.getElementById('leaveType'); if (lt) lt.focus(); }, 300);
      });

      grid.appendChild(cell);
    }
  }

  function prevMonth() { _currentDate.setMonth(_currentDate.getMonth() - 1); render(); }
  function nextMonth() { _currentDate.setMonth(_currentDate.getMonth() + 1); render(); }

  async function applyLeave(start, end, type, reason) {
    const user = window.AppState?.currentUser;
    if (!user) { if (window.showToast) window.showToast('⚠️ 오류','로그인이 필요합니다.','danger'); return null; }
    if (!start) { if (window.showToast) window.showToast('⚠️ 날짜 미선택','캘린더에서 날짜를 클릭하거나 시작일을 선택해주세요.','danger'); return null; }

    const color   = TYPE_COLORS[type] || '#6366f1';
    const title   = `${user.name} [${type}]`;
    const endDate = end || start;
    const dStart  = new Date(start);
    const dEnd    = new Date(endDate);
    const diffDays = Math.ceil(Math.abs(dEnd - dStart) / 86400000) + 1;
    const leaveDays = type.includes('반차') ? 0.5 : diffDays;

    // ① 낙관적 업데이트 — AppState에 즉시 추가
    const tempId    = 'tmp_' + Date.now();
    const tempEvent = { id:tempId, title, start, end:endDate, type:'leave', color, employeeId:user.id, leaveDays, reason:reason||'' };
    if (window.AppState) window.AppState.events.push(tempEvent);

    // ② 캘린더 즉시 리렌더
    _selectedDate = start;
    render();

    // ③ 내 일정 목록 즉시 업데이트
    if (typeof window._renderMyEventsList === 'function') window._renderMyEventsList();

    // ④ 성공 토스트
    if (window.showToast) window.showToast('✅ 일정 등록 완료', `[${type}] ${start}${endDate !== start ? ' ~ '+endDate : ''} 캘린더에 즉시 반영되었습니다.`, 'success');

    // ⑤ 백그라운드 저장
    try {
      const saved = await MockAPI.saveCalendarEvent({ title, start, end:endDate, type:'leave', color, employeeId:user.id, leaveDays, reason:reason||'' });
      if (saved && window.AppState) {
        const idx = window.AppState.events.findIndex(e => e.id === tempId);
        if (idx !== -1) window.AppState.events[idx] = { ...tempEvent, ...saved };
      }
    } catch(err) { console.warn('[Calendar] CloudDB 저장 실패:', err.message); }

    return tempEvent;
  }

  function init() {
    const prevBtn = document.getElementById('prevMonthBtn');
    const nextBtn = document.getElementById('nextMonthBtn');
    if (prevBtn) { const nb = prevBtn.cloneNode(true); prevBtn.parentNode.replaceChild(nb, prevBtn); nb.addEventListener('click', prevMonth); }
    if (nextBtn) { const nb = nextBtn.cloneNode(true); nextBtn.parentNode.replaceChild(nb, nextBtn); nb.addEventListener('click', nextMonth); }

    const todayIso = new Date().toISOString().split('T')[0];
    const ls = document.getElementById('leaveStart');
    const le = document.getElementById('leaveEnd');
    if (ls) ls.value = todayIso;
    if (le) le.value = todayIso;

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

        if (!start) {
          if (window.showToast) window.showToast('⚠️ 시작일 필요', '캘린더에서 날짜를 클릭하거나 시작일을 선택해주세요.', 'danger');
          return;
        }

        const submitBtn = newForm.querySelector('button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 등록 중...'; }

        try {
          await applyLeave(start, end, type, reason);
          newForm.reset();
          const todayVal = new Date().toISOString().split('T')[0];
          const ls2 = document.getElementById('leaveStart');
          const le2 = document.getElementById('leaveEnd');
          if (ls2) ls2.value = todayVal;
          if (le2) le2.value = todayVal;
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 신청하기 (결재 요청)'; }
        }
      });
    }

    render();
  }

  return { init, render, prevMonth, nextMonth, applyLeave, get currentDate() { return _currentDate; } };
})();
