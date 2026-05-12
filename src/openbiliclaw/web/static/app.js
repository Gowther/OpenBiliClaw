const API_BASE = "/api";
const THEME_STORAGE_KEY = "openbiliclaw.web.themeMode";
const THEME_MODES = ["auto", "dark", "light"];

const state = {
  online: false,
  runtime: null,
  recommendations: [],
  profile: null,
  cognitionItems: [],
  cognitionCursor: "",
  cognitionHasMore: false,
  activityItems: [],
  activityCursor: "",
  activityHasMore: false,
  delights: [],
  delightIndex: 0,
  messages: [],
  sourceFilter: "bilibili",
  chatBusy: false,
  lastStreamEvent: "",
  themeMode: "auto",
};

const $ = (id) => document.getElementById(id);

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return "";
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Theme preference is non-critical.
  }
}

function utc8Hour(date = new Date()) {
  return (date.getUTCHours() + 8) % 24;
}

function isUtc8Night(date = new Date()) {
  const hour = utc8Hour(date);
  return hour >= 18 || hour < 6;
}

function resolveTheme(mode = state.themeMode, date = new Date()) {
  if (mode === "dark" || mode === "light") return mode;
  return isUtc8Night(date) ? "dark" : "light";
}

function themeLabel(mode = state.themeMode) {
  if (mode === "dark") return "夜间";
  if (mode === "light") return "日间";
  return resolveTheme(mode) === "dark" ? "自动·夜" : "自动·日";
}

function applyTheme() {
  const resolved = resolveTheme();
  document.documentElement.dataset.theme = resolved;
  const button = $("themeToggleButton");
  if (!button) return;
  button.textContent = themeLabel();
  button.title = "主题：自动按 UTC+8 18:00-05:59 进入夜间";
  button.setAttribute("aria-pressed", resolved === "dark" ? "true" : "false");
}

function setThemeMode(mode, { persist = true } = {}) {
  state.themeMode = THEME_MODES.includes(mode) ? mode : "auto";
  if (persist) storageSet(THEME_STORAGE_KEY, state.themeMode);
  applyTheme();
}

function cycleThemeMode() {
  const currentIndex = THEME_MODES.indexOf(state.themeMode);
  const next = THEME_MODES[(currentIndex + 1) % THEME_MODES.length] || "auto";
  setThemeMode(next);
}

function initTheme() {
  setThemeMode(storageGet(THEME_STORAGE_KEY) || "auto", { persist: false });
  window.setInterval(() => {
    if (state.themeMode === "auto") applyTheme();
  }, 60_000);
}

function node(tag, className = "", text = "") {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function text(value, fallback = "") {
  const valueText = String(value ?? "").trim();
  return valueText || fallback;
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0%";
  return `${Math.round(Math.max(0, Math.min(1, number)) * 100)}%`;
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    throw new Error(`${path} ${response.status}`);
  }
  return response.json();
}

function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    box.hidden = true;
  }, 3200);
}

function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent || "";
    button.textContent = busyText;
    button.disabled = true;
    return;
  }
  button.textContent = button.dataset.originalText || button.textContent || "";
  button.disabled = false;
}

function sourceLabel(platform) {
  const key = String(platform || "bilibili").toLowerCase();
  return { bilibili: "B 站", xiaohongshu: "小红书", douyin: "抖音" }[key] || key;
}

function buildContentUrl(item) {
  if (item.content_url) return item.content_url;
  if (item.bvid) return `https://www.bilibili.com/video/${encodeURIComponent(item.bvid)}`;
  return "";
}

function isBilibiliImageUrl(url) {
  return Boolean(normalizeBilibiliImageUrl(url));
}

function normalizeBilibiliImageUrl(rawUrl) {
  let url = String(rawUrl || "").trim();
  if (!url) return "";
  if (url.startsWith("//")) {
    url = `${window.location.protocol}${url}`;
  } else if (/^[a-z0-9.-]+\.(hdslb|biliimg)\.com\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isBilibiliImage =
      host === "hdslb.com" ||
      host.endsWith(".hdslb.com") ||
      host === "biliimg.com" ||
      host.endsWith(".biliimg.com");
    return isBilibiliImage ? parsed.href : "";
  } catch {
    return "";
  }
}

function coverImageSrc(item) {
  const url = normalizeBilibiliImageUrl(item.cover_url);
  if (url) {
    return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
  }
  const rawUrl = String(item.cover_url || "").trim();
  return rawUrl || "";
}

