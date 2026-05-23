// ===== DOM References =====
const $ = (id) => document.getElementById(id);

const entryScreen = $("entry-screen");
const appScreen = $("app-screen");
const roomInput = $("room-input");
const joinBtn = $("join-btn");
const popularTags = $("popular-tags");
const leaveBtn = $("leave-btn");
const disconnectBanner = $("disconnect-banner");

// Chat
const roomList = $("room-list");
const createRoomInput = $("create-room-input");
const createRoomBtn = $("create-room-btn");
const currentRoomName = $("current-room-name");
const roomUserCount = $("room-user-count");
const messagesContainer = $("messages-container");
const messageInput = $("message-input");
const sendBtn = $("send-btn");
const leaveRoomBtn = $("leave-room-btn");
const sidebarToggle = $("sidebar-toggle");
const sidebar = $("sidebar");
const sidebarOverlay = $("sidebar-overlay");

// Tabs
const tabChat = $("tab-chat");
const tabFeed = $("tab-feed");
const chatView = $("chat-view");
const feedView = $("feed-view");

// Feed
const feedUserAvatar = $("feed-user-avatar");
const postTextInput = $("post-text-input");
const postMediaInput = $("post-media-input");
const postSubmitBtn = $("post-submit-btn");
const feedList = $("feed-list");

// ===== State =====
const socket = io();
let currentRoom = null;
let anonymousId = "";
let userColor = "";
let isAtBottom = true;
let postsData = [];
let openComments = new Set(); // Track which posts have comments open
let pendingJoin = null; // Deferred room join until init is received

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
  const area = $("messages-area");
  if (smooth) {
    area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
  } else {
    area.scrollTop = area.scrollHeight;
  }
}

function isNearBottom() {
  const area = $("messages-area");
  return area.scrollHeight - area.scrollTop - area.clientHeight < 100;
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

  if (tab === "chat" && currentRoom) {
    messageInput.focus();
  } else if (tab === "feed") {
    postTextInput.focus();
  }
}

tabChat.addEventListener("click", () => switchTab("chat"));
tabFeed.addEventListener("click", () => switchTab("feed"));

// ===== Entry =====
joinBtn.addEventListener("click", () => {
  const name = roomInput.value.trim() || "Guest";
  enterApp(name);
});

roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const name = roomInput.value.trim() || "Guest";
    enterApp(name);
  }
});

function enterApp(name) {
  entryScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");

  // Set avatar for feed
  feedUserAvatar.textContent = name.charAt(0).toUpperCase();

  // If init was already received, join directly. Otherwise defer until init arrives.
  if (anonymousId) {
    socket.emit("join-room", { room: "general" });
  } else {
    pendingJoin = "general";
  }

  switchTab("chat");
}

leaveBtn.addEventListener("click", () => {
  if (currentRoom) {
    socket.emit("leave-room", { room: currentRoom });
  }
  appScreen.classList.add("hidden");
  entryScreen.classList.remove("hidden");
  roomInput.focus();
});

// ===== Socket Events: Init =====
socket.on("init", (data) => {
  anonymousId = data.anonymousId;
  userColor = data.color;
  renderRoomList(data.rooms);
  postsData = data.posts || [];

  feedUserAvatar.style.background = userColor;

  // Render existing posts (from other users) into the feed
  renderFeed();

  // Process any deferred room join (ensures server has our userSockets entry)
  if (pendingJoin) {
    socket.emit("join-room", { room: pendingJoin });
    pendingJoin = null;
  }
});

// ===== Socket Events: Chat =====
socket.on("room-list", (rooms) => {
  renderRoomList(rooms);
});

socket.on("room-joined", (data) => {
  currentRoom = data.room;
  anonymousId = data.anonymousId;
  userColor = data.color;

  feedUserAvatar.style.background = userColor;

  currentRoomName.textContent = `#${data.room}`;
  roomUserCount.textContent = `${data.users} user${data.users !== 1 ? "s" : ""}`;

  renderMessages(data.history);
  scrollToBottom(false);
  messageInput.focus();
  updateActiveRoom(data.room);
});

socket.on("new-message", (message) => {
  appendMessage(message);
  if (isNearBottom()) scrollToBottom();
});

socket.on("user-joined", (data) => {
  roomUserCount.textContent = `${data.users} user${data.users !== 1 ? "s" : ""}`;
  appendSystemMessage(`${data.user} joined`);
});

socket.on("user-left", (data) => {
  roomUserCount.textContent = `${data.users} user${data.users !== 1 ? "s" : ""}`;
  appendSystemMessage(`${data.user} left`);
});

