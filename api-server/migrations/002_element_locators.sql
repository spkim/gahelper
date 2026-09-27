-- 블로거툴 + Setup Copilot 공유: structural_hash 기반 요소 로케이터 크라우드소싱
-- structural_hash 는 page_snapshots 와 동일한 알고리즘(signature.js)으로 생성됨.
-- 두 확장이 같은 페이지를 방문하면 동일한 hash 를 공유하므로 데이터가 자동 합산된다.

CREATE TABLE IF NOT EXISTS element_locators (
  locator_id       BIGSERIAL PRIMARY KEY,
  structural_hash  TEXT        NOT NULL,
  service          TEXT        NOT NULL CHECK (service IN ('gsc','naver','bing')),
  element_key      TEXT        NOT NULL,            -- url_input | prop | req_btn | ...
  locator          JSONB       NOT NULL,            -- {by:'labelText', text:'URL 검사'} 등
  hits             INT         NOT NULL DEFAULT 1,
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (structural_hash, element_key, locator)
);

CREATE INDEX IF NOT EXISTS idx_locators_hash_key
  ON element_locators(structural_hash, element_key);

COMMENT ON TABLE element_locators IS
  '여러 사용자의 요소 발견 기록을 집계하여 canonical 로케이터를 선출.
   hits 가 가장 높은 행이 해당 hash+key 의 canonical 로케이터로 사용된다.';
