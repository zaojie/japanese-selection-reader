import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MENU_ID, NO_VOICE, TITLE, selectJapaneseVoice, validateText } from "../speech.js";

test("只选择本机日语声音，接受地区和语言代码", () => {
  const local = { lang: "ja-JP", voiceName: "Japanese", remote: false };
  assert.equal(selectJapaneseVoice([{ lang: "en-US" }, { lang: "ja-JP", remote: true }, local]), local);
  assert.equal(selectJapaneseVoice([{ lang: "JA_jp" }]).lang, "JA_jp");
  assert.equal(selectJapaneseVoice([{ lang: "ja" }]).lang, "ja");
  assert.equal(selectJapaneseVoice([{ lang: "javanese" }, {}, { lang: "ja-JP", remote: true }]), undefined);
});

test("保留日语文字，拒绝空白、非字符串和超长输入", () => {
  assert.equal(validateText("  日本語\nを読む。 "), "日本語\nを読む。");
  for (const text of [undefined, null, {}, "", " \n\t"]) assert.throws(() => validateText(text), /请先选中/);
  assert.equal(validateText("あ".repeat(32768)).length, 32768);
  assert.throws(() => validateText("あ".repeat(32769)), /过长/);
});

let importId = 0;
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function setup() {
  const listeners = {};
  const calls = { spoken: [], stops: 0, title: TITLE, badge: "", menus: [] };
  const api = {
    runtime: {
      id: "test-extension",
      onInstalled: { addListener(fn) { listeners.install = fn; } },
      onMessage: { addListener(fn) { listeners.message = fn; } },
    },
    contextMenus: {
      removeAll(callback) { calls.menus = []; callback(); },
      create(menu, callback) { calls.menus.push(menu); callback(); },
      onClicked: { addListener(fn) { listeners.click = fn; } },
    },
    action: {
      async setBadgeText({ text }) { calls.badge = text; },
      async setBadgeBackgroundColor() {},
      async setTitle({ title }) { calls.title = title; },
    },
    tts: {
      async getVoices() { return [{ lang: "ja-JP", voiceName: "Local", remote: false }]; },
      stop() { calls.stops++; },
      async speak(text, options) { calls.spoken.push({ text, options }); },
    },
  };
  globalThis.chrome = api;
  await import(`../background.js?test=${++importId}`);
  return { api, listeners, calls };
}

test("右键到语音接口的行为", async (t) => {
  await t.test("安装和更新时重建选区菜单", async () => {
    const { calls, listeners } = await setup();
    listeners.install();
    listeners.install();
    assert.equal(calls.menus.length, 1);
    assert.equal(calls.menus[0].id, MENU_ID);
    assert.deepEqual(calls.menus[0].contexts, ["selection"]);
  });

  await t.test("传递原文、语言和明确语音，重复朗读中断前一段", async () => {
    const { calls, listeners } = await setup();
    listeners.click({ menuItemId: "unrelated", selectionText: "忽略" });
    assert.equal(calls.stops, 0);
    listeners.click({ menuItemId: MENU_ID, selectionText: "  こんにちは。  " });
    await settle();
    listeners.click({ menuItemId: MENU_ID, selectionText: "次の文章。" });
    await settle();
    assert.equal(calls.stops, 2);
    assert.deepEqual(calls.spoken.map(({ text }) => text), ["こんにちは。", "次の文章。"]);
    assert.equal(calls.spoken[0].options.lang, "ja-JP");
    assert.equal(calls.spoken[0].options.voiceName, "Local");
    assert.equal(calls.spoken[0].options.enqueue, false);
    assert.equal(calls.badge, "");
  });

  await t.test("缺少本机日语语音时展示错误且不发声", async () => {
    const { api, calls, listeners } = await setup();
    api.tts.getVoices = async () => [{ lang: "en-US" }, { lang: "ja-JP", remote: true }];
    listeners.click({ menuItemId: MENU_ID, selectionText: "日本語" });
    await settle();
    assert.equal(calls.spoken.length, 0);
    assert.equal(calls.badge, "!");
    assert.ok(calls.title.includes(NO_VOICE));
  });

  await t.test("无效输入不调用引擎", async () => {
    const { calls, listeners } = await setup();
    listeners.click({ menuItemId: MENU_ID, selectionText: "あ".repeat(32769) });
    await settle();
    assert.equal(calls.spoken.length, 0);
    assert.match(calls.title, /过长/);
  });

  await t.test("引擎调用拒绝和异步错误均可见，成功后清除错误", async () => {
    const { api, calls, listeners } = await setup();
    const speak = api.tts.speak;
    api.tts.speak = async () => { throw new Error("引擎不可用"); };
    listeners.click({ menuItemId: MENU_ID, selectionText: "日本語" });
    await settle();
    assert.match(calls.title, /引擎不可用/);
    api.tts.speak = speak;
    listeners.click({ menuItemId: MENU_ID, selectionText: "日本語" });
    await settle();
    assert.equal(calls.title, TITLE);
    calls.spoken[0].options.onEvent({ type: "error", errorMessage: "播放失败" });
    await settle();
    assert.match(calls.title, /播放失败/);
  });

  await t.test("只执行最新请求，忽略被替换语音的迟到错误", async () => {
    const { api, calls, listeners } = await setup();
    let resolveFirst;
    const getVoices = api.tts.getVoices;
    api.tts.getVoices = () => new Promise((resolve) => { resolveFirst = resolve; });
    listeners.click({ menuItemId: MENU_ID, selectionText: "前" });
    api.tts.getVoices = getVoices;
    listeners.click({ menuItemId: MENU_ID, selectionText: "後" });
    await settle();
    resolveFirst(await getVoices());
    await settle();
    assert.deepEqual(calls.spoken.map(({ text }) => text), ["後"]);
    const oldEvent = calls.spoken[0].options.onEvent;
    listeners.click({ menuItemId: MENU_ID, selectionText: "新しい文章" });
    await settle();
    oldEvent({ type: "error", errorMessage: "旧错误" });
    await settle();
    assert.equal(calls.title, TITLE);
  });

  await t.test("停止同时取消尚未完成的语音查询", async () => {
    const { api, calls, listeners } = await setup();
    let resolveVoices;
    api.tts.getVoices = () => new Promise((resolve) => { resolveVoices = resolve; });
    listeners.click({ menuItemId: MENU_ID, selectionText: "日本語" });
    const response = await new Promise((resolve) => {
      assert.equal(listeners.message({ type: "stop" }, { id: api.runtime.id }, resolve), true);
    });
    assert.deepEqual(response, { ok: true });
    resolveVoices([{ lang: "ja-JP", voiceName: "Local" }]);
    await settle();
    assert.equal(calls.spoken.length, 0);
    assert.equal(calls.stops, 2);
    assert.equal(listeners.message({ type: "stop" }, { id: "other" }, () => {}), undefined);
  });
});

test("扩展入口完整且权限仅包含右键菜单和语音", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url)));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["contextMenus", "tts"]);
  assert.equal(manifest.host_permissions, undefined);
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, "popup.css", "popup.js", "speech.js"]) {
    assert.ok((await readFile(new URL(`../${file}`, import.meta.url))).length > 0);
  }
});
