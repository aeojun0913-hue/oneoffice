/**
 * 💰 salaryModule.js — 급여 시뮬레이터 & 퇴직금 계산 모듈
 *
 * 담당 기능:
 *   - 슬라이더 기반 실수령액 계산 (4대보험 + 소득세 적용)
 *   - SVG 도넛 차트 + 세금 바 차트 렌더링
 *   - 퇴직금 계산기 (입사일/퇴사일 기반)
 *   - 계산 히스토리 CloudDB 저장 (최근 10개)
 *   - 연장수당/미사용연차수당 자동 계산
 *
 * 의존성: cloudDB.js, mockAPI.js
 *
 * 사용법:
 *   SalaryModule.init()   // DOMContentLoaded 시 호출
 *   SalaryModule.calculate(base, leaveBonus, otHours) // 단독 계산 (테스트 가능)
 */

window.SalaryModule = (() => {
  // ── 순수 계산 함수 (테스트 가능한 독립 함수) ───────────────────────

  /**
   * 급여 계산 핵심 로직 (2024년 근로기준법 기준)
   * @param {number} base      월 기본급 (원)
   * @param {number} leaveDay  미사용 연차 일수
   * @param {number} otHours   연장근로 시간
   * @returns {{ gross, np, hi, lt, em, it, localIt, totalDeduct, net, pct }}
   */
  function calculate(base, leaveDay, otHours) {
    const leaveBonus = leaveDay  * (base / 30 / 8);   // 미사용연차수당
    const otBonus    = otHours   * (base / 209) * 1.5; // 연장수당 (1.5배)
    const gross      = Math.round(base + leaveBonus + otBonus);

    const np     = Math.round(gross * 0.045);    // 국민연금 4.5%
    const hi     = Math.round(gross * 0.0354);   // 건강보험 3.54%
    const lt     = Math.round(hi * 0.1295);      // 장기요양 (건강보험의 12.95%)
    const em     = Math.round(gross * 0.009);    // 고용보험 0.9%
    const it     = Math.round(gross * 0.02);     // 근로소득세 간이세액 ~2%
    const localIt= Math.round(it * 0.1);         // 지방소득세 (소득세의 10%)

    const totalDeduct = np + hi + lt + em + it + localIt;
    const net    = gross - totalDeduct;
    const pct    = Math.round((net / gross) * 100);

    return { gross, leaveBonus: Math.round(leaveBonus), otBonus: Math.round(otBonus),
             np, hi, lt, em, it, localIt, totalDeduct, net, pct, base };
  }

  /**
   * 퇴직금 계산 (평균임금 기준)
   * @param {number} grossMonthly 월 총급여 (원)
   * @param {Date}   hireDate     입사일
   * @param {Date}   resignDate   퇴사일
   */
  function calculateSeverance(grossMonthly, hireDate, resignDate) {
    if (!hireDate || !resignDate || resignDate <= hireDate) return null;
    const days      = Math.floor((resignDate - hireDate) / (1000 * 60 * 60 * 24));
    const years     = Math.floor(days / 365);
    const months    = Math.floor((days % 365) / 30);
    const avgPerDay = Math.round(grossMonthly / 30);
    const severance = Math.round(avgPerDay * 30 * (days / 365));
    return { days, years, months, avgPerDay, severance };
  }

  // ── UI 렌더링 함수 ────────────────────────────────────────────────

  /** SVG 도넛 차트 업데이트 */
  function _renderDonutChart(net, gross) {
    const circumference = 2 * Math.PI * 70;
    const netPct    = net / gross;
    const deductPct = 1 - netPct;

    const netCircle    = document.getElementById('chartTakeHomeCircle');
    const deductCircle = document.getElementById('chartDeductionsCircle');
    if (netCircle) {
      netCircle.setAttribute('stroke-dasharray', circumference.toFixed(1));
      netCircle.setAttribute('stroke-dashoffset', (circumference * deductPct).toFixed(1));
    }
    if (deductCircle) {
      deductCircle.setAttribute('stroke-dasharray', circumference.toFixed(1));
      deductCircle.setAttribute('stroke-dashoffset', (circumference * netPct).toFixed(1));
    }
  }

  /** 세금 항목별 바 차트 렌더링 */
  function _renderTaxBarChart(result) {
    const barChart = document.getElementById('taxBracketChart');
    if (!barChart) return;

    const items = [
      { label:'국민연금(4.5%)',    val: result.np,      color:'var(--primary)'   },
      { label:'건강보험(3.5%)',    val: result.hi,      color:'var(--secondary)' },
      { label:'고용보험(0.9%)',    val: result.em,      color:'var(--success)'   },
      { label:'근로소득세(2%)',    val: result.it,      color:'var(--warning)'   },
      { label:'지방소득세(0.2%)', val: result.localIt, color:'var(--accent)'    },
    ];

    barChart.innerHTML = items.map(item => `
      <div class="tax-bar-item">
        <div class="tax-bar-label">${item.label}</div>
        <div class="tax-bar-track">
          <div class="tax-bar-fill" style="width:${Math.round((item.val / result.totalDeduct) * 100)}%; background:${item.color};"></div>
        </div>
        <div class="tax-bar-val">-${item.val.toLocaleString()}원</div>
      </div>
    `).join('');
  }

  /** 결과 DOM 업데이트 */
  function _updateResultDOM(result) {
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setEl('netSalaryResult',      '₩' + result.net.toLocaleString());
    setEl('grossSalaryResult',    result.gross.toLocaleString() + '원');
    setEl('totalDeductionsResult','-' + result.totalDeduct.toLocaleString() + '원');
    setEl('netSalaryPct',         result.pct + '%');
    setEl('deductNational',       '-' + result.np.toLocaleString() + '원');
    setEl('deductHealth',         '-' + result.hi.toLocaleString() + '원');
    setEl('deductEmployment',     '-' + result.em.toLocaleString() + '원');
    setEl('deductTax',            '-' + result.it.toLocaleString() + '원');
    setEl('deductLocalTax',       '-' + result.localIt.toLocaleString() + '원');
    setEl('breakdownBase',        result.base.toLocaleString());
    setEl('breakdownLeave',       result.leaveBonus.toLocaleString());
    setEl('breakdownOt',          result.otBonus.toLocaleString());

    // 추가수당 효과 배너
    const deltaBox  = document.getElementById('deltaEffectBox');
    const deltaText = document.getElementById('deltaEffectText');
    if (deltaBox) {
      const effects = [];
      if (result.otBonus    > 0) effects.push(`연장수당 +${result.otBonus.toLocaleString()}원`);
      if (result.leaveBonus > 0) effects.push(`미사용연차 +${result.leaveBonus.toLocaleString()}원`);
      deltaBox.style.display = effects.length > 0 ? 'flex' : 'none';
      if (deltaText && effects.length > 0) deltaText.textContent = effects.join(' | ') + ' 추가 적용됨';
    }
  }

  // ── 퇴직금 UI 업데이트 ────────────────────────────────────────────
  function _updateSeveranceDOM(data) {
    if (!data) return;
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const container = document.getElementById('severanceResultsContainer');
    if (container) container.style.display = 'flex';
    setEl('severancePayResult',    data.severance.toLocaleString() + '원');
    setEl('severanceServiceDays',  data.days);
    setEl('severanceServiceYears', data.years);
    setEl('severanceServiceMonths',data.months);
    setEl('severanceAvgWage',      data.avgPerDay.toLocaleString());
  }

  // ── 모듈 초기화 ─────────────────────────────────────────────────
  function init() {
    const baseSalarySlider    = document.getElementById('baseSalarySlider');
    const unusedLeaveSlider   = document.getElementById('unusedLeaveSlider');
    const overtimeHoursSlider = document.getElementById('overtimeHoursSlider');
    const calcBtn             = document.getElementById('calculatePayrollBtn');
    const severanceToggle     = document.getElementById('simSeveranceToggle');
    const severanceContainer  = document.getElementById('severanceInputsContainer');

    if (!baseSalarySlider) return; // 급여 탭이 없으면 스킵

    // 슬라이더 레이블 업데이트
    const updateLabels = () => {
      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setEl('baseSalaryVal',    Number(baseSalarySlider.value).toLocaleString() + '원');
      setEl('unusedLeaveVal',   unusedLeaveSlider.value + '일');
      setEl('overtimeHoursVal', overtimeHoursSlider.value + '시간');
    };

    baseSalarySlider.addEventListener('input', updateLabels);
    unusedLeaveSlider.addEventListener('input', updateLabels);
    overtimeHoursSlider.addEventListener('input', updateLabels);
    updateLabels();

    // 퇴직금 섹션 토글
    if (severanceToggle) {
      severanceToggle.addEventListener('change', () => {
        if (severanceContainer) severanceContainer.style.display = severanceToggle.checked ? 'block' : 'none';
      });
    }

    // 계산 버튼
    if (calcBtn) {
      calcBtn.addEventListener('click', async () => {
        const base     = Number(baseSalarySlider.value);
        const leaveDay = Number(unusedLeaveSlider.value);
        const otHours  = Number(overtimeHoursSlider.value);

        const result = calculate(base, leaveDay, otHours);

        _updateResultDOM(result);
        _renderDonutChart(result.net, result.gross);
        _renderTaxBarChart(result);

        // 퇴직금 계산
        if (severanceToggle && severanceToggle.checked) {
          const hireDateInput   = document.getElementById('hireDateInput');
          const resignDateInput = document.getElementById('resignDateInput');
          if (hireDateInput && resignDateInput) {
            const sevData = calculateSeverance(
              result.gross,
              new Date(hireDateInput.value),
              new Date(resignDateInput.value)
            );
            _updateSeveranceDOM(sevData);
          }
        }

        // CloudDB에 시뮬레이션 히스토리 저장
        const userId = window.AppState?.currentUser?.id;
        if (userId) {
          await MockAPI.savePayrollSimulation(userId, {
            base, leaveDay, otHours, net: result.net, gross: result.gross,
          });
        }

        if (window.showToast) window.showToast('📊 급여 계산 완료', '최신 근로기준법/세율 기준으로 계산되었습니다.', 'success');
      });
    }
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    init,
    calculate,
    calculateSeverance,
  };
})();
