// ===== DOM References =====
const $ = (id) => document.getElementById(id);

// Nav
const navUserName = $("nav-user-name");
const navUserAvatar = $("nav-user-avatar");

// Disconnect
const disconnectBanner = $("disconnect-banner");

// Tabs
const tabChat = $("tab-chat");
const tabFeed = $("tab-feed");
const chatView = $("chat-view");
const feedView = $("feed-view");

// Users Sidebar
const usersSidebar = $("users-sidebar");
const usersList = $("users-list");
const onlineCount = $("online-count");
const usersOverlay = $("users-overlay");
const usersToggle = $("users-toggle");
const usersToggleMobile = $("users-toggle-mobile");

// DM
const dmWelcome = $("dm-welcome");
const dmConversation = $("dm-conversation");
const dmTargetName = $("dm-target-name");
const dmTargetAvatar = $("dm-target-avatar");
const dmTargetStatus = $("dm-target-status");
const dmMessagesContainer = $("dm-messages-container");
const dmMessagesArea = $("dm-messages-area");
const dmInput = $("dm-input");
const dmSendBtn = $("dm-send-btn");

// Feed
const feedUserAvatar = $("feed-user-avatar");
const postTextInput = $("post-text-input");
const postMediaInput = $("post-media-input");
const postSubmitBtn = $("post-submit-btn");
const feedList = $("feed-list");

// ===== State =====
const socket = io();
let myUser = null; // { id, name, color }
let onlineUsers = []; // [{ id, name, color }]
let activeDMUserId = null; // id of the user we're chatting with
let dmMessages = {}; // { userId: [messages] }
let isAtBottom = true;

// Feed state
let postsData = [];
let openComments = new Set();

// ===== Utility =====
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  if (isToday) return `${hours}:${minutes}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes}`;
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatTime(timestamp);
}

function scrollToBottom(smooth = true) {
  if (smooth) {
    dmMessagesArea.scrollTo({ top: dmMessagesArea.scrollHeight, behavior: "smooth" });
  } else {
    dmMessagesArea.scrollTop = dmMessagesArea.scrollHeight;
  }
}

