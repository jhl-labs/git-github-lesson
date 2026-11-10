/** localStorage 래퍼 — 시크릿 모드 등에서 저장소가 막혀도 사이트가 동작하도록 예외를 삼킨다. */
const PREFIX = 'gitlesson:';

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* 저장 실패는 학습 진행에 치명적이지 않으므로 무시 */
    }
  },
};
