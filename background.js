import { TITLE, MENU_ID, NO_VOICE, selectJapaneseVoice, validateText } from "./speech.js";

let requestId = 0;

async function showError(message = "") {
  await Promise.all([
    chrome.action.setBadgeText({ text: message ? "!" : "" }),
    chrome.action.setBadgeBackgroundColor({ color: "#b43e34" }),
    chrome.action.setTitle({ title: message ? `${TITLE}：${message}` : TITLE }),
  ]);
}

async function readSelection(selection) {
  const currentRequest = ++requestId;
  try {
    chrome.tts.stop();
    const text = validateText(selection);
    const voice = selectJapaneseVoice(await chrome.tts.getVoices());
    if (currentRequest !== requestId) return;
    if (!voice) throw new Error(NO_VOICE);
    await showError();
    if (currentRequest !== requestId) return;
    await chrome.tts.speak(text, {
      lang: voice.lang.replaceAll("_", "-"),
      voiceName: voice.voiceName,
      ...(voice.extensionId ? { extensionId: voice.extensionId } : {}),
      enqueue: false,
      onEvent(event) {
        if (event.type === "error" && currentRequest === requestId) {
          showError(`朗读失败：${event.errorMessage || "请检查系统语音设置。"}`).catch(console.error);
        }
      },
    });
  } catch (error) {
    if (currentRequest === requestId) await showError(error.message || "朗读失败，请重试。");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      showError(chrome.runtime.lastError.message).catch(console.error);
      return;
    }
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "用日语朗读选中文字",
      contexts: ["selection"],
    }, () => {
      if (chrome.runtime.lastError) showError(chrome.runtime.lastError.message).catch(console.error);
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID) readSelection(info.selectionText).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "stop") return;
  ++requestId;
  chrome.tts.stop();
  showError().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
  return true;
});