function isNearBottom() {
  return dmMessagesArea.scrollHeight - dmMessagesArea.scrollTop - dmMessagesArea.clientHeight < 100;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ===== Tab Switching =====
function switchTab(tab) {
  tabChat.classList.toggle("active", tab === "chat");
  tabFeed.classList.toggle("active", tab === "feed");
  chatView.classList.toggle("active", tab === "chat");
  feedView.classList.toggle("active", tab === "feed");

  if (tab === "chat" && activeDMUserId) {
    dmInput.focus();
  } else if (tab === "feed") {
    postTextInput.focus();
  }
}

tabChat.addEventListener("click", () => switchTab("chat"));
tabFeed.addEventListener("click", () => switchTab("feed"));

// ===== Socket Events: Init =====
socket.on("init", (data) => {
  myUser = data.user;
  onlineUsers = data.onlineUsers;
  postsData = data.posts || [];

  // Update nav
  navUserName.textContent = myUser.name;
  navUserAvatar.textContent = myUser.name.charAt(5).toUpperCase() || "U";
  navUserAvatar.style.background = myUser.color;

  // Feed avatar
  feedUserAvatar.textContent = myUser.name.charAt(5).toUpperCase() || "U";
  feedUserAvatar.style.background = myUser.color;

  // Render
  renderOnlineUsers();
  renderFeed();
});

// ===== Socket Events: Users Online/Offline =====
socket.on("user-online", (user) => {
  // Don't add duplicates
  if (!onlineUsers.find((u) => u.id === user.id)) {
    onlineUsers.push(user);
    renderOnlineUsers();
  }
});

socket.on("user-offline", (userId) => {
  onlineUsers = onlineUsers.filter((u) => u.id !== userId);
  renderOnlineUsers();

  // If we were chatting with this user, update their status
  if (activeDMUserId === userId) {
    dmTargetStatus.textContent = "Offline";
    dmTargetStatus.style.color = "var(--text-muted)";
  }
});

// ===== Socket Events: DM =====
socket.on("dm-message", (message) => {
  // Find which user this conversation is with
  const otherId = message.from === myUser.id ? message.to : message.from;

  // Store message
  if (!dmMessages[otherId]) dmMessages[otherId] = [];
  dmMessages[otherId].push(message);

  // If this conversation is active, append the message
  if (activeDMUserId === otherId) {
    appendDMMessage(message);
    if (isNearBottom()) scrollToBottom();
  }

  // Update the users list to show this user has unread messages
  renderOnlineUsers();
});

socket.on("dm-history", ({ with: otherId, messages }) => {
  dmMessages[otherId] = messages || [];
  renderDMMessages(otherId);
});

// ===== Render Functions: Online Users =====
function renderOnlineUsers() {
  usersList.innerHTML = "";

  if (onlineUsers.length === 0) {
    usersList.innerHTML = `
      <div class="users-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3; margin-bottom: 8px;">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        </svg>
        <span>No one else is online</span>
      </div>
    `;
    return;
  }

  onlineUsers.forEach((user) => {
    const isActive = activeDMUserId === user.id;
    const hasUnread = dmMessages[user.id] && dmMessages[user.id].some(
      (m) => m.from === user.id && !m.read
    );

    const el = document.createElement("div");
    el.className = `user-item${isActive ? " active" : ""}`;
    el.innerHTML = `
      <div class="user-item-avatar" style="background: ${user.color}">
        ${(user.name.charAt(5) || "?").toUpperCase()}
        <span class="user-status-dot"></span>
      </div>
      <div class="user-item-info">
        <div class="user-item-name">${escapeHtml(user.name)}</div>
        <div class="user-item-status">Online</div>
      </div>
      ${hasUnread ? '<div class="user-item-badge"></div>' : ""}
    `;
    el.addEventListener("click", () => selectDMUser(user.id));
    usersList.appendChild(el);
  });

  onlineCount.textContent = onlineUsers.length;
}

// ===== DM Actions =====
function selectDMUser(userId) {
  const user = onlineUsers.find((u) => u.id === userId);
  if (!user) return;

  activeDMUserId = userId;

  // Update UI
  dmWelcome.classList.add("hidden");
  dmConversation.classList.remove("hidden");

  dmTargetName.textContent = user.name;
  dmTargetAvatar.textContent = (user.name.charAt(5) || "?").toUpperCase();
  dmTargetAvatar.style.background = user.color;
  dmTargetStatus.textContent = "Online";
  dmTargetStatus.style.color = "var(--success)";

  // Highlight active user in sidebar
  renderOnlineUsers();

  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    usersSidebar.classList.remove("open");
    usersOverlay.classList.remove("show");
  }

  // Load history
  if (!dmMessages[userId]) {
    dmMessages[userId] = [];
  }
  renderDMMessages(userId);

  // Also request history from server
  socket.emit("get-dm-history", { with: userId });

  dmInput.focus();
}

function renderDMMessages(userId) {
  dmMessagesContainer.innerHTML = "";
  const messages = dmMessages[userId] || [];

  if (messages.length === 0) {
    const target = onlineUsers.find((u) => u.id === userId);
    const name = target ? target.name : "this user";
    dmMessagesContainer.innerHTML = `
      <div class="dm-welcome-msg">
        <p>Start a conversation with <strong>${escapeHtml(name)}</strong></p>
        <span>Say hello!</span>
      </div>
    `;
    return;
  }

  messages.forEach((msg) => appendDMMessage(msg, false));
  setTimeout(() => scrollToBottom(false), 50);
}

function appendDMMessage(message, animate = true) {
  // Remove welcome placeholder if present
  const welcome = dmMessagesContainer.querySelector(".dm-welcome-msg");
  if (welcome) welcome.remove();

  const isMine = message.from === myUser.id;
  const el = document.createElement("div");
  el.className = `dm-message${isMine ? " dm-message-own" : ""}`;
  el.style.animation = animate ? "messageIn 0.25s ease" : "none";

  const sender = isMine
    ? myUser
    : onlineUsers.find((u) => u.id === message.from);

  const avatarLetter = sender
    ? (sender.name.charAt(5) || "?").toUpperCase()
    : "?";
  const avatarColor = sender ? sender.color : "#666";

  el.innerHTML = `
    ${!isMine ? `<div class="dm-message-avatar" style="background: ${avatarColor}">${avatarLetter}</div>` : ""}
    <div class="dm-message-content">
      <div class="dm-message-bubble">
        <div class="dm-message-text">${escapeHtml(message.text)}</div>
      </div>
      <div class="dm-message-time">${formatTime(message.timestamp)}</div>
    </div>
  `;

  dmMessagesContainer.appendChild(el);
}

function sendDM() {
  const text = dmInput.value.trim();
  if (!text || !activeDMUserId) return;

  socket.emit("send-dm", { to: activeDMUserId, text });
  dmInput.value = "";
  dmSendBtn.disabled = true;
  dmInput.focus();
}