socket.on("room-left", () => {
  currentRoom = null;
  switchTab("chat");
});

// ===== Socket Events: Feed =====

socket.on("post-created", (post) => {
  postsData.unshift(post);
  const el = createPostElement(post);
  el.style.animation = "none";
  feedList.prepend(el);
  // Remove empty-feed placeholder if present
  const empty = feedList.querySelector(".empty-feed");
  if (empty) empty.remove();
});

socket.on("post-updated", (post) => {
  const idx = postsData.findIndex((p) => p.id === post.id);
  if (idx !== -1) {
    postsData[idx] = post;
    // Update the post element in-place (preserves comment section state)
    const el = document.getElementById(`post-${post.id}`);
    if (el) {
      const isLiked = post.likes.includes(anonymousId);
      const isDisliked = post.dislikes.includes(anonymousId);

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

      // Update comment count
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

    // Update comment count button
    const el = document.getElementById(`post-${postId}`);
    if (el) {
      const commentBtn = el.querySelector('[data-action="toggle-comments"]');
      if (commentBtn) {
        const count = commentBtn.querySelector(".action-count");
        if (count) count.textContent = commentCount;
      }
    }

    // If comments are open for this post, append comment
    const section = document.querySelector(`.comments-section[data-post-id="${postId}"]`);
    if (section && !section.classList.contains("hidden")) {
      section.querySelector(".comments-list").appendChild(createCommentElement(comment, postId));
    }
  }
});

socket.on("comment-updated", ({ postId, comment }) => {
  const post = postsData.find((p) => p.id === postId);
  if (post) {
    // Update in-memory
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

// ===== Render Functions: Chat =====
function renderRoomList(rooms) {
  roomList.innerHTML = "";

  if (rooms.length === 0) {
    roomList.innerHTML = `<div class="room-item" style="color: var(--text-muted); font-size: 13px; padding: 20px 12px; text-align: center; justify-content: center;">No rooms yet.<br>Create one to start chatting!</div>`;
    return;
  }

  rooms.forEach((room) => {
    const el = document.createElement("div");
    el.className = `room-item${currentRoom === room.name ? " active" : ""}`;
    el.innerHTML = `
      <div class="room-item-icon">#</div>
      <div class="room-item-info">
        <div class="room-item-name">${escapeHtml(room.name)}</div>
        <div class="room-item-count">${room.users} user${room.users !== 1 ? "s" : ""}</div>
      </div>
      <div class="room-item-status"></div>
    `;
    el.addEventListener("click", () => joinRoom(room.name));
    roomList.appendChild(el);
  });
}

function renderMessages(messages) {
  messagesContainer.innerHTML = "";

  if (messages.length === 0) {
    const welcome = document.createElement("div");
    welcome.className = "welcome-message";
    welcome.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style="margin: 0 auto 12px; display: block;">
        <rect width="48" height="48" rx="12" fill="url(#gw)"/>
        <path d="M14 28C14 24.6863 16.6863 22 20 22H28C31.3137 22 34 24.6863 34 28V34H14V28Z" fill="white" fill-opacity="0.9"/>
        <defs>
          <linearGradient id="gw" x1="0" y1="0" x2="48" y2="48">
            <stop stop-color="#667eea"/><stop offset="1" stop-color="#764ba2"/>
          </linearGradient>
        </defs>
      </svg>
      <p>Welcome to #${escapeHtml(currentRoom)}!<br>Start the conversation by sending a message below.</p>
    `;
    messagesContainer.appendChild(welcome);
    return;
  }

  messages.forEach((msg) => appendMessage(msg, false));
}

function appendMessage(message, animate = true) {
  const welcome = messagesContainer.querySelector(".welcome-message");
  if (welcome) welcome.remove();

  const el = document.createElement("div");
  el.className = "message";
  el.style.animation = animate ? "messageIn 0.25s ease" : "none";

  el.innerHTML = `
    <div class="message-avatar" style="background: ${message.color}">
      ${message.user.charAt(5).toUpperCase() || "?"}
    </div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-user" style="color: ${message.color}">${escapeHtml(message.user)}</span>
        <span class="message-time">${formatTime(message.timestamp)}</span>
      </div>
      <div class="message-bubble">
        <div class="message-text">${escapeHtml(message.text)}</div>
      </div>
    </div>
  `;
  messagesContainer.appendChild(el);
}

function appendSystemMessage(text) {
  const el = document.createElement("div");
  el.className = "system-message";
  el.innerHTML = `
    <span class="line"></span>
    <span>${escapeHtml(text)}</span>
    <span class="line"></span>
  `;
  messagesContainer.appendChild(el);
  if (isNearBottom()) scrollToBottom();
}

function updateActiveRoom(roomName) {
  document.querySelectorAll(".room-item").forEach((el) => {
    const nameEl = el.querySelector(".room-item-name");
    if (nameEl && nameEl.textContent === roomName) {
      el.classList.add("active");
    } else {
      el.classList.remove("active");
    }
  });
}

// ===== Chat Actions =====
function joinRoom(room) {
  if (!room || typeof room !== "string") return;
  const trimmed = room.trim();
  if (!trimmed) return;
  // If init hasn't been received yet, defer the join until it arrives
  if (!anonymousId) {
    pendingJoin = trimmed;
    return;
  }
  socket.emit("join-room", { room: trimmed });
  switchTab("chat");
}

function createRoom() {
  const name = createRoomInput.value.trim();
  if (!name) return;
  createRoomInput.value = "";
  joinRoom(name);
}

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentRoom) return;

  socket.emit("send-message", { room: currentRoom, text });
  messageInput.value = "";
  sendBtn.disabled = true;
  messageInput.focus();
}

// ===== Chat Event Listeners =====
createRoomBtn.addEventListener("click", createRoom);
createRoomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createRoom();
});

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
messageInput.addEventListener("input", () => {
  sendBtn.disabled = !messageInput.value.trim();
});

leaveRoomBtn.addEventListener("click", () => {
  if (currentRoom) {
    socket.emit("leave-room", { room: currentRoom });
  }
});

$("messages-area").addEventListener("scroll", () => {
  isAtBottom = isNearBottom();
});

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  sidebarOverlay.classList.toggle("show");
});
sidebarOverlay.addEventListener("click", () => {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
});
document.addEventListener("click", (e) => {
  const roomItem = e.target.closest(".room-item");
  if (roomItem && window.innerWidth <= 768) {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("show");
  }
});

// ===== Socket Connection Events =====
socket.on("connect", () => {
  disconnectBanner.classList.add("hidden");
  if (currentRoom) {
    socket.emit("join-room", { room: currentRoom });
  }
});
socket.on("disconnect", () => {
  disconnectBanner.classList.remove("hidden");
});

// ===== Popular Rooms =====
const POPULAR_ROOMS = ["general", "random", "tech", "gaming", "music"];
function renderPopularRooms() {
  POPULAR_ROOMS.forEach((room) => {
    const tag = document.createElement("span");
    tag.className = "room-tag";
    tag.textContent = `#${room}`;
    tag.addEventListener("click", () => {
      enterApp(roomInput.value.trim() || "Guest");
      // Use a microtask delay to let init propagate if needed
      setTimeout(() => joinRoom(room), 50);
    });
    popularTags.appendChild(tag);
  });
}
renderPopularRooms();

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
      <div class="empty-feed">
        <svg width="64" height="64" viewBox="0 0 48 48" fill="none" style="margin: 0 auto; display: block;">
          <rect width="48" height="48" rx="12" fill="url(#ge)"/>
          <line x1="16" y1="18" x2="32" y2="18" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
          <line x1="16" y1="24" x2="28" y2="24" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
          <line x1="16" y1="30" x2="24" y2="30" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.3"/>
          <defs>
            <linearGradient id="ge" x1="0" y1="0" x2="48" y2="48">
              <stop stop-color="#667eea"/><stop offset="1" stop-color="#764ba2"/>
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
      // Reload comments since we re-created the element
      socket.emit("get-comments", { postId });
    }
  });
  openComments.clear();
}

function createPostElement(post) {
  const el = document.createElement("div");
  el.className = "feed-post";
  el.id = `post-${post.id}`;

  const isLiked = post.likes.includes(anonymousId);
  const isDisliked = post.dislikes.includes(anonymousId);

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
      <div class="post-avatar" style="background: ${post.color}">${post.anonymousId.charAt(5).toUpperCase()}</div>
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

  // Post action event listeners
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

  // Comment input
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

  const isLiked = comment.likes.includes(anonymousId);
  const isDisliked = comment.dislikes.includes(anonymousId);

  el.innerHTML = `
    <div class="comment-avatar" style="background: ${comment.color}">${comment.anonymousId.charAt(5).toUpperCase()}</div>
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

  // Comment action listeners
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

// ===== Init =====
roomInput.focus();
