const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// ===== DM & User Storage =====
const users = new Map(); // socketId -> { id, name, color }
const dmMessages = new Map(); // "user1:user2" -> [{ from, to, text, timestamp }]

// ===== Feed Storage =====
const posts = [];
const postComments = new Map();

const ANONYMOUS_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
  "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
  "#F0B27A", "#82E0AA", "#F1948A", "#7FB3D8", "#E59866",
];

function getRandomColor() {
  return ANONYMOUS_COLORS[Math.floor(Math.random() * ANONYMOUS_COLORS.length)];
}

function generateAnonymousId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `User_${id}`;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getDMKey(a, b) {
  return [a, b].sort().join(":");
}

function detectMediaType(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const imageExts = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i;
  const youtubeRegex = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)/i;
  const vimeoRegex = /vimeo\.com\//i;

  if (imageExts.test(trimmed)) return "image";
  if (youtubeRegex.test(trimmed) || vimeoRegex.test(trimmed)) return "video";
  return "link";
}

function formatPostForClient(post) {
  return {
    id: post.id,
    anonymousId: post.anonymousId,
    color: post.color,
    text: post.text,
    mediaUrl: post.mediaUrl,
    mediaType: post.mediaType,
    timestamp: post.timestamp,
    likes: Array.from(post.likes),
    dislikes: Array.from(post.dislikes),
    commentCount: (postComments.get(post.id) || []).length,
  };
}

function formatCommentForClient(comment) {
  return {
    id: comment.id,
    postId: comment.postId,
    anonymousId: comment.anonymousId,
    color: comment.color,
    text: comment.text,
    timestamp: comment.timestamp,
    likes: Array.from(comment.likes),
    dislikes: Array.from(comment.dislikes),
  };
}