// ===== DM Event Listeners =====
dmSendBtn.addEventListener("click", sendDM);
dmInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendDM();
  }
});
dmInput.addEventListener("input", () => {
  dmSendBtn.disabled = !dmInput.value.trim();
});

dmMessagesArea.addEventListener("scroll", () => {
  isAtBottom = isNearBottom();
});

// ===== DM Sidebar Toggle =====
function toggleUsersSidebar() {
  usersSidebar.classList.toggle("open");
  usersOverlay.classList.toggle("show");
}

usersToggle?.addEventListener("click", toggleUsersSidebar);
usersToggleMobile?.addEventListener("click", toggleUsersSidebar);
usersOverlay.addEventListener("click", () => {
  usersSidebar.classList.remove("open");
  usersOverlay.classList.remove("show");
});

// ===== Socket Connection Events =====
socket.on("connect", () => {
  disconnectBanner.classList.add("hidden");
});
socket.on("disconnect", () => {
  disconnectBanner.classList.remove("hidden");
});

// ========================================================================
// FEED FUNCTIONS
// ========================================================================

function renderFeed() {
  // Save which posts have comments open so we can restore after re-render
  openComments = new Set();
  document.querySelectorAll(".comments-section").forEach((s) => {
    if (!s.classList.contains("hidden")) {
      openComments.add(s.dataset.postId);
    }
  });

  feedList.innerHTML = "";

  if (postsData.length === 0) {
    feedList.innerHTML = `
      <div class="empty-feed glass-card">
        <svg width="64" height="64" viewBox="0 0 48 48" fill="none" style="margin: 0 auto; display: block;">
          <rect width="48" height="48" rx="12" fill="url(#ge)"/>
          <line x1="16" y1="18" x2="32" y2="18" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
          <line x1="16" y1="24" x2="28" y2="24" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
          <line x1="16" y1="30" x2="24" y2="30" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.3"/>
          <defs>
            <linearGradient id="ge" x1="0" y1="0" x2="48" y2="48">
              <stop stop-color="#8b5cf6"/><stop offset="1" stop-color="#6366f1"/>
            </linearGradient>
          </defs>
        </svg>
        <h3>No posts yet</h3>
        <p>Be the first to share something!<br>Type something above and hit Post.</p>
      </div>
    `;
    return;
  }

  postsData.forEach((post) => {
    feedList.appendChild(createPostElement(post));
  });

  // Restore open comments that were open before re-render
  openComments.forEach((postId) => {
    const section = document.querySelector(`.comments-section[data-post-id="${postId}"]`);
    if (section) {
      section.classList.remove("hidden");
      socket.emit("get-comments", { postId });
    }
  });
  openComments.clear();
}

// ===== Socket Events: Feed =====

socket.on("post-created", (post) => {
  postsData.unshift(post);
  const el = createPostElement(post);
  el.style.animation = "none";
  feedList.prepend(el);
  const empty = feedList.querySelector(".empty-feed");
  if (empty) empty.remove();
});

socket.on("post-updated", (post) => {
  const idx = postsData.findIndex((p) => p.id === post.id);
  if (idx !== -1) {
    postsData[idx] = post;
    const el = document.getElementById(`post-${post.id}`);
    if (el) {
      const isLiked = post.likes.includes(myUser.id);
      const isDisliked = post.dislikes.includes(myUser.id);

      const likeBtn = el.querySelector('[data-action="like-post"]');
      const dislikeBtn = el.querySelector('[data-action="dislike-post"]');

      if (likeBtn) {
        likeBtn.classList.toggle("active-like", isLiked);
        const count = likeBtn.querySelector(".action-count");
        if (count) count.textContent = post.likes.length;
        const svg = likeBtn.querySelector("svg");
        if (svg) svg.setAttribute("fill", isLiked ? "currentColor" : "none");
      }

      if (dislikeBtn) {
        dislikeBtn.classList.toggle("active-dislike", isDisliked);
        const count = dislikeBtn.querySelector(".action-count");
        if (count) count.textContent = post.dislikes.length;
        const svg = dislikeBtn.querySelector("svg");
        if (svg) svg.setAttribute("fill", isDisliked ? "currentColor" : "none");
      }

      const commentBtn = el.querySelector('[data-action="toggle-comments"]');
      if (commentBtn) {
        const count = commentBtn.querySelector(".action-count");
        if (count) count.textContent = post.commentCount;
      }
    }
  }
});

