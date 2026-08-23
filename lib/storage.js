const KEY = "sc.settings";

const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  providers: [],
  activeProviderId: null,
});

function clone(settings) {
  return {
    version: settings.version ?? 1,
    providers: (settings.providers ?? []).map((p) => ({ ...p })),
    activeProviderId: settings.activeProviderId ?? null,
  };
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(KEY);
  return clone(stored[KEY] ?? DEFAULT_SETTINGS);
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [KEY]: clone(settings) });
}

export async function upsertProvider(provider) {
  const settings = await getSettings();
  const idx = settings.providers.findIndex((p) => p.id === provider.id);
  if (idx >= 0) settings.providers[idx] = { ...provider };
  else settings.providers.push({ ...provider });
  if (!settings.activeProviderId) settings.activeProviderId = provider.id;
  await saveSettings(settings);
  return settings;
}

export async function deleteProvider(providerId) {
  const settings = await getSettings();
  settings.providers = settings.providers.filter((p) => p.id !== providerId);
  if (settings.activeProviderId === providerId) {
    settings.activeProviderId = settings.providers[0]?.id ?? null;
  }
  await saveSettings(settings);
  return settings;
}

export async function setActiveProvider(providerId) {
  const settings = await getSettings();
  if (!settings.providers.some((p) => p.id === providerId)) {
    throw new Error("존재하지 않는 공급자입니다.");
  }
  settings.activeProviderId = providerId;
  await saveSettings(settings);
  return settings;
}

export function getActiveProvider(settings) {
  if (!settings?.activeProviderId) return null;
  return settings.providers.find((p) => p.id === settings.activeProviderId) ?? null;
}

export function onSettingsChanged(handler) {
  const listener = (changes, area) => {
    if (area !== "local" || !(KEY in changes)) return;
    handler(clone(changes[KEY].newValue ?? DEFAULT_SETTINGS));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
