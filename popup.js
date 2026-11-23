import { TITLE, NO_VOICE, selectJapaneseVoice } from "./speech.js";

const voiceLabel = document.querySelector("#voice");
const errorLabel = document.querySelector("#error");

async function refreshStatus() {
  try {
    const [voices, title] = await Promise.all([chrome.tts.getVoices(), chrome.action.getTitle({})]);
    const voice = selectJapaneseVoice(voices);
    voiceLabel.textContent = voice ? `已就绪 · ${voice.voiceName || "本机日语语音"}` : NO_VOICE;
    document.querySelector("#help").hidden = Boolean(voice);
    errorLabel.textContent = title.startsWith(`${TITLE}：`) ? title.slice(TITLE.length + 1) : "";
    errorLabel.hidden = !errorLabel.textContent;
  } catch {
    voiceLabel.textContent = "无法读取语音状态，请重新打开扩展。";
  }
}

document.querySelector("#stop").addEventListener("click", async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: "stop" });
    document.querySelector("#feedback").textContent = result?.ok ? "已停止朗读" : "停止失败，请重试。";
    await refreshStatus();
  } catch {
    document.querySelector("#feedback").textContent = "停止失败，请重试。";
  }
});

refreshStatus();
