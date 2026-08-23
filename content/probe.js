(() => {
  if (window.__scProbe) return;
  window.__scProbe = true;

  const TEXT_LIMIT = 200;
  const OVERLAY_ID = "__sc-highlight-overlay";
  const OVERLAY_MS = 2000;
  const WAIT_MS = 5000;

  function normalize(t) {
    return String(t ?? "").replace(/\s+/g, " ").trim();
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
        try {
          return document.querySelector(locator.selector) ?? null;
        } catch {
          return null;
        }
      }
      case "labelText":
        return findByLabelText(locator.text, locator.control);
      case "linkText":
        return findLink(locator.text);
      case "buttonText":
        return findButton(locator.text);
      case "textPresent":
        return findByText(locator.text);
      case "urlIncludes":
        return null;
      default:
        return null;
    }
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function describeElement(el) {
    const info = {
      tag: el.tagName.toLowerCase(),
      visible: isVisible(el),
      disabled: !!el.disabled,
    };
    if ("type" in el && el.type) info.type = String(el.type);

    if (el.tagName === "SELECT") {
      const opt = el.options?.[el.selectedIndex];
      info.value = normalize(opt?.textContent ?? el.value ?? "");
    } else if (el.tagName === "INPUT" && el.type === "checkbox") {
      info.checked = !!el.checked;
    } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      info.value = String(el.value ?? "");
    }

    const raw = normalize(el.textContent ?? "");
    if (raw) info.text = raw.slice(0, TEXT_LIMIT);

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
    return { url: location.href, title: document.title, found };
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
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      const timer = setTimeout(finish, WAIT_MS);
    });

    return result;
  }

  function showOverlay(el) {
    document.getElementById(OVERLAY_ID)?.remove();
    const rect = el.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      left: `${rect.left - 4}px`,
      top: `${rect.top - 4}px`,
      width: `${rect.width + 8}px`,
      height: `${rect.height + 8}px`,
      border: "3px solid #1B5FA8",
      borderRadius: "6px",
      boxShadow: "0 0 0 4px rgba(27, 95, 168, 0.25)",
      pointerEvents: "none",
      zIndex: "2147483647",
      transition: "opacity 300ms ease",
      opacity: "1",
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
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
    showOverlay(el);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg?.cmd === "probe") {
          sendResponse(await probeWithWait(msg.locators ?? {}));
        } else if (msg?.cmd === "highlight") {
          sendResponse(await highlight(msg.locator));
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
