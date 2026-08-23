const PROBEABLE_PROTOCOLS = new Set(["http:", "https:", "file:"]);

export function isProbeableUrl(url) {
  if (!url) return false;
  try {
    return PROBEABLE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function originPatternFor(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/*`;
}

export async function hasOriginPermission(url) {
  return chrome.permissions.contains({ origins: [originPatternFor(url)] });
}

export async function requestOriginPermission(url) {
  return chrome.permissions.request({ origins: [originPatternFor(url)] });
}

export async function injectProbe(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content/probe.js"],
  });
}

async function send(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await injectProbe(tabId);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

export async function probe(tabId, locators) {
  return send(tabId, { cmd: "probe", locators });
}

export async function highlight(tabId, locator) {
  return send(tabId, { cmd: "highlight", locator });
}

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}
