(() => {
  if (window.__scProbe) return;
  window.__scProbe = true;

  const TEXT_LIMIT = 200;
  const OVERLAY_ID = "__sc-highlight-overlay";
  const OVERLAY_MS = 2000;
  const WAIT_MS = 5000;

  // ---------- scrub (§5.3 + §R4.6) ----------
  // 반환 직전 content script 내부에서만 수행. 원본 텍스트가 경계를 넘지 않도록.
  const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  const PHONE_RE = /(?<!\d)(?:\+?\d[\d\s\-().]{7,}\d)(?!\d)/g;
  const TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
  // {handle}.tistory.com 등 블로그/뉴스레터 호스트의 서브도메인.
  const HOST_HANDLE_RE = /(https?:\/\/)([\w-]+)\.((?:tistory|blogspot|blogger|medium|substack|notion|linktr|wordpress|hashnode|dev|ghost)\.[\w.]+)/g;
  const AT_HANDLE_RE = /(\/@)[\w.-]+/g;
  const USER_PATH_RE = /(\/(?:users?|u|profile|account|member|owner|by)\/)[\w.-]+/g;

  // §R4.6 — 서비스별 접두사 패턴. lib/scrub.js 와 반드시 동기화할 것.
  const SECRET_PATTERNS = [
    /sk-ant-[A-Za-z0-9_-]{10,}/g,    // Anthropic
    /sk-[A-Za-z0-9_-]{20,}/g,        // OpenAI 계열
    /ntn_[A-Za-z0-9]{20,}/g,         // Notion
    /secret_[A-Za-z0-9]{20,}/g,      // Notion (구형)
    /gh[pousr]_[A-Za-z0-9]{20,}/g,   // GitHub
    /xox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
    /AIza[0-9A-Za-z_-]{30,}/g,       // Google API key
  ];

  function shannonEntropy(s) {
    if (!s) return 0;
    const freq = {};
    for (const c of s) freq[c] = (freq[c] || 0) + 1;
    const len = s.length;
    return Object.values(freq).reduce((sum, f) => {
      const p = f / len;
      return sum - p * Math.log2(p);
    }, 0);
  }

  function looksLikeToken(s) {
    return (
      /^[A-Za-z0-9_\-.]{24,}$/.test(s) &&
      /[A-Z]/.test(s) &&
      /[a-z]/.test(s) &&
      /[0-9]/.test(s) &&
      shannonEntropy(s) > 3.5
    );
  }

  function scrubText(input, limit = TEXT_LIMIT) {
    if (input == null) return "";
    let s = String(input);
    s = s.replace(EMAIL_RE, "***@***");
    s = s.replace(PHONE_RE, "***");
    // 접두사 패턴(§R4.6) — TOKEN_RE 보다 먼저 적용해 짧은 키도 잡는다.
    for (const re of SECRET_PATTERNS) {
      re.lastIndex = 0;
      s = s.replace(re, "[secret]");
    }
    s = s.replace(/\S+/g, (m) => (looksLikeToken(m) ? "[secret]" : m));
    s = s.replace(TOKEN_RE, "***");
    s = s.replace(HOST_HANDLE_RE, "$1***.$3");
    s = s.replace(AT_HANDLE_RE, "$1***");
    s = s.replace(USER_PATH_RE, "$1***");
    if (limit > 0 && s.length > limit) s = s.slice(0, limit);
    return s;
  }

  function scrubUrl(u) {
    // URL 은 자르지 않는다 — verify.urlIncludes 매칭에 필요.
    return scrubText(u, 0);
  }

  // ---------- 텍스트 정규화 ----------
  function normalize(t) {
    return String(t ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function includesNormalized(haystack, needle) {
    const h = normalize(haystack).toLowerCase();
    const n = normalize(needle).toLowerCase();
    if (!n) return false;
    return h.includes(n);
  }

  function matchControl(el, control) {
    if (!control) return true;
    const tag = el.tagName;
    if (control === "select") return tag === "SELECT";
    if (control === "textarea") return tag === "TEXTAREA";
    if (control === "checkbox") return tag === "INPUT" && el.type === "checkbox";
    if (control === "input") return tag === "INPUT" && el.type !== "checkbox";
    return true;
  }

  // ---------- 로케이터 해석 ----------
  function findByLabelText(text, control) {
    const labels = Array.from(document.querySelectorAll("label"));
    for (const label of labels) {
      if (!includesNormalized(label.textContent, text)) continue;

      const forId = label.getAttribute("for");
      if (forId) {
        const target = document.getElementById(forId);
        if (target && matchControl(target, control)) return target;
      }

      const inside = label.querySelector("input, select, textarea");
      if (inside && matchControl(inside, control)) return inside;

      let sibling = label.nextElementSibling;
      let hops = 0;
      while (sibling && hops < 5) {
        const cand = sibling.matches?.("input, select, textarea")
          ? sibling
          : sibling.querySelector?.("input, select, textarea");
        if (cand && matchControl(cand, control)) return cand;
        sibling = sibling.nextElementSibling;
        hops++;
      }

      const parent = label.parentElement;
      if (parent) {
        const inParent = parent.querySelector("input, select, textarea");
        if (inParent && matchControl(inParent, control)) return inParent;
      }
    }
    return null;
  }

  function findLink(text) {
    const links = Array.from(document.querySelectorAll("a"));
    return links.find((a) => includesNormalized(a.textContent, text)) ?? null;
  }

  function findButton(text) {
    const btns = Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="submit"], input[type="button"]',
      ),
    );
    return (
      btns.find((b) => {
        const t = b.tagName === "INPUT" ? b.value : b.textContent;
        return includesNormalized(t, text);
      }) ?? null
    );
  }

  function findByText(text) {
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    let best = null;
    let bestSize = Infinity;
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (!includesNormalized(el.textContent, text)) continue;
      const size = (el.textContent ?? "").length;
      if (size < bestSize) {
        best = el;
        bestSize = size;
      }
    }
    return best;
  }

  function resolveLocator(locator) {
    if (!locator || typeof locator !== "object") return null;
    switch (locator.by) {
      case "css": {
        // v2 §7.3 은 css 로케이터를 guard 에서 차단하지만, 방어를 위해 여기서도 지원만.
        try { return document.querySelector(locator.selector) ?? null; }
        catch { return null; }
      }
      case "labelText": return findByLabelText(locator.text, locator.control);
      case "linkText":  return findLink(locator.text);
      case "buttonText":return findButton(locator.text);
      case "textPresent": return findByText(locator.text);
      case "urlIncludes": return null;
      default: return null;
    }
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  // 민감 컨트롤은 어떤 경로로도 반환하지 않는다.
  function isSensitiveInput(el) {
    if (!el || el.tagName !== "INPUT") return false;
    const type = String(el.type ?? "").toLowerCase();
    if (type === "password") return true;
    const auto = String(el.getAttribute("autocomplete") ?? "").toLowerCase();
    if (auto.startsWith("cc-")) return true;
    const name = String(el.getAttribute("name") ?? "").toLowerCase();
    if (name.includes("card")) return true;
    return false;
  }

  function describeElement(el) {
    const info = {
      tag: el.tagName.toLowerCase(),
      visible: isVisible(el),
      disabled: !!el.disabled,
    };
    if ("type" in el && el.type) info.type = String(el.type);

    if (isSensitiveInput(el)) {
      // 값·텍스트 제외. found 여부만 남긴다.
      return info;
    }

    if (el.tagName === "SELECT") {
      const opt = el.options?.[el.selectedIndex];
      info.value = scrubText(normalize(opt?.textContent ?? el.value ?? ""));
    } else if (el.tagName === "INPUT" && el.type === "checkbox") {
      info.checked = !!el.checked;
    } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      info.value = scrubText(String(el.value ?? ""));
    }

    const raw = normalize(el.textContent ?? "");
    if (raw) info.text = scrubText(raw);
    return info;
  }

  function probeOne(locator) {
    if (locator?.by === "urlIncludes") {
      const hit = includesNormalized(location.href, locator.text);
      return { found: hit };
    }
    const el = resolveLocator(locator);
    if (!el) return { found: false };
    return { found: true, ...describeElement(el) };
  }

  function probeOnce(locators) {
    const found = {};
    for (const [key, locator] of Object.entries(locators || {})) {
      found[key] = probeOne(locator);
    }
    return {
      url: scrubUrl(location.href),
      title: scrubText(document.title, 0),
      found,
    };
  }

  async function probeWithWait(locators) {
    let result = probeOnce(locators);
    const missing = () => Object.values(result.found).some((v) => !v.found);
    if (!missing()) return result;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      };
      const observer = new MutationObserver(() => {
        result = probeOnce(locators);
        if (!missing()) finish();
      });
      observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, characterData: true,
      });
      const timer = setTimeout(finish, WAIT_MS);
    });

    return result;
  }

  // ---------- 하이라이트 ----------
  function showOverlay(el) {
    document.getElementById(OVERLAY_ID)?.remove();
    const rect = el.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      left: `${rect.left - 4}px`, top: `${rect.top - 4}px`,
      width: `${rect.width + 8}px`, height: `${rect.height + 8}px`,
      border: "3px solid #1B5FA8", borderRadius: "6px",
      boxShadow: "0 0 0 4px rgba(27, 95, 168, 0.25)",
      pointerEvents: "none", zIndex: "2147483647",
      transition: "opacity 300ms ease", opacity: "1",
    });
    document.documentElement.appendChild(overlay);
    setTimeout(() => {
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 320);
    }, OVERLAY_MS);
  }

  async function highlight(locator) {
    const el = resolveLocator(locator);
    if (!el) return { ok: false };
    try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {}
    await new Promise((r) => setTimeout(r, 200));
    showOverlay(el);
    return { ok: true };
  }

  // ---------- signature (§5.1, §5.3) ----------
  const SIG_MAX = 200;
  const SIG_TAGS = new Set([
    "input", "select", "textarea", "button",
    "a", "label", "h1", "h2", "h3", "h4", "summary",
  ]);
  const SIG_ROLES = new Set(["button", "tab", "menuitem", "switch"]);
  const CONTENT_SKIP_SELECTOR =
    'article, [role="article"], .post-content, .article-content, .entry-content, ' +
    '[contenteditable="true"], [contenteditable=""], .ProseMirror, .ql-editor, ' +
    '.post-body, .post-list, .article-list';
  const SCOPE_SELECTORS = ['main', '[role="main"]', 'form', '#content', '#main', 'body'];

  function findScope() {
    for (const sel of SCOPE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body ?? document.documentElement;
  }

  function inSkippedRegion(el) {
    return !!el.closest?.(CONTENT_SKIP_SELECTOR);
  }

  function nearestLabelTexts(el, limit = 3) {
    const labels = [];
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) labels.push(normalize(l.textContent).slice(0, 80));
      } catch {}
    }
    const parent = el.parentElement;
    if (parent) {
      const l = parent.querySelector?.("label");
      if (l) labels.push(normalize(l.textContent).slice(0, 80));
    }
    const labelledby = el.getAttribute?.("aria-labelledby");
    if (labelledby) {
      for (const id of labelledby.split(/\s+/)) {
        const r = document.getElementById(id);
        if (r) labels.push(normalize(r.textContent).slice(0, 80));
      }
    }
    // 중복 제거
    const seen = new Set();
    const out = [];
    for (const t of labels) {
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= limit) break;
    }
    return out;
  }

  function describeSigNode(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute?.("role") || undefined;
    const ariaLabelRaw = el.getAttribute?.("aria-label") || undefined;
    let raw = "";
    if (tag === "input") {
      raw = normalize(el.getAttribute("placeholder") ?? el.getAttribute("name") ?? "");
    } else if (tag === "select") {
      raw = normalize(el.getAttribute("name") ?? "");
    } else {
      raw = normalize(el.textContent ?? "");
    }
    const near = nearestLabelTexts(el).map((t) => scrubText(t, 80));
    return {
      tag,
      role,
      ariaLabel: ariaLabelRaw ? scrubText(ariaLabelRaw, TEXT_LIMIT) : undefined,
      text: scrubText(raw),
      nearLabels: near,
    };
  }

  function captureSignature() {
    const scope = findScope();
    const out = [];
    const seen = new Set();
    const nodes = scope.querySelectorAll(
      'input, select, textarea, button, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], a, label, h1, h2, h3, h4, summary'
    );
    for (const el of nodes) {
      if (out.length >= SIG_MAX) break;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute?.("role");
      const roleAllowed = role && SIG_ROLES.has(role.toLowerCase());
      if (!SIG_TAGS.has(tag) && !roleAllowed) continue;
      if (isSensitiveInput(el)) continue;
      if (inSkippedRegion(el)) continue;
      if (!isVisible(el)) continue;
      const desc = describeSigNode(el);
      // 텍스트도 라벨도 없는 순수 장식은 지문에서 뺀다 (폼 컨트롤은 예외).
      if (
        !desc.text && !desc.ariaLabel && !desc.nearLabels.length &&
        desc.tag !== "input" && desc.tag !== "select" && desc.tag !== "textarea"
      ) continue;
      const key = `${desc.tag}|${desc.role ?? ""}|${desc.ariaLabel ?? ""}|${desc.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(desc);
    }
    return {
      url: scrubUrl(location.href),
      title: scrubText(document.title, 0),
      signature: out,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg?.cmd === "probe") {
          sendResponse(await probeWithWait(msg.locators ?? {}));
        } else if (msg?.cmd === "highlight") {
          sendResponse(await highlight(msg.locator));
        } else if (msg?.cmd === "signature") {
          sendResponse(captureSignature());
        } else {
          sendResponse({ error: "unknown cmd" });
        }
      } catch (err) {
        sendResponse({ error: String(err?.message ?? err) });
      }
    })();
    return true;
  });
})();
