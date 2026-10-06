// chrome.storage 테스트 목. session·local·onChanged를 실제 확장 API처럼 흉내 낸다.
// - 값은 JSON 복제로 저장·반환한다(참조 공유로 테스트가 우연히 통과하는 일을 막는다).
// - 읽고 쓰는 `local`을 제공한다(evallog 테스트가 필요로 한다).
// 테스트 파일 하나당 프로세스 하나(node --test)라 globalThis.chrome 설치가 서로 간섭하지 않는다.

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function makeArea(areaName, emit) {
  let data = {};

  function change(key, nextValue, hadKey) {
    const entry = {};
    if (hadKey) entry.oldValue = clone(data[key]);
    if (nextValue !== undefined) entry.newValue = clone(nextValue);
    return entry;
  }

  return {
    async get(keys) {
      if (keys === null || keys === undefined) return clone(data);
      const out = {};
      if (typeof keys === "string") {
        if (keys in data) out[keys] = clone(data[keys]);
        return out;
      }
      if (Array.isArray(keys)) {
        for (const k of keys) if (k in data) out[k] = clone(data[k]);
        return out;
      }
      for (const [k, fallback] of Object.entries(keys)) {
        out[k] = k in data ? clone(data[k]) : clone(fallback);
      }
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = change(k, v, k in data);
        if (v === undefined) delete data[k];
        else data[k] = clone(v);
      }
      emit(changes, areaName);
    },
    async remove(keys) {
      const changes = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (!(k in data)) continue;
        changes[k] = change(k, undefined, true);
        delete data[k];
      }
      emit(changes, areaName);
    },
    async clear() {
      const changes = {};
      for (const k of Object.keys(data)) changes[k] = change(k, undefined, true);
      data = {};
      emit(changes, areaName);
    },
    // 테스트 전용: 이벤트 없이 상태를 직접 넣거나 덤프한다.
    seed(obj) {
      for (const [k, v] of Object.entries(obj)) data[k] = clone(v);
    },
    dump() {
      return clone(data);
    },
    _reset() {
      data = {};
    },
  };
}

export function installChromeMock() {
  const listeners = new Set();
  const emit = (changes, areaName) => {
    if (Object.keys(changes).length === 0) return;
    for (const fn of [...listeners]) fn(clone(changes), areaName);
  };
  const session = makeArea("session", emit);
  const local = makeArea("local", emit);
  const onChanged = {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    hasListener: (fn) => listeners.has(fn),
  };

  globalThis.chrome = { storage: { session, local, onChanged } };

  return {
    session,
    local,
    onChanged,
    // session·local을 모두 비운다(이벤트 없음). 리스너는 유지한다.
    reset() {
      session._reset();
      local._reset();
    },
  };
}
