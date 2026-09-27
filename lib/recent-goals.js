// chrome.storage.local 에 최근 사용 goalText 최대 5개 보관.
const KEY = "recent_goals";
const MAX = 5;

export async function addRecentGoal(text) {
  if (!text?.trim()) return;
  try {
    const data = await chrome.storage.local.get(KEY);
    const prev = Array.isArray(data[KEY]) ? data[KEY] : [];
    const updated = [text, ...prev.filter((t) => t !== text)].slice(0, MAX);
    await chrome.storage.local.set({ [KEY]: updated });
  } catch {}
}

export async function getRecentGoals() {
  try {
    const data = await chrome.storage.local.get(KEY);
    return Array.isArray(data[KEY]) ? data[KEY] : [];
  } catch {
    return [];
  }
}
