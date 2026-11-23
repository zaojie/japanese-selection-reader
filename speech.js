export const TITLE = "日语朗读";
export const MENU_ID = "read-japanese";
export const NO_VOICE = "未找到本机日语语音。请安装系统日语语音后，重启浏览器。";

export function selectJapaneseVoice(voices) {
  return voices.find((voice) => /^ja(?:[-_]|$)/i.test(voice.lang ?? "") && voice.remote !== true);
}

export function validateText(selection) {
  const text = typeof selection === "string" ? selection.trim() : "";
  if (!text) throw new Error("请先选中需要朗读的日语文字。");
  if (text.length > 32768) throw new Error("选中文字过长，请分段朗读（每段最多 32,768 字符）。");
  return text;
}