socket.on("comment-added", ({ postId, comment, commentCount }) => {
  const post = postsData.find((p) => p.id === postId);
  if (post) {
    post.commentCount = commentCount;

    const el = document.getElementById(`post-${postId}`);
    if (el) {
      const commentBtn = el.querySelector('[data-action="toggle-comments"]');
      if (commentBtn) {
        const count = commentBtn.querySelector(".action-count");
        if (count) count.textContent = commentCount;
      }
    }

    const section = document.querySelector(`.comments-section[data-post-id="${postId}"]`);
    if (section && !section.classList.contains("hidden")) {
      section.querySelector(".comments-list").appendChild(createCommentElement(comment, postId));
    }
  }
});

socket.on("comment-updated", ({ postId, comment }) => {
  const post = postsData.find((p) => p.id === postId);
  if (post) {
    const section = document.querySelector(`.comments-section[data-post-id="${postId}"]`);
    if (section) {
      const commentEl = section.querySelector(`.comment-item[data-comment-id="${comment.id}"]`);
      if (commentEl) {
        commentEl.replaceWith(createCommentElement(comment, postId));
      }
    }
  }
});

socket.on("comments-loaded", ({ postId, comments }) => {
  const section = document.querySelector(`.comments-section[data-post-id="${postId}"]`);
  if (section) {
    const list = section.querySelector(".comments-list");
    list.innerHTML = "";
    comments.forEach((c) => list.appendChild(createCommentElement(c, postId)));
  }
});

// ===== Post Element Factory =====

function createPostElement(post) {
  const el = document.createElement("div");
  el.className = "glass-card feed-post";
  el.id = `post-${post.id}`;

  const isLiked = post.likes.includes(myUser.id);
  const isDisliked = post.dislikes.includes(myUser.id);

  let mediaHtml = "";
  if (post.mediaUrl) {
    if (post.mediaType === "image") {
      mediaHtml = `<div class="feed-post-media"><img src="${escapeHtml(post.mediaUrl)}" alt="Post media" loading="lazy" onerror="this.parentElement.innerHTML='<a class=\\'media-link\\' href=\\'${escapeHtml(post.mediaUrl)}\\' target=_blank>${escapeHtml(post.mediaUrl)}</a>'" /></div>`;
    } else if (post.mediaType === "video") {
      let embedUrl = post.mediaUrl;
      const ytMatch = post.mediaUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]+)/i);
      const vimeoMatch = post.mediaUrl.match(/vimeo\.com\/(\d+)/i);
      if (ytMatch) {
        embedUrl = `https://www.youtube.com/embed/${ytMatch[1]}`;
        mediaHtml = `<div class="feed-post-media"><iframe src="${escapeHtml(embedUrl)}" allowfullscreen loading="lazy"></iframe></div>`;
      } else if (vimeoMatch) {
        embedUrl = `https://player.vimeo.com/video/${vimeoMatch[1]}`;
        mediaHtml = `<div class="feed-post-media"><iframe src="${escapeHtml(embedUrl)}" allowfullscreen loading="lazy"></iframe></div>`;
      } else {
        mediaHtml = `<div class="feed-post-media"><a class="media-link" href="${escapeHtml(post.mediaUrl)}" target="_blank">🔗 ${escapeHtml(post.mediaUrl)}</a></div>`;
      }
    } else {
      mediaHtml = `<div class="feed-post-media"><a class="media-link" href="${escapeHtml(post.mediaUrl)}" target="_blank">🔗 ${escapeHtml(post.mediaUrl)}</a></div>`;
    }
  }

  el.innerHTML = `
    <div class="feed-post-header">
      <div class="user-avatar-sm" style="background: ${post.color}">${post.anonymousId.charAt(5).toUpperCase()}</div>
      <span class="feed-post-author" style="color: ${post.color}">${escapeHtml(post.anonymousId)}</span>
      <span class="feed-post-time">${formatTimeAgo(post.timestamp)}</span>
    </div>
    <div class="feed-post-text">${escapeHtml(post.text)}</div>
    ${mediaHtml}
    <div class="feed-post-actions">
      <button class="action-btn ${isLiked ? "active-like" : ""}" data-action="like-post" data-post-id="${post.id}">
        <svg class="action-icon" viewBox="0 0 24 24" fill="${isLiked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        <span class="action-count">${post.likes.length}</span>
      </button>
      <button class="action-btn ${isDisliked ? "active-dislike" : ""}" data-action="dislike-post" data-post-id="${post.id}">
        <svg class="action-icon" viewBox="0 0 24 24" fill="${isDisliked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
        <span class="action-count">${post.dislikes.length}</span>
      </button>
      <button class="action-btn" data-action="toggle-comments" data-post-id="${post.id}">
        <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="action-count">${post.commentCount}</span>
      </button>
      <span class="action-spacer"></span>
    </div>
    <div class="comments-section hidden" data-post-id="${post.id}">
      <div class="comments-list"></div>
      <div class="comment-input-wrapper">
        <input type="text" class="comment-input" placeholder="Write a reply..." maxlength="500" />
        <button class="comment-send-btn" disabled>Reply</button>
      </div>
    </div>
  `;

  const likeBtn = el.querySelector('[data-action="like-post"]');
  const dislikeBtn = el.querySelector('[data-action="dislike-post"]');
  const commentToggle = el.querySelector('[data-action="toggle-comments"]');

  likeBtn.addEventListener("click", () => {
    socket.emit("toggle-like-post", { postId: post.id });
  });

  dislikeBtn.addEventListener("click", () => {
    socket.emit("toggle-dislike-post", { postId: post.id });
  });

  commentToggle.addEventListener("click", () => {
    const section = el.querySelector(".comments-section");
    section.classList.toggle("hidden");

    if (!section.classList.contains("hidden") && section.querySelector(".comments-list").children.length === 0) {
      socket.emit("get-comments", { postId: post.id });
    }

    section.querySelector(".comment-input")?.focus();
  });

  const commentInput = el.querySelector(".comment-input");
  const commentSend = el.querySelector(".comment-send-btn");

  commentInput.addEventListener("input", () => {
    commentSend.disabled = !commentInput.value.trim();
  });

  commentInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendComment(post.id, commentInput, commentSend);
    }
  });

  commentSend.addEventListener("click", () => {
    sendComment(post.id, commentInput, commentSend);
  });

  return el;
}

