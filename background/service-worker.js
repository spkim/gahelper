chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.error("[setup-copilot] setPanelBehavior 실패", err);
  }

  if (reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});
