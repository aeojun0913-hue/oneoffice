/**
 * ☁️ cloudDB.js — SaaS 핵심 모듈 1: Supabase 클라우드 DB 연동
 *
 * 목적: LocalStorage 저장 방식에서 진짜 AWS 호스팅 Supabase (PostgreSQL)
 *       클라우드 데이터베이스와 실시간으로 데이터를 동기화합니다.
 */

window.CloudDB = (() => {
  const SUBAPASE_URL = 'https://nnebupmxmbrjmxsnvstj.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5uZWJ1cG14bWJyam14c252c3RqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5Nzc3ODgsImV4cCI6MjA5ODU1Mzc4OH0.NsYIxdXtdKoCTKKcDsCuJyR8uTU-T1oh4Ht3kQmz6WM';

  // Supabase 클라이언트 초기화
  let supabase = null;
  if (window.supabase && window.supabase.createClient) {
    supabase = window.supabase.createClient(SUBAPASE_URL, SUPABASE_KEY);
  } else {
    console.error('[CloudDB] Supabase SDK가 아직 로드되지 않았습니다.');
  }

  // LocalStorage 호환을 위한 매핑 정보
  const TABLE_MAP = {
    'employees': 'employees',
    'welfarePoints': 'welfare_points',
    'chatLogs': 'chat_logs',
    'registryEvents': 'registry_events',
    'fleaMarketItems': 'flea_market_items',
    'reports': 'reports',
    'securityLogs': 'security_logs'
  };

  return {
    client: supabase,

    // ── Read (실시간 비동기 조회) ────────────────────────────────────
    async get(collection, defaultValue = null) {
      if (!supabase) return defaultValue;
      const table = TABLE_MAP[collection];
      if (!table) return defaultValue;

      try {
        const { data, error } = await supabase
          .from(table)
          .select('*');

        if (error) throw error;

        // welfarePoints의 경우 { "1": 1000000, "2": 850000 } 포맷으로 가공
        if (collection === 'welfarePoints') {
          const formatted = {};
          data.forEach(row => {
            formatted[String(row.user_id)] = row.balance;
          });
          return formatted;
        }

        // chatLogs의 경우 target별로 그룹핑하여 { group: [], bot: [] } 포맷 제공
        if (collection === 'chatLogs') {
          const formatted = {};
          data.forEach(row => {
            if (!formatted[row.target]) formatted[row.target] = [];
            formatted[row.target].push({
              sender: row.sender,
              senderName: row.sender_name,
              text: row.text
            });
          });
          return formatted;
        }

        // 일반 배열 반환 (ID 정렬)
        return data.sort((a, b) => a.id - b.id) || defaultValue;
      } catch (e) {
        console.warn(`[Supabase Read Error] ${collection}:`, e);
        return defaultValue;
      }
    },

    // ── Write / Update (단일 데이터 추가/수정) ────────────────────────
    async set(collection, data) {
      if (!supabase) return false;
      const table = TABLE_MAP[collection];
      if (!table) return false;

      try {
        // 복지 포인트 일괄 업데이트 처리
        if (collection === 'welfarePoints') {
          const promises = Object.entries(data).map(([userId, balance]) => {
            return supabase
              .from('welfare_points')
              .upsert({ user_id: Number(userId), balance });
          });
          await Promise.all(promises);
          return true;
        }

        // 일반 배열 저장
        if (Array.isArray(data)) {
          const promises = data.map(item => {
            const row = { ...item };
            // 객체 Key 포맷 변환 (camelCase -> snake_case)
            if (row.joinDate !== undefined) { row.join_date = row.joinDate; delete row.joinDate; }
            if (row.workStyle !== undefined) { row.work_style = row.workStyle; delete row.workStyle; }
            if (row.employeeId !== undefined) { row.employee_id = row.employeeId; delete row.employeeId; }
            if (row.employeeName !== undefined) { row.employee_name = row.employeeName; delete row.employeeName; }
            if (row.eventTitle !== undefined) { row.event_title = row.eventTitle; delete row.eventTitle; }
            if (row.isToday !== undefined) { row.is_today = row.isToday; delete row.isToday; }
            if (row.sellerId !== undefined) { row.seller_id = row.sellerId; delete row.sellerId; }
            if (row.sellerName !== undefined) { row.seller_name = row.sellerName; delete row.sellerName; }
            return supabase.from(table).upsert(row);
          });
          await Promise.all(promises);
          return true;
        }

        return false;
      } catch (e) {
        console.error(`[Supabase Write Error] ${collection}:`, e);
        return false;
      }
    },

    // ── Array push (데이터 즉시 insert) ─────────────────────────────
    async push(collection, item) {
      if (!supabase) return false;
      const table = TABLE_MAP[collection];
      if (!table) return false;

      try {
        const row = { ...item };
        // camelCase -> snake_case 키 변환
        if (row.senderName) { row.sender_name = row.senderName; delete row.senderName; }
        if (row.employeeId) { row.employee_id = row.employeeId; delete row.employeeId; }
        if (row.employeeName) { row.employee_name = row.employeeName; delete row.employeeName; }
        if (row.eventTitle) { row.event_title = row.eventTitle; delete row.eventTitle; }
        if (row.isToday !== undefined) { row.is_today = row.isToday; delete row.isToday; }
        if (row.sellerId) { row.seller_id = row.sellerId; delete row.sellerId; }
        if (row.sellerName) { row.seller_name = row.sellerName; delete row.sellerName; }

        const { error } = await supabase.from(table).insert(row);
        if (error) throw error;
        return true;
      } catch (e) {
        console.error(`[Supabase Push Error] ${collection}:`, e);
        return false;
      }
    },

    // ── 데이터 삭제 ─────────────────────────────────────────────────
    async remove(collection, id) {
      if (!supabase) return false;
      const table = TABLE_MAP[collection];
      if (!table) return false;

      try {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq('id', id);

        if (error) throw error;
        return true;
      } catch (e) {
        console.error(`[Supabase Delete Error] ${collection}:`, e);
        return false;
      }
    }
  };
})();