function sendComment(postId, input, sendBtn) {
  const text = input.value.trim();
  if (!text) return;
  socket.emit("add-comment", { postId, text });
  input.value = "";
  sendBtn.disabled = true;
}

function createCommentElement(comment, postId) {
  const el = document.createElement("div");
  el.className = "comment-item";
  el.setAttribute("data-comment-id", comment.id);

  const isLiked = comment.likes.includes(myUser.id);
  const isDisliked = comment.dislikes.includes(myUser.id);

  el.innerHTML = `
    <div class="comment-avatar" style="background: ${comment.color}">${(comment.anonymousId.charAt(5) || "?").toUpperCase()}</div>
    <div class="comment-body">
      <div class="comment-header">
        <span class="comment-author" style="color: ${comment.color}">${escapeHtml(comment.anonymousId)}</span>
        <span class="comment-time">${formatTimeAgo(comment.timestamp)}</span>
      </div>
      <div class="comment-text">${escapeHtml(comment.text)}</div>
      <div class="comment-actions">
        <button class="comment-action-btn ${isLiked ? "active-like" : ""}" data-action="like-comment" data-post-id="${postId}" data-comment-id="${comment.id}">
          <svg class="action-icon" viewBox="0 0 24 24" fill="${isLiked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
          <span>${comment.likes.length}</span>
        </button>
        <button class="comment-action-btn ${isDisliked ? "active-dislike" : ""}" data-action="dislike-comment" data-post-id="${postId}" data-comment-id="${comment.id}">
          <svg class="action-icon" viewBox="0 0 24 24" fill="${isDisliked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
          <span>${comment.dislikes.length}</span>
        </button>
      </div>
    </div>
  `;

  el.querySelector('[data-action="like-comment"]').addEventListener("click", function () {
    socket.emit("toggle-like-comment", { postId, commentId: comment.id });
  });

  el.querySelector('[data-action="dislike-comment"]').addEventListener("click", function () {
    socket.emit("toggle-dislike-comment", { postId, commentId: comment.id });
  });

  return el;
}

// ===== Feed: Create Post =====
postTextInput.addEventListener("input", () => {
  postSubmitBtn.disabled = !postTextInput.value.trim();
});

postSubmitBtn.addEventListener("click", () => {
  const text = postTextInput.value.trim();
  if (!text) return;

  const mediaUrl = postMediaInput.value.trim() || null;
  socket.emit("create-post", { text, mediaUrl });

  postTextInput.value = "";
  postMediaInput.value = "";
  postSubmitBtn.disabled = true;
  postTextInput.focus();
});

postTextInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.ctrlKey) {
    e.preventDefault();
    postSubmitBtn.click();
  }
});
