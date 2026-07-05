/**
 * ☁️ cloudDB.js — 클라이언트 DB 레이어 (보안 강화 버전)
 *
 * ⚠️ 보안 변경사항:
 *   Supabase URL/Key를 클라이언트에서 완전 제거.
 *   모든 데이터 요청은 서버(/api/db/*)를 통해서만 처리.
 *   서버가 Supabase와 직접 통신 → API 키는 .env에서만 관리.
 *
 * 데이터 흐름:
 *   [Browser] → [서버 /api/db/*] → [Supabase PostgreSQL]
 *                (JWT 인증 통과 시에만 허용)
 */

window.CloudDB = (() => {

  // ── LocalStorage 폴백 (서버 없는 경우) ──────────────────────────────
  function _lsKey(collection) {
    return `oneoffice_ANTIGRAVITY_v1_${collection}`;
  }

  function _lsGet(collection, defaultValue) {
    try {
      const raw = localStorage.getItem(_lsKey(collection));
      return raw ? JSON.parse(raw) : defaultValue;
    } catch { return defaultValue; }
  }

  function _lsSet(collection, data) {
    try {
      localStorage.setItem(_lsKey(collection), JSON.stringify(data));
      return true;
    } catch { return false; }
  }

  function _lsRemove(collection, id) {
    try {
      const data = _lsGet(collection, []);
      if (Array.isArray(data)) {
        const filtered = data.filter(item => item.id !== id);
        _lsSet(collection, filtered);
      }
      return true;
    } catch { return false; }
  }

  // ── 서버 프록시 호출 (JWT 자동 첨부) ────────────────────────────────
  async function _serverCall(method, collection, payload = null) {
    const token = sessionStorage.getItem('oneoffice_jwt');
    if (!token) return null; // 로그인 전 → LocalStorage fallback

    try {
      const opts = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      };
      if (payload && method !== 'GET') opts.body = JSON.stringify(payload);

      const res = await fetch(`/api/db/${collection}`, opts);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null; // 서버 오류 → LocalStorage fallback
    }
  }

  return {
    // ── Read ──────────────────────────────────────────────────────────
    async get(collection, defaultValue = null) {
      // 서버 시도 → 실패 시 LocalStorage fallback
      const serverData = await _serverCall('GET', collection);
      if (serverData?.data !== undefined) return serverData.data;
      return _lsGet(collection, defaultValue);
    },

    // ── Write / Update ────────────────────────────────────────────────
    async set(collection, data) {
      // LocalStorage에 즉시 저장 (오프라인 대응)
      _lsSet(collection, data);
      // 서버에도 비동기 동기화 (실패해도 무시)
      await _serverCall('POST', collection, { data }).catch(() => {});
      return true;
    },

    // ── Push (단일 항목 추가) ─────────────────────────────────────────
    async push(collection, item) {
      const existing = _lsGet(collection, []);
      if (Array.isArray(existing)) {
        existing.push(item);
        _lsSet(collection, existing);
      }
      await _serverCall('PUT', collection, { item }).catch(() => {});
      return true;
    },

    // ── Remove ────────────────────────────────────────────────────────
    async remove(collection, id) {
      _lsRemove(collection, id);
      await _serverCall('DELETE', `${collection}/${id}`).catch(() => {});
      return true;
    },

    // ── 호환성: 클라이언트 (Supabase SDK 없음) ───────────────────────
    client: null,
  };
})();