function patchBilibiliImageSrc(img) {
  const url = normalizeBilibiliImageUrl(img.currentSrc || img.src);
  if (!url) return "";
  const proxied = `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
  if (img.getAttribute("src") !== proxied) {
    img.src = proxied;
  }
  return proxied;
}

function patchBilibiliImages(root = document) {
  const images = [];
  if (root instanceof HTMLImageElement) {
    images.push(root);
  }
  if (typeof root.querySelectorAll === "function") {
    images.push(...root.querySelectorAll("img"));
  }
  for (const img of images) {
    patchBilibiliImageSrc(img);
  }
}

function watchBilibiliImageLinks() {
  patchBilibiliImages();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLImageElement) {
        patchBilibiliImageSrc(record.target);
      }
      for (const added of record.addedNodes) {
        if (added instanceof Element) {
          patchBilibiliImages(added);
        }
      }
    }
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["src"],
    childList: true,
    subtree: true,
  });
}

function formatPool(runtime) {
  if (!runtime) return "0 / 0";
  const available = Number(runtime.pool_available_count || 0);
  const pendingCopy = Number(runtime.pool_pending_copy_count || 0);
  const fresh = Number(runtime.pool_fresh_count || 0);
  const target = Number(runtime.pool_target_count || 0);
  const targetText = target > 0 ? ` / 目标 ${target}` : "";
  return `可换 ${available}${targetText} · 待加工 ${pendingCopy} · fresh ${fresh}`;
}

function renderStatus() {
  $("backendStatus").textContent = state.online ? "已连接" : "离线";
  $("profileStatus").textContent = state.runtime?.initialized ? "已初始化" : "未初始化";
  $("poolStatus").textContent = formatPool(state.runtime);
  $("liveSummary").textContent =
    state.lastStreamEvent ||
    state.runtime?.manual_refresh_message ||
    (state.runtime?.manual_refresh_state === "running" ? "正在补货" : "等待后端事件");
  renderMessageBadge();
}

function renderMessageBadge() {
  const badge = $("messageBadge");
  const count = state.messages.length;
  badge.textContent = count ? String(count) : "";
  badge.hidden = count === 0;
}

function visibleRecommendations() {
  if (state.sourceFilter === "all") return state.recommendations;
  return state.recommendations.filter(
    (item) => String(item.source_platform || "bilibili").toLowerCase() === "bilibili",
  );
}

function renderRecommendations() {
  const list = $("recommendationList");
  clear(list);
  renderDelightSlot();
  const items = visibleRecommendations();
  const hiddenCount = state.recommendations.length - items.length;
  $("recommendHint").textContent =
    hiddenCount > 0
      ? `已隐藏 ${hiddenCount} 条非 B 站内容，可切换查看全部来源。`
      : "优先展示 B 站内容，可切换查看全部来源。";

  if (!items.length) {
    list.appendChild(node("div", "empty-state", "暂无可展示推荐。可以先点“换一批”或等待后台补货。"));
    return;
  }

  for (const item of items) {
    list.appendChild(renderRecommendationCard(item));
  }
}

function renderCover(item, className = "cover") {
  const cover = node("div", className);
  const imageSrc = coverImageSrc(item);
  if (imageSrc) {
    const img = document.createElement("img");
    img.alt = item.title || "封面";
    img.src = imageSrc;
    img.addEventListener("error", () => {
      img.remove();
      cover.classList.add("is-fallback");
      cover.appendChild(node("div", "cover-fallback", "暂无封面"));
    });
    cover.appendChild(img);
  } else {
    cover.classList.add("is-fallback");
    cover.appendChild(node("div", "cover-fallback", "暂无封面"));
  }
  return cover;
}

function renderRecommendationCard(item) {
  const card = node("article", "recommendation-card");
  const cover = renderCover(item, "cover");
  cover.appendChild(node("span", "source-badge", sourceLabel(item.source_platform)));

  const body = node("div", "card-body");
  body.appendChild(node("h3", "card-title", item.title || "未命名内容"));
  body.appendChild(node("div", "meta", item.up_name ? `UP：${item.up_name}` : "UP：未知"));
  if (item.topic_label) {
    body.appendChild(node("div", "topic", item.topic_label));
  }
  if (item.expression) {
    body.appendChild(node("p", "expression", item.expression));
  }

  const actions = node("div", "card-actions");
  const openButton = node("button", "primary-button", "打开");
  openButton.type = "button";
  openButton.addEventListener("click", () => openRecommendation(item));
  const likeButton = node("button", "secondary-button", "喜欢");
  likeButton.type = "button";
  likeButton.addEventListener("click", () => submitFeedback(item, "like"));
  const dislikeButton = node("button", "danger-button", "不喜欢");
  dislikeButton.type = "button";
  dislikeButton.addEventListener("click", () => submitFeedback(item, "dislike"));
  actions.append(openButton, likeButton, dislikeButton);

  const feedbackRow = node("div", "feedback-row");
  const input = document.createElement("input");
  input.placeholder = "补一句原因";
  const commentButton = node("button", "ghost-button", "发一句");
  commentButton.type = "button";
  commentButton.addEventListener("click", () => {
    const note = input.value.trim();
    if (!note) {
      toast("先写一句原因。");
      return;
    }
    submitFeedback(item, "comment", note).then(() => {
      input.value = "";
    });
  });
  feedbackRow.append(input, commentButton);

  body.append(actions, feedbackRow);
  card.append(cover, body);
  return card;
}

async function openRecommendation(item) {
  const url = buildContentUrl(item);
  if (!url) {
    toast("这条推荐还没有可打开的链接。");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
  try {
    await requestJson("/recommendation-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recommendation_id: typeof item.id === "number" ? item.id : null,
        bvid: item.bvid || "",
        title: item.title || "",
        topic_label: item.topic_label || "",
        up_name: item.up_name || "",
      }),
    });
  } catch {
    // Click reporting is best-effort.
  }
}

async function submitFeedback(item, feedbackType, note = "") {
  if (!item.id) {
    toast("这条推荐缺少 recommendation_id。");
    return;
  }
  await requestJson("/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recommendation_id: item.id,
      feedback_type: feedbackType,
      note,
    }),
  });
  toast(feedbackType === "dislike" ? "已记下不喜欢。" : "已记下反馈。");
  await Promise.allSettled([loadProfile(), loadRuntime(), loadActivity({ reset: true })]);
}

function normalizeDelight(item) {
  return {
    type: "delight",
    id: `delight:${item.bvid || item.content_url || item.title}`,
    bvid: text(item.bvid),
    title: text(item.title, "未命名惊喜推荐"),
    cover_url: text(item.cover_url),
    content_url: text(item.content_url),
    source_platform: text(item.source_platform, "bilibili"),
    delight_reason: text(item.delight_reason, "这条可能会给你一点意外之喜。"),
    delight_score: Number(item.delight_score || 0),
    delight_hook: text(item.delight_hook),
    chat_reply: text(item.chat_reply),
    chatBusy: false,
    handled: Boolean(item.handled),
  };
}

function upsertDelight(item) {
  const normalized = normalizeDelight(item);
  if (!normalized.bvid && !normalized.content_url) return;
  const index = state.delights.findIndex((existing) => existing.id === normalized.id);
  if (index >= 0) {
    state.delights[index] = { ...state.delights[index], ...normalized };
  } else {
    state.delights.push(normalized);
  }
  if (state.delightIndex >= state.delights.length) {
    state.delightIndex = Math.max(0, state.delights.length - 1);
  }
}

function removeDelight(id) {
  state.delights = state.delights.filter((item) => item.id !== id);
  if (state.delightIndex >= state.delights.length) {
    state.delightIndex = Math.max(0, state.delights.length - 1);
  }
  renderDelightSlot();
}

function renderDelightSlot() {
  const slot = $("delightSlot");
  clear(slot);
  if (!state.delights.length) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  const item = state.delights[state.delightIndex] || state.delights[0];
  const card = node("article", "delight-card");
  const cover = renderCover(item, "delight-cover");

  const body = node("div", "delight-body");
  const header = node("div", "delight-header");
  header.appendChild(node("span", "mini-label", item.delight_hook || "惊喜推荐"));
  header.appendChild(node("span", "score-pill", percent(item.delight_score)));
  body.appendChild(header);
  body.appendChild(node("h3", "card-title", item.title));
  body.appendChild(node("p", "expression", item.delight_reason));
  if (item.chat_reply) {
    body.appendChild(node("div", "inline-reply", item.chat_reply));
  }

  const actions = node("div", "card-actions");
  const prev = node("button", "ghost-button icon-button", "‹");
  prev.type = "button";
  prev.disabled = state.delights.length <= 1;
  prev.addEventListener("click", () => {
    state.delightIndex = (state.delightIndex - 1 + state.delights.length) % state.delights.length;
    renderDelightSlot();
  });
  const counter = node("span", "muted-text", `${state.delightIndex + 1}/${state.delights.length}`);
  const next = node("button", "ghost-button icon-button", "›");
  next.type = "button";
  next.disabled = state.delights.length <= 1;
  next.addEventListener("click", () => {
    state.delightIndex = (state.delightIndex + 1) % state.delights.length;
    renderDelightSlot();
  });
  const openButton = node("button", "primary-button", "打开");
  openButton.type = "button";
  openButton.addEventListener("click", () => openDelight(item));
  const like = node("button", "secondary-button", "喜欢");
  like.type = "button";
  like.addEventListener("click", () => respondToDelight(item, "like"));
  const dislike = node("button", "danger-button", "不喜欢");
  dislike.type = "button";
  dislike.addEventListener("click", () => respondToDelight(item, "dislike"));
  actions.append(prev, counter, next, openButton, like, dislike);

  const chatRow = renderInlineChatRow("聊一句原因", (message) =>
    respondToDelight(item, "chat", message),
  );
  body.append(actions, chatRow);
  card.append(cover, body);
  slot.appendChild(card);
}

async function openDelight(item) {
  const url = buildContentUrl(item);
  if (!url) {
    toast("这条惊喜推荐还没有可打开的链接。");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
  await requestJson("/delight/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bvid: item.bvid, title: item.title, response: "view" }),
  }).catch(() => {});
}

async function markDelightSent(bvid) {
  if (!bvid) return;
  await requestJson("/delight/sent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bvid }),
  }).catch(() => {});
}

function openDelightFromMessage(item) {
  void openDelight(item);
  removeDelightMessage(item.bvid);
  renderMessages();
}

async function respondToDelight(item, responseType, message = "", options = {}) {
  const payload = await requestJson("/delight/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bvid: item.bvid,
      title: item.title,
      response: responseType,
      message,
    }),
  });
  if (responseType === "chat") {
    item.chat_reply = payload.reply || "没有返回内容。";
    toast(payload.ok === false ? item.chat_reply : "已回复。");
    if (options.removeMessage) {
      window.setTimeout(() => {
        removeDelightMessage(item.bvid);
        renderMessages();
      }, 4000);
    }
  } else {
    toast(responseType === "dislike" ? "已减少这类惊喜。" : "已记下喜欢。");
    removeDelight(item.id);
    if (options.removeMessage) {
      removeDelightMessage(item.bvid);
    }
  }
  await Promise.allSettled([loadProfile(), loadActivity({ reset: true })]);
  renderDelightSlot();
  renderMessages();
}

function upsertMessage(item) {
  const message = normalizeMessage(item);
  if (!message.id) return;
  const index = state.messages.findIndex((existing) => existing.id === message.id);
  if (index >= 0) {
    state.messages[index] = { ...state.messages[index], ...message };
  } else {
    state.messages.unshift(message);
  }
  renderMessageBadge();
}

function normalizeMessage(item) {
  const type = text(item.type);
  if (type === "interest.probe" || type === "probe") {
    const domain = text(item.domain);
    return {
      id: `probe:${domain}`,
      type: "probe",
      domain,
      title: domain,
      message: text(item.message || item.reason, `要不要多探索「${domain}」？`),
      specifics: Array.isArray(item.specifics) ? item.specifics : [],
      handled: Boolean(item.handled),
      chat_reply: text(item.chat_reply),
    };
  }
  if (type === "delight") {
    const normalized = normalizeDelight(item);
    return {
      ...normalized,
      type: "delight",
      message: normalized.delight_reason,
    };
  }
  return {
    id: text(item.id || `${type}:${item.domain || item.bvid || Date.now()}`),
    type: type || "event",
    title: text(item.title || item.domain || item.summary || item.type, "消息"),
    message: text(item.message || item.summary),
    handled: Boolean(item.handled),
  };
}

function removeMessageById(id) {
  state.messages = state.messages.filter((message) => message.id !== id);
  renderMessageBadge();
}

function removeProbeMessage(domain) {
  removeMessageById(`probe:${domain}`);
}

function removeDelightMessage(bvid) {
  if (!bvid) return;
  state.messages = state.messages.filter((message) => message.type !== "delight" || message.bvid !== bvid);
  renderMessageBadge();
  void markDelightSent(bvid);
}

function syncProfileProbeMessages() {
  const activeItems = Array.isArray(state.profile?.speculative_interests)
    ? state.profile.speculative_interests
    : [];
  const activeProbeItems = activeItems.filter((item) => !item.status || item.status === "active");
  const activeDomains = new Set(activeProbeItems.map((item) => text(item.domain)).filter(Boolean));
  state.messages = state.messages.filter(
    (message) => message.type !== "probe" || activeDomains.has(message.domain),
  );
  for (const item of activeProbeItems) {
    if (!text(item.domain)) continue;
    upsertMessage({
      type: "interest.probe",
      domain: item.domain,
      reason: item.reason || `确认度 ${item.confirmation_count}/${item.confirmation_threshold}`,
      specifics: item.specifics,
    });
  }
  renderMessages();
}

function renderMessages() {
  const list = $("messagesList");
  clear(list);
  if (!state.messages.length) {
    list.appendChild(node("div", "empty-state", "暂无待处理消息。"));
    renderMessageBadge();
    return;
  }
  for (const item of state.messages) {
    list.appendChild(renderMessageCard(item));
  }
  renderMessageBadge();
}

function renderMessageCard(item) {
  if (item.type === "delight") return renderDelightMessage(item);
  if (item.type === "probe") return renderProbeMessage(item);
  const card = node("article", "message-card");
  card.appendChild(renderDismissButton("关闭", () => {
    removeMessageById(item.id);
    renderMessages();
  }));
  card.appendChild(node("h3", "", item.title || "消息"));
  if (item.message) card.appendChild(node("p", "", item.message));
  return card;
}

function renderDismissButton(label, onClick) {
  const button = node("button", "message-dismiss", "×");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function renderDelightMessage(item) {
  const card = node("article", "message-card message-with-cover");
  card.appendChild(renderDismissButton("关闭这条惊喜推荐", () => {
    removeDelightMessage(item.bvid);
    renderMessages();
  }));
  card.appendChild(renderCover(item, "message-cover"));
  const body = node("div", "");
  body.appendChild(node("span", "mini-label", "惊喜推荐"));
  body.appendChild(node("h3", "", item.title));
  body.appendChild(node("p", "", item.delight_reason));
  const actions = node("div", "card-actions");
  const openButton = node("button", "primary-button", "打开");
  openButton.type = "button";
  openButton.addEventListener("click", () => openDelightFromMessage(item));
  const like = node("button", "secondary-button", "喜欢");
  like.type = "button";
  like.addEventListener("click", () => respondToDelight(item, "like", "", { removeMessage: true }));
  const dislike = node("button", "danger-button", "不喜欢");
  dislike.type = "button";
  dislike.addEventListener("click", () => respondToDelight(item, "dislike", "", { removeMessage: true }));
  actions.append(openButton, like, dislike);
  body.append(actions);
  body.appendChild(renderInlineChatRow("聊一句原因", (message) =>
    respondToDelight(item, "chat", message, { removeMessage: true }),
  ));
  if (item.chat_reply) body.appendChild(node("div", "inline-reply", item.chat_reply));
  card.appendChild(body);
  return card;
}

function renderProbeMessage(item) {
  const card = node("article", "message-card");
  card.appendChild(renderDismissButton("关闭这条兴趣探针", () => {
    removeProbeMessage(item.domain);
    renderMessages();
  }));
  card.appendChild(node("span", "mini-label", "兴趣探针"));
  card.appendChild(node("h3", "", item.title || item.domain));
  card.appendChild(node("p", "", item.message));
  const specifics = (item.specifics || [])
    .map((specific) => text(specific.name || specific))
    .filter(Boolean)
    .slice(0, 5);
  if (specifics.length) {
    card.appendChild(node("div", "meta", specifics.join(" / ")));
  }
  const actions = node("div", "card-actions");
  const confirm = node("button", "primary-button", "确认喜欢");
  confirm.type = "button";
  confirm.addEventListener("click", () => respondToProbe(item.domain, "confirm", "", item.id));
  const reject = node("button", "danger-button", "暂时不要");
  reject.type = "button";
  reject.addEventListener("click", () => respondToProbe(item.domain, "reject", "", item.id));
  actions.append(confirm, reject);
  card.append(actions);
  card.appendChild(renderInlineChatRow("聊聊这个方向", (message) =>
    respondToProbe(item.domain, "chat", message, item.id),
  ));
  if (item.chat_reply) card.appendChild(node("div", "inline-reply", item.chat_reply));
  return card;
}

function renderInlineChatRow(placeholder, onSend) {
  const row = node("div", "feedback-row");
  const input = document.createElement("input");
  input.placeholder = placeholder;
  const button = node("button", "ghost-button", "发送");
  button.type = "button";
  button.addEventListener("click", async () => {
    const message = input.value.trim();
    if (!message) {
      toast("先写一句。");
      return;
    }
    setBusy(button, true, "发送中");
    try {
      await onSend(message);
      input.value = "";
    } finally {
      setBusy(button, false);
    }
  });
  row.append(input, button);
  return row;
}

async function respondToProbe(domain, responseType, message = "", messageId = "") {
  const payload = await requestJson("/interest-probes/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, response: responseType, message }),
  });
  if (responseType === "chat") {
    const target = state.messages.find((item) => item.id === messageId);
    if (target) target.chat_reply = payload.reply || "没有返回内容。";
    toast(payload.reply || payload.message || "已回复。");
    if (messageId) {
      window.setTimeout(() => {
        removeMessageById(messageId);
        renderMessages();
      }, 4000);
    }
  } else {
    if (messageId) {
      removeMessageById(messageId);
    } else {
      removeProbeMessage(domain);
    }
    toast(responseType === "confirm" ? "已加入画像。" : "已暂时搁置。");
  }
  await Promise.allSettled([loadProfile(), loadActivity({ reset: true })]);
  renderMessages();
}

function renderDomainList(domains, includeSpecifics = false) {
  const list = node("ul", includeSpecifics ? "domain-list" : "chip-list");
  for (const domain of domains || []) {
    const label = text(domain.domain || domain.name);
    if (!label) continue;
    const weight = Number(domain.weight || 0);
    if (!includeSpecifics) {
      list.appendChild(node("li", "", weight ? `${label} ${Math.round(weight * 100)}%` : label));
      continue;
    }
    const item = node("li", "");
    item.appendChild(node("strong", "", weight ? `${label} ${Math.round(weight * 100)}%` : label));
    const specifics = (domain.specifics || [])
      .map((specific) => text(specific.name))
      .filter(Boolean)
      .slice(0, 4);
    if (specifics.length) {
      item.appendChild(node("span", "", specifics.join(" / ")));
    }
    list.appendChild(item);
  }
  if (!list.children.length) {
    list.appendChild(node("li", "", "暂无稳定信号"));
  }
  return list;
}

function renderTextList(items) {
  const list = node("ul", "detail-list");
  for (const item of items || []) {
    const itemText = text(item);
    if (itemText) list.appendChild(node("li", "", itemText));
  }
  if (!list.children.length) list.appendChild(node("li", "", "暂无记录"));
  return list;
}

function renderKeyValueList(entries) {
  const list = node("dl", "kv-list");
  for (const [key, value] of entries) {
    const valueText = text(value);
    if (!valueText) continue;
    list.append(node("dt", "", key), node("dd", "", valueText));
  }
  if (!list.children.length) {
    list.append(node("dt", "", "状态"), node("dd", "", "暂无记录"));
  }
  return list;
}

function renderProfile() {
  const root = $("profileView");
  clear(root);
  const profile = state.profile;
  if (!profile?.initialized) {
    root.appendChild(node("div", "empty-state", "画像还没初始化。先运行 init 或等待账号同步完成。"));
    return;
  }

  const portrait = node("article", "profile-card wide");
  portrait.appendChild(node("h3", "", "画像摘要"));
  portrait.appendChild(node("p", "profile-copy", profile.personality_portrait || "暂无画像摘要。"));
  root.appendChild(portrait);

  const likes = node("article", "profile-card");
  likes.appendChild(node("h3", "", "喜欢的方向"));
  likes.appendChild(renderDomainList(profile.likes, true));
  root.appendChild(likes);

  const dislikes = node("article", "profile-card");
  dislikes.appendChild(node("h3", "", "避开的方向"));
  dislikes.appendChild(renderDomainList(profile.dislikes, true));
  root.appendChild(dislikes);

  const core = node("article", "profile-card");
  core.appendChild(node("h3", "", "核心动机"));
  core.appendChild(renderTextList([...(profile.deep_needs || []), ...(profile.values || [])]));
  root.appendChild(core);

  const style = node("article", "profile-card");
  style.appendChild(node("h3", "", "内容偏好"));
  style.appendChild(
    renderKeyValueList([
      ["深度", percent(profile.style?.depth_preference)],
      ["幽默", percent(profile.style?.humor_preference)],
      ["质量敏感", percent(profile.style?.quality_sensitivity)],
      ["时长", profile.style?.preferred_duration],
      ["节奏", profile.style?.preferred_pace],
    ]),
  );
  root.appendChild(style);

  const context = node("article", "profile-card");
  context.appendChild(node("h3", "", "观看场景"));
  context.appendChild(
    renderKeyValueList([
      ["工作日", profile.context?.weekday_patterns],
      ["周末", profile.context?.weekend_patterns],
      ["时段", profile.context?.time_of_day_patterns],
      ["会话", profile.context?.session_type],
      ["探索开放度", percent(profile.exploration_openness)],
    ]),
  );
  root.appendChild(context);

  const traits = node("article", "profile-card");
  traits.appendChild(node("h3", "", "处理信息的方式"));
  traits.appendChild(renderTextList(profile.cognitive_style));
  root.appendChild(traits);

  const mbti = node("article", "profile-card");
  mbti.appendChild(node("h3", "", "人格线索"));
  mbti.appendChild(
    renderKeyValueList([
      ["类型", profile.mbti?.type],
      ["置信度", percent(profile.mbti?.confidence)],
      ["阶段", profile.current_phase || profile.life_stage],
    ]),
  );
  root.appendChild(mbti);

  root.appendChild(renderSpeculativeInterests(profile.speculative_interests || []));
  root.appendChild(renderActiveInsights(profile.active_insights || []));
  root.appendChild(renderAwareness(profile.recent_awareness || []));
  root.appendChild(renderCognitionCard());
}

function renderSpeculativeInterests(items) {
  const card = node("article", "profile-card wide");
  card.appendChild(node("h3", "", "待确认兴趣"));
  if (!items.length) {
    card.appendChild(node("div", "empty-state compact", "暂无待确认方向。"));
    return card;
  }
  const list = node("div", "stack-list");
  for (const item of items) {
    const row = node("article", "stack-item");
    row.appendChild(node("strong", "", item.domain));
    row.appendChild(node("p", "", item.reason || `确认度 ${item.confirmation_count}/${item.confirmation_threshold}`));
    const specifics = (item.specifics || [])
      .map((specific) => text(specific.name))
      .filter(Boolean)
      .slice(0, 4);
    if (specifics.length) row.appendChild(node("div", "meta", specifics.join(" / ")));
    const actions = node("div", "card-actions");
    const confirm = node("button", "primary-button", "确认喜欢");
    confirm.type = "button";
    confirm.addEventListener("click", () => respondToProbe(item.domain, "confirm"));
    const reject = node("button", "danger-button", "暂时不要");
    reject.type = "button";
    reject.addEventListener("click", () => respondToProbe(item.domain, "reject"));
    actions.append(confirm, reject);
    row.append(actions);
    row.appendChild(renderInlineChatRow("聊聊这个方向", (message) =>
      respondToProbe(item.domain, "chat", message),
    ));
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

function renderActiveInsights(items) {
  const card = node("article", "profile-card");
  card.appendChild(node("h3", "", "活跃洞察"));
  if (!items.length) {
    card.appendChild(node("div", "empty-state compact", "暂无活跃洞察。"));
    return card;
  }
  const list = node("ul", "detail-list");
  for (const item of items) {
    const line = `${item.hypothesis}${item.confidence ? ` (${percent(item.confidence)})` : ""}`;
    list.appendChild(node("li", "", line));
  }
  card.appendChild(list);
  return card;
}

function renderAwareness(items) {
  const card = node("article", "profile-card");
  card.appendChild(node("h3", "", "近期观察"));
  if (!items.length) {
    card.appendChild(node("div", "empty-state compact", "暂无近期观察。"));
    return card;
  }
  const list = node("ul", "detail-list");
  for (const item of items) {
    const parts = [item.observation, item.trend, item.emotion_guess].map(text).filter(Boolean);
    if (parts.length) list.appendChild(node("li", "", parts.join(" / ")));
  }
  card.appendChild(list);
  return card;
}

function renderCognitionCard() {
  const card = node("article", "profile-card wide");
  const header = node("div", "card-heading-row");
  header.appendChild(node("h3", "", "最近新记住的事"));
  const more = node("button", "ghost-button", "加载更多");
  more.type = "button";
  more.hidden = !state.cognitionHasMore;
  more.addEventListener("click", loadMoreCognition);
  header.appendChild(more);
  card.appendChild(header);

  const list = node("div", "cognition-list");
  if (!state.cognitionItems.length) {
    list.appendChild(node("div", "empty-state compact", "暂无新的认知变化。"));
  }
  for (const item of state.cognitionItems) {
    const details = document.createElement("details");
    details.className = "cognition-item";
    const summary = document.createElement("summary");
    summary.appendChild(node("strong", "", item.summary || "认知更新"));
    if (item.context_line) summary.appendChild(node("span", "", item.context_line));
    details.appendChild(summary);
    const body = node("div", "cognition-detail");
    for (const [label, value] of [
      ["影响", item.impact],
      ["原因", item.reasoning],
      ["证据", item.evidence],
      ["来源", item.source_label || item.source],
    ]) {
      const valueText = text(value);
      if (valueText) body.appendChild(node("p", "", `${label}：${valueText}`));
    }
    if (!body.children.length) body.appendChild(node("p", "", "暂无详情。"));
    details.appendChild(body);
    list.appendChild(details);
  }
  card.appendChild(list);
  return card;
}

function renderActivity() {
  const list = $("activityList");
  clear(list);
  if (!state.activityItems.length) {
    list.appendChild(node("div", "empty-state", "暂无活动记录。"));
  }
  for (const item of state.activityItems) {
    const row = node("article", `activity-item ${item.tone || "info"}`);
    row.appendChild(node("strong", "", item.summary || item.kind || "活动"));
    if (item.detail) row.appendChild(node("p", "", item.detail));
    if (item.created_at) row.appendChild(node("span", "meta", item.created_at));
    list.appendChild(row);
  }
  $("activityMoreButton").hidden = !state.activityHasMore;
}

function appendChatMessage(role, messageText) {
  const log = $("chatLog");
  log.appendChild(node("div", `message ${role}`, messageText));
  log.scrollTop = log.scrollHeight;
}

async function sendChat(message) {
  appendChatMessage("user", message);
  state.chatBusy = true;
  $("chatInput").disabled = true;
  $("chatSendButton").disabled = true;
  try {
    const payload = await requestJson("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    appendChatMessage("assistant", payload.reply || "没有返回内容。");
    await Promise.allSettled([loadProfile(), loadRuntime(), loadActivity({ reset: true })]);
  } finally {
    state.chatBusy = false;
    $("chatInput").disabled = false;
    $("chatSendButton").disabled = false;
    $("chatInput").focus();
  }
}

async function loadRuntime() {
  state.runtime = await requestJson("/runtime-status");
  renderStatus();
}

async function loadRecommendations() {
  const payload = await requestJson("/recommendations");
  state.recommendations = Array.isArray(payload.items) ? payload.items : [];
  renderRecommendations();
}

async function loadDelights() {
  const payload = await requestJson("/delight/pending-batch?limit=20");
  state.delights = [];
  state.delightIndex = 0;
  for (const item of Array.isArray(payload.items) ? payload.items : []) {
    upsertDelight(item);
  }
  renderDelightSlot();
}

async function loadProfile() {
  state.profile = await requestJson("/profile-summary?limit=6");
  state.cognitionItems = Array.isArray(state.profile.recent_cognition_updates)
    ? state.profile.recent_cognition_updates
    : [];
  state.cognitionCursor = state.profile.next_cognition_cursor || "";
  state.cognitionHasMore = Boolean(state.profile.has_more_cognition_updates);
  renderProfile();
  syncProfileProbeMessages();
}

async function loadMoreCognition() {
  if (!state.cognitionCursor) return;
  const payload = await requestJson(
    `/profile-summary?limit=6&cursor=${encodeURIComponent(state.cognitionCursor)}`,
  );
  const nextItems = Array.isArray(payload.recent_cognition_updates)
    ? payload.recent_cognition_updates
    : [];
  state.cognitionItems = [...state.cognitionItems, ...nextItems];
  state.cognitionCursor = payload.next_cognition_cursor || "";
  state.cognitionHasMore = Boolean(payload.has_more_cognition_updates);
  renderProfile();
}

async function loadActivity({ reset = false } = {}) {
  try {
    const cursor = reset ? "" : state.activityCursor;
    const query = new URLSearchParams({ limit: "8" });
    if (cursor) query.set("before", cursor);
    const payload = await requestJson(`/activity-feed?${query.toString()}`);
    state.lastStreamEvent = payload.live_summary || payload.headline || state.lastStreamEvent;
    const items = Array.isArray(payload.items) ? payload.items : [];
    state.activityItems = reset ? items : [...state.activityItems, ...items];
    state.activityCursor = payload.next_cursor || "";
    state.activityHasMore = Boolean(payload.has_more);
  } catch {
    // Activity feed is supplemental.
  }
  renderStatus();
  renderActivity();
}

async function loadAll() {
  const reload = $("reloadButton");
  setBusy(reload, true, "刷新中");
  try {
    const health = await fetch(`${API_BASE}/health`);
    state.online = health.ok;
    await Promise.all([
      loadRuntime(),
      loadRecommendations(),
      loadDelights(),
      loadProfile(),
      loadActivity({ reset: true }),
    ]);
  } catch (error) {
    state.online = false;
    toast(`后端请求失败：${error.message}`);
  } finally {
    renderStatus();
    setBusy(reload, false);
  }
}

async function reshuffle() {
  const button = $("reshuffleButton");
  setBusy(button, true, "换片中");
  try {
    const payload = await requestJson("/recommendations/reshuffle", { method: "POST" });
    state.recommendations = Array.isArray(payload.items) ? payload.items : [];
    renderRecommendations();
    await Promise.allSettled([loadRuntime(), loadActivity({ reset: true })]);
  } finally {
    setBusy(button, false);
  }
}

async function appendRecommendations() {
  const button = $("appendButton");
  setBusy(button, true, "追加中");
  try {
    const payload = await requestJson("/recommendations/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        excluded_bvids: state.recommendations.map((item) => item.bvid).filter(Boolean),
      }),
    });
    const nextItems = Array.isArray(payload.items) ? payload.items : [];
    state.recommendations = [...state.recommendations, ...nextItems];
    renderRecommendations();
    await loadRuntime();
  } finally {
    setBusy(button, false);
  }
}

async function refreshPool() {
  const button = $("refreshPoolButton");
  setBusy(button, true, "已请求");
  try {
    const payload = await requestJson("/recommendations/refresh", { method: "POST" });
    toast(payload.accepted ? "已开始后台补货。" : payload.reason || "后台补货暂未接受。");
    await loadRuntime();
  } finally {
    setBusy(button, false);
  }
}

function handleRuntimeEvent(payload) {
  state.lastStreamEvent = payload.message || payload.summary || payload.type || "";
  if (payload.type === "delight.candidate" && payload.bvid) {
    upsertDelight(payload);
    upsertMessage({ ...payload, type: "delight" });
    renderDelightSlot();
    renderMessages();
  }
  if (payload.type === "interest.probe" && payload.domain) {
    upsertMessage({ ...payload, type: "interest.probe" });
    renderMessages();
  }
  if (
    [
      "init_completed",
      "recommendation.reshuffled",
      "refresh.pool_updated",
      "config_reloaded",
      "profile_updated",
      "delight.refreshed",
    ].includes(payload.type)
  ) {
    window.clearTimeout(connectRuntimeStream.reloadTimer);
    connectRuntimeStream.reloadTimer = window.setTimeout(loadAll, 500);
  }
  if (
    ["interest.confirmed", "interest.rejected", "interest.chat", "delight.disliked", "delight.liked", "delight.chat"].includes(
      payload.type,
    )
  ) {
    window.clearTimeout(connectRuntimeStream.profileTimer);
    connectRuntimeStream.profileTimer = window.setTimeout(() => {
      void Promise.allSettled([loadProfile(), loadActivity({ reset: true })]);
    }, 500);
  }
  if (payload.type === "activity.added") {
    void loadActivity({ reset: true });
  }
  renderStatus();
}

function connectRuntimeStream() {
  if (!("WebSocket" in window)) return;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${scheme}://${window.location.host}${API_BASE}/runtime-stream?client=web`);
  socket.addEventListener("open", () => {
    const pill = $("streamState");
    pill.textContent = "实时已连接";
    pill.dataset.tone = "ok";
  });
  socket.addEventListener("message", (event) => {
    try {
      handleRuntimeEvent(JSON.parse(event.data));
    } catch {
      // Keep the socket alive on malformed events.
    }
  });
  socket.addEventListener("close", () => {
    const pill = $("streamState");
    pill.textContent = "实时断开，稍后重连";
    pill.dataset.tone = "warn";
    window.setTimeout(connectRuntimeStream, 5000);
  });
}

function bindEvents() {
  $("themeToggleButton").addEventListener("click", cycleThemeMode);
  $("reloadButton").addEventListener("click", loadAll);
  $("reshuffleButton").addEventListener("click", reshuffle);
  $("appendButton").addEventListener("click", appendRecommendations);
  $("refreshPoolButton").addEventListener("click", refreshPool);
  $("activityMoreButton").addEventListener("click", () => loadActivity({ reset: false }));
  $("sourceFilter").addEventListener("change", (event) => {
    state.sourceFilter = event.target.value;
    renderRecommendations();
  });

  for (const button of document.querySelectorAll(".tab-button")) {
    button.addEventListener("click", () => {
      for (const peer of document.querySelectorAll(".tab-button")) {
        peer.classList.toggle("is-active", peer === button);
      }
      for (const panel of document.querySelectorAll(".tab-panel")) {
        panel.hidden = panel.id !== `${button.dataset.tab}Panel`;
      }
    });
  }

  $("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.chatBusy) return;
    const input = $("chatInput");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    sendChat(message).catch((error) => toast(`聊天失败：${error.message}`));
  });
}

initTheme();
bindEvents();
watchBilibiliImageLinks();
connectRuntimeStream();
loadAll();
