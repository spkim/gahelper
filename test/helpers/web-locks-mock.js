// navigator.locks 목. 이름별 FIFO 배타 락. 여러 모듈 인스턴스가 같은 락을 공유하는지 검증하는 데 쓴다.
const queues = new Map();
let original;

function request(name, cb) {
  const tail = queues.get(name) ?? Promise.resolve();
  const run = tail.then(() => cb({ name, mode: "exclusive" }));
  queues.set(name, run.catch(() => {}));
  return run;
}

export function installWebLocksMock() {
  original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { locks: { request } },
    configurable: true,
    writable: true,
  });
  queues.clear();
}

export function uninstallWebLocksMock() {
  if (original) Object.defineProperty(globalThis, "navigator", original);
  else delete globalThis.navigator;
  original = undefined;
}