io.on("connection", (socket) => {
  const userId = generateAnonymousId();
  const color = getRandomColor();
  const user = { id: userId, name: userId, color };

  users.set(socket.id, user);

  console.log(`[Connect] ${userId} connected`);

  // Get online users (everyone else)
  const onlineUsers = [];
  for (const [sid, u] of users) {
    if (sid !== socket.id) {
      onlineUsers.push({ id: u.id, name: u.name, color: u.color });
    }
  }

  // Send init data
  socket.emit("init", {
    user,
    onlineUsers,
    posts: posts.map(formatPostForClient),
  });

  // Broadcast new user to everyone else
  socket.broadcast.emit("user-online", { id: user.id, name: user.name, color: user.color });

  // ===== DM Events =====

  socket.on("send-dm", ({ to, text }) => {
    const fromUser = users.get(socket.id);
    if (!fromUser || !text || typeof text !== "string") return;

    const trimmed = text.trim();
    if (!trimmed) return;

    const message = {
      from: fromUser.id,
      to,
      text: trimmed,
      timestamp: Date.now(),
    };

    const key = getDMKey(fromUser.id, to);
    if (!dmMessages.has(key)) dmMessages.set(key, []);
    dmMessages.get(key).push(message);

    if (dmMessages.get(key).length > 500) {
      dmMessages.get(key) = dmMessages.get(key).slice(-500);
    }

    // Send to recipient if online
    for (const [sid, u] of users) {
      if (u.id === to) {
        io.to(sid).emit("dm-message", message);
        break;
      }
    }

    // Send back to sender
    socket.emit("dm-message", message);
  });

  socket.on("get-dm-history", ({ with: otherId }) => {
    const myUser = users.get(socket.id);
    if (!myUser || !otherId) return;

    const key = getDMKey(myUser.id, otherId);
    socket.emit("dm-history", {
      with: otherId,
      messages: dmMessages.get(key) || [],
    });
  });

  // ===== Feed Events =====

  socket.on("create-post", ({ text, mediaUrl }) => {
    const userData = users.get(socket.id);
    if (!userData || !text || typeof text !== "string") return;

    const trimmedText = text.trim();
    if (!trimmedText) return;

    const trimmedMedia = mediaUrl && typeof mediaUrl === "string" ? mediaUrl.trim() : null;
    const mediaType = trimmedMedia ? detectMediaType(trimmedMedia) : null;

    const post = {
      id: generateId(),
      anonymousId: userData.id,
      color: userData.color,
      text: trimmedText,
      mediaUrl: trimmedMedia || null,
      mediaType: mediaType,
      timestamp: Date.now(),
      likes: new Set(),
      dislikes: new Set(),
    };

    posts.unshift(post);

    if (posts.length > 500) {
      const removed = posts.pop();
      postComments.delete(removed.id);
    }

    io.emit("post-created", formatPostForClient(post));
  });

  socket.on("toggle-like-post", ({ postId }) => {
    const userData = users.get(socket.id);
    if (!userData || !postId) return;

    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    const userId = userData.id;

    if (post.likes.has(userId)) {
      post.likes.delete(userId);
    } else {
      post.likes.add(userId);
      post.dislikes.delete(userId);
    }

    io.emit("post-updated", formatPostForClient(post));
  });

  socket.on("toggle-dislike-post", ({ postId }) => {
    const userData = users.get(socket.id);
    if (!userData || !postId) return;

    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    const userId = userData.id;

    if (post.dislikes.has(userId)) {
      post.dislikes.delete(userId);
    } else {
      post.dislikes.add(userId);
      post.likes.delete(userId);
    }

    io.emit("post-updated", formatPostForClient(post));
  });

  socket.on("add-comment", ({ postId, text }) => {
    const userData = users.get(socket.id);
    if (!userData || !postId || !text || typeof text !== "string") return;

    const trimmedText = text.trim();
    if (!trimmedText) return;

    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    const comment = {
      id: generateId(),
      postId: postId,
      anonymousId: userData.id,
      color: userData.color,
      text: trimmedText,
      timestamp: Date.now(),
      likes: new Set(),
      dislikes: new Set(),
    };

    if (!postComments.has(postId)) {
      postComments.set(postId, []);
    }
    postComments.get(postId).push(comment);

    if (postComments.get(postId).length > 200) {
      postComments.get(postId) = postComments.get(postId).slice(-200);
    }

    io.emit("comment-added", {
      postId,
      comment: formatCommentForClient(comment),
      commentCount: postComments.get(postId).length,
    });
  });

  socket.on("toggle-like-comment", ({ postId, commentId }) => {
    const userData = users.get(socket.id);
    if (!userData || !postId || !commentId) return;

    const comments = postComments.get(postId);
    if (!comments) return;

    const comment = comments.find((c) => c.id === commentId);
    if (!comment) return;

    const userId = userData.id;

    if (comment.likes.has(userId)) {
      comment.likes.delete(userId);
    } else {
      comment.likes.add(userId);
      comment.dislikes.delete(userId);
    }

    io.emit("comment-updated", {
      postId,
      comment: formatCommentForClient(comment),
    });
  });

  socket.on("toggle-dislike-comment", ({ postId, commentId }) => {
    const userData = users.get(socket.id);
    if (!userData || !postId || !commentId) return;

    const comments = postComments.get(postId);
    if (!comments) return;

    const comment = comments.find((c) => c.id === commentId);
    if (!comment) return;

    const userId = userData.id;

    if (comment.dislikes.has(userId)) {
      comment.dislikes.delete(userId);
    } else {
      comment.dislikes.add(userId);
      comment.likes.delete(userId);
    }

    io.emit("comment-updated", {
      postId,
      comment: formatCommentForClient(comment),
    });
  });

  socket.on("get-comments", ({ postId }) => {
    if (!postId) return;
    const comments = postComments.get(postId) || [];
    socket.emit("comments-loaded", {
      postId,
      comments: comments.map(formatCommentForClient),
    });
  });

  // ===== Disconnect =====
  socket.on("disconnect", () => {
    const disconnected = users.get(socket.id);
    if (!disconnected) return;

    console.log(`[Disconnect] ${disconnected.id} disconnected`);

    users.delete(socket.id);
    socket.broadcast.emit("user-offline", disconnected.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  🚀 Social app running at http://localhost:${PORT}\n`);
});
