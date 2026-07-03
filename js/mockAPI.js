/**
 * 🔌 mockAPI.js — Phase 2: JWT 인증 통합 서버 통신 레이어
 *
 * Phase 2 변경사항:
 *   - JWT 토큰 자동 첨부 (모든 API 요청 Authorization 헤더)
 *   - 토큰 만료 시 자동 로그아웃 처리
 *   - 토큰 저장/복원 (sessionStorage: 브라우저 탭 닫으면 자동 삭제)
 *   - 서버 응답 실패 시 CloudDB LocalStorage fallback (자동)
 *
 * 클라우드 배포 시:
 *   BASE_URL 한 줄만 교체 → 즉시 AWS/GCP/Azure 연동
 */

window.MockAPI = (() => {
  // 🚀 클라우드 배포 시 이 URL만 교체
  const BASE_URL = '';

  // ── JWT 토큰 관리 ────────────────────────────────────────────────
  // sessionStorage: 탭 닫으면 자동 삭제 → 보안성 강화
  function saveToken(token, expiresAt, role) {
    sessionStorage.setItem('oneoffice_jwt',        token);
    sessionStorage.setItem('oneoffice_jwt_exp',    expiresAt);
    sessionStorage.setItem('oneoffice_role',       role);
  }

  function getToken() {
    return sessionStorage.getItem('oneoffice_jwt');
  }

  function clearToken() {
    sessionStorage.removeItem('oneoffice_jwt');
    sessionStorage.removeItem('oneoffice_jwt_exp');
    sessionStorage.removeItem('oneoffice_role');
  }

  function isTokenExpired() {
    const exp = sessionStorage.getItem('oneoffice_jwt_exp');
    if (!exp) return true;
    return new Date() > new Date(exp);
  }

  // ── 기본 HTTP 요청 (JWT 자동 첨부) ──────────────────────────────
  async function _fetch(endpoint, method = 'GET', body = null, skipAuth = false) {
    const headers = { 'Content-Type': 'application/json' };

    if (!skipAuth) {
      const token = getToken();
      if (token) {
        if (isTokenExpired()) {
          // 토큰 만료 → 자동 로그아웃
          clearToken();
          if (window.AuthModule) window.AuthModule.forceLogout?.('세션이 만료되었습니다. 다시 로그인해주세요.');
          return null;
        }
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    try {
      const opts = { method, headers };
      if (body && method !== 'GET') opts.body = JSON.stringify(body);
      const res = await fetch(`${BASE_URL}${endpoint}`, opts);

      if (res.status === 401) {
        // JWT 인증 실패 → 토큰 삭제 + 로그아웃
        clearToken();
        if (window.AuthModule) window.AuthModule.forceLogout?.('인증이 만료되었습니다. 다시 로그인해주세요.');
        return null;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        console.warn(`[MockAPI] ${method} ${endpoint} 실패:`, err.error);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn(`[MockAPI] 서버 연결 실패 (${method} ${endpoint}), LocalStorage fallback:`, err.message);
      return null;
    }
  }

  // ── 기본 데이터 (서버 없을 때 시드 데이터) ──────────────────────
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

  function _getDefaultChatLogs() {
    return {
      group: [
        { sender:'received', senderName:'Jane Doe',   text:'원오피스 사내 단체 대화방입니다. 오늘 하루도 파이팅하세요!' },
        { sender:'received', senderName:'John Smith', text:'오늘 오후 4시에 전사 기술 공유회가 진행될 예정입니다.' },
      ],
      bot: [
        { sender:'received', senderName:'AI Assistant', text:"안녕하세요! OneOffice AI 비서입니다. '휴가 신청해줘', '주휴수당 알려줘' 등을 입력해보세요!" },
      ],
    };
  }

  function _getDefaultMarketItems() {
    return [
      { id:'item1', title:'맥북 에어 M2 (스페이스그레이)', category:'digital', price:850000, sellerId:2, sellerName:'John Smith (CTO)', status:'판매중', description:'회의 출장용으로 깔끔하게 사용했던 맥북 에어 M2 판매합니다.', image:'https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?w=400&q=80', date:'2026-07-02' },
      { id:'item2', title:'저소음 기계식 키보드 (갈축)',    category:'office',  price:45000,  sellerId:6, sellerName:'이민정 (선임)',       status:'예약중', description:'사무실에서 약 2달간 조용하게 썼던 갈축 키보드입니다.',      image:'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400&q=80', date:'2026-07-01' },
    ];
  }

  function _getDefaultRegistryEvents() {
    return [
      { id:'reg1', employeeId:5, employeeName:'김태희 (사원)', eventType:'birthday', eventTitle:'오늘 🎂 생일 이벤트!',          description:'생일 축하 메시지와 선물을 보내보세요.', date:'2026-07-03', isToday:true  },
      { id:'reg2', employeeId:6, employeeName:'이민정 (선임)', eventType:'wedding',  eventTitle:'이번 주 토요일 🤵 결혼식 예고', description:'이민정 선임님의 결혼식이 다가왔습니다.',       date:'2026-07-05', isToday:false },
    ];
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    // JWT 관리 (authModule.js에서 호출)
    saveToken,
    getToken,
    clearToken,
    isTokenExpired,

    // 범용 fetch (JWT 자동 첨부)
    fetchDataFromServer: _fetch,

    /**
     * 전체 앱 상태 로드 (Supabase CloudDB 연동 모드)
     */
    async loadAppState() {
      const serverData = await _fetch('/api/state');

      if (serverData) {
        // 서버가 동작 중일 경우 동기화
        await CloudDB.set('employees',       serverData.employees);
        await CloudDB.set('calendarEvents',  serverData.calendarEvents);
        await CloudDB.set('chatLogs',        serverData.chatLogs);
        await CloudDB.set('welfarePoints',   serverData.welfarePoints);
        await CloudDB.set('fleaMarketItems', serverData.fleaMarketItems);
        await CloudDB.set('registryEvents',  serverData.registryEvents);
        await CloudDB.set('reports',         serverData.reports);
        await CloudDB.set('securityLogs',    serverData.securityLogs);
        return serverData;
      }

      // 📴 서버 없음 → Supabase CloudDB 모드 (비동기 데이터 쿼리 대기)
      console.info('[MockAPI] 🗄️ Supabase CloudDB 모드 활성화 (비동기 연동)');
      
      const employees       = await CloudDB.get('employees',       _getDefaultEmployees());
      const calendarEvents  = await CloudDB.get('calendarEvents',  []);
      const chatLogs        = await CloudDB.get('chatLogs',        _getDefaultChatLogs());
      const welfarePoints   = await CloudDB.get('welfarePoints',   { '1':1000000,'2':850000,'3':1200000,'4':1000000,'5':950000,'6':1000000 });
      const fleaMarketItems = await CloudDB.get('fleaMarketItems', _getDefaultMarketItems());
      const registryEvents  = await CloudDB.get('registryEvents',  _getDefaultRegistryEvents());
      const reports         = await CloudDB.get('reports',         []);
      const securityLogs    = await CloudDB.get('securityLogs',    []);

      return {
        employees,
        calendarEvents,
        chatLogs,
        welfarePoints,
        fleaMarketItems,
        registryEvents,
        reports,
        securityLogs
      };
    },

    /**
     * 캘린더 이벤트 저장
     */
    async saveCalendarEvent(eventData) {
      const newEvent = { id: String(Date.now()), ...eventData };

      // CloudDB 즉시 저장 (비동기 대기 추가)
      const events = await CloudDB.get('calendarEvents', []);
      events.push(newEvent);
      await CloudDB.set('calendarEvents', events);

      // 서버 동기화
      await _fetch('/api/calendar', 'POST', eventData);
      return newEvent;
    },

    /**
     * 채팅 메시지 저장
     */
    async saveChatMessage(channel, sender, senderName, text) {
      const msg = { sender, senderName, text, timestamp: new Date().toISOString() };

      // CloudDB 즉시 저장 (비동기 대기 추가)
      const logs = await CloudDB.get('chatLogs', {});
      if (!logs[channel]) logs[channel] = [];
      logs[channel].push(msg);
      await CloudDB.set('chatLogs', logs);

      // 서버 동기화
      await _fetch('/api/chats', 'POST', { channel, sender, senderName, text });
      return msg;
    },

    /**
     * 업무 보고 저장
     */
    async saveReport(reportData) {
      const report = { id: Date.now(), ...reportData };
      const reports = await CloudDB.get('reports', []);
      reports.unshift(report);
      await CloudDB.set('reports', reports);
      await _fetch('/api/reports', 'POST', reportData);
      return report;
    },

    /**
     * AI 생성 (서버 사이드 프록시 — API 키 서버에서만 관리)
     */
    async generateWithAI(prompt) {
      const res = await _fetch('/api/ai/generate', 'POST', { prompt });
      if (res?.text) return res.text;
      return `[AI 시뮬레이션 응답]\n\n요청: "${prompt.substring(0, 60)}..."\n\n서버에 GEMINI_API_KEY를 .env에 설정하면 실제 AI와 연동됩니다.`;
    },

    /**
     * 급여 계산 (서버 API 우선 → 클라이언트 계산 fallback)
     */
    async calculateSalary(base, leaveDay, otHours) {
      const res = await _fetch('/api/salary/calculate', 'POST', { base, leaveDay, otHours });
      if (res?.result) return res.result;
      // Fallback: 클라이언트 계산
      return window.SalaryModule?.calculate(base, leaveDay, otHours) || null;
    },

    /**
     * 날씨 데이터 (외부 API + CloudDB 캐시)
     */
    async fetchWeatherData(lat = 37.5665, lon = 126.9780) {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        const data = await res.json();
        await CloudDB.set('weatherCache', { data: data.current_weather, cachedAt: new Date().toISOString() });
        return data.current_weather;
      } catch {
        const cache = await CloudDB.get('weatherCache');
        return cache ? cache.data : { temperature: 24, weathercode: 0 };
      }
    },

    /**
     * 복지 포인트 송금
     */
    async transferWelfarePoints(senderId, receiverId, amount, message) {
      // 서버 전송
      const res = await _fetch('/api/welfare/transfer', 'POST', { receiverId, amount, message });
      if (res?.success) {
        // CloudDB 즉시 반영
        const pts = await CloudDB.get('welfarePoints', {});
        pts[String(senderId)]   = (pts[String(senderId)]   || 0) - amount;
        pts[String(receiverId)] = (pts[String(receiverId)] || 0) + amount;
        await CloudDB.set('welfarePoints', pts);
        if (window.AppState) window.AppState.welfarePoints = pts;
        return { success: true, senderPoints: pts[String(senderId)] };
      }
      // Fallback: CloudDB만
      const pts = await CloudDB.get('welfarePoints', {});
      if ((pts[String(senderId)] || 0) < amount) return { success: false, error: '포인트 부족' };
      pts[String(senderId)]   = (pts[String(senderId)]   || 0) - amount;
      pts[String(receiverId)] = (pts[String(receiverId)] || 0) + amount;
      await CloudDB.set('welfarePoints', pts);
      if (window.AppState) window.AppState.welfarePoints = pts;
      return { success: true, senderPoints: pts[String(senderId)] };
    },

    /**
     * 동호회 가입
     */
    async joinClub(userId, clubId, clubName) {
      const memberships = await CloudDB.get('clubMemberships', {});
      if (!memberships[userId]) memberships[userId] = [];
      if (!memberships[userId].includes(clubId)) memberships[userId].push(clubId);
      await CloudDB.set('clubMemberships', memberships);
      return { success: true, memberships: memberships[userId] };
    },

    /**
     * 급여 시뮬레이션 히스토리 저장
     */
    async savePayrollSimulation(userId, result) {
      const history = await CloudDB.get('payrollHistory', []);
      history.unshift({ id: Date.now(), userId, ...result, savedAt: new Date().toISOString() });
      if (history.length > 10) history.splice(10);
      await CloudDB.set('payrollHistory', history);
      // 서버에도 저장 (급여 계산 API 통해)
      await _fetch('/api/salary/calculate', 'POST', result);
      return { success: true };
    },

    // 기본 데이터 공개 접근자
    getDefaultEmployees:      _getDefaultEmployees,
    getDefaultChatLogs:       _getDefaultChatLogs,
    getDefaultMarketItems:    _getDefaultMarketItems,
    getDefaultRegistryEvents: _getDefaultRegistryEvents,
  };
})();
