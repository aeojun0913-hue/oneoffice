/**
 * ☁️ cloudDB.js — SaaS 핵심 모듈 1: LocalStorage 클라우드 DB 추상화
 *
 * 목적: 브라우저의 LocalStorage를 임시 클라우드 DB로 활용하여
 *       새로고침/창닫기 후에도 데이터를 100% 보존합니다.
 *       테넌트별 네임스페이스 분리로 멀티테넌트 SaaS 구조를 시뮬레이션합니다.
 *
 * 사용법:
 *   CloudDB.get('employees')          → 직원 배열 읽기
 *   CloudDB.set('employees', [...])   → 저장
 *   CloudDB.push('calendarEvents', {})→ 배열에 항목 추가
 *
 * 클라우드 배포 시:
 *   이 모듈을 실제 Firestore/DynamoDB SDK로 교체하면 됩니다.
 *   인터페이스(API 시그니처)는 그대로 유지됩니다.
 */

window.CloudDB = (() => {
  // ── 테넌트 설정 (SaaS 멀티테넌트 시뮬레이션) ──────────────────────
  const TENANT_ID = 'ANTIGRAVITY'; // 🏢 회사(테넌트) 고유 식별자
  const VERSION   = 'v1';          // 스키마 버전 (마이그레이션 대비)

  /** 컬렉션명 → LocalStorage 키 변환 */
  function _key(collection) {
    return `oneoffice_${TENANT_ID}_${VERSION}_${collection}`;
  }

  /** 현재 타임스탬프 ISO 문자열 */
  function _now() {
    return new Date().toISOString();
  }

  return {
    // ── Read ──────────────────────────────────────────────────────────
    get(collection, defaultValue = null) {
      try {
        const raw = localStorage.getItem(_key(collection));
        return raw !== null ? JSON.parse(raw) : defaultValue;
      } catch (e) {
        console.warn(`[CloudDB] get("${collection}") 파싱 실패:`, e);
        return defaultValue;
      }
    },

    // ── Write ─────────────────────────────────────────────────────────
    set(collection, data) {
      try {
        localStorage.setItem(_key(collection), JSON.stringify(data));
        return true;
      } catch (e) {
        console.error(`[CloudDB] set("${collection}") 저장 실패 (용량 초과?):`, e);
        return false;
      }
    },

    merge(collection, updates) {
      const existing = this.get(collection, {});
      return this.set(collection, { ...existing, ...updates });
    },

    // ── Array Operations ───────────────────────────────────────────────
    push(collection, item) {
      const arr = this.get(collection, []);
      arr.push(item);
      return this.set(collection, arr);
    },

    prepend(collection, item) {
      const arr = this.get(collection, []);
      arr.unshift(item);
      return this.set(collection, arr);
    },

    remove(collection, id) {
      const arr = this.get(collection, []);
      return this.set(collection, arr.filter(i => String(i.id) !== String(id)));
    },

    update(collection, id, updates) {
      const arr = this.get(collection, []);
      const idx = arr.findIndex(i => String(i.id) === String(id));
      if (idx === -1) return false;
      arr[idx] = { ...arr[idx], ...updates, updatedAt: _now() };
      return this.set(collection, arr);
    },

    // ── Tenant Management ──────────────────────────────────────────────
    clearTenant() {
      const prefix = `oneoffice_${TENANT_ID}_`;
      Object.keys(localStorage)
        .filter(k => k.startsWith(prefix))
        .forEach(k => localStorage.removeItem(k));
      console.info(`[CloudDB] 테넌트 ${TENANT_ID} 데이터 초기화 완료`);
    },

    listKeys() {
      const prefix = `oneoffice_${TENANT_ID}_${VERSION}_`;
      return Object.keys(localStorage)
        .filter(k => k.startsWith(prefix))
        .map(k => k.replace(prefix, ''));
    },

    debug() {
      const keys = this.listKeys();
      console.group(`[CloudDB] 테넌트: ${TENANT_ID} | 저장된 컬렉션: ${keys.length}개`);
      keys.forEach(key => {
        const val = this.get(key);
        console.log(`  ${key}:`, Array.isArray(val) ? `[Array(${val.length})]` : val);
      });
      console.groupEnd();
    },

    TENANT_ID,
    VERSION,
  };
})();
