const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// ===== Chat Storage =====
const rooms = new Map(); // roomName -> { messages, userCount }
const userSockets = new Map(); // socketId -> { rooms: Set, anonymousId: string, color: string }

// ===== Feed Storage =====
const posts = []; // Array of post objects (newest first)
const postComments = new Map(); // postId -> array of comment objects

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

function getRoomList() {
  const list = [];
  for (const [name, data] of rooms) {
    list.push({ name, users: data.userCount });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

function ensureRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, { messages: [], userCount: 0 });
  }
  return rooms.get(roomName);
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
  const anonymousId = generateAnonymousId();
  const color = getRandomColor();

  userSockets.set(socket.id, {
    rooms: new Set(),
    anonymousId,
    color,
  });

  console.log(`[Connect] ${anonymousId} connected`);

  // Send initial data
  socket.emit("init", {
    id: socket.id,
    anonymousId,
    color,
    rooms: getRoomList(),
    posts: posts.map(formatPostForClient),
  });

  // ===== Chat Events =====

  socket.on("join-room", (data, callback) => {
    const { room } = data;
    if (!room || typeof room !== "string") return;

    const trimmedRoom = room.trim();
    if (!trimmedRoom) return;

    const userData = userSockets.get(socket.id);
    if (!userData) return;

    for (const r of userData.rooms) {
      socket.leave(r);
      const roomData = rooms.get(r);
      if (roomData) {
        roomData.userCount = Math.max(0, roomData.userCount - 1);
        io.to(r).emit("user-left", { room: r, user: userData.anonymousId, users: roomData.userCount });
      }
    }
    userData.rooms.clear();

    socket.join(trimmedRoom);
    userData.rooms.add(trimmedRoom);
    const roomData = ensureRoom(trimmedRoom);
    roomData.userCount += 1;

    console.log(`[Join] ${userData.anonymousId} joined room: ${trimmedRoom}`);

    socket.emit("room-joined", {
      room: trimmedRoom,
      history: roomData.messages,
      users: roomData.userCount,
      anonymousId: userData.anonymousId,
      color: userData.color,
    });

    socket.to(trimmedRoom).emit("user-joined", {
      room: trimmedRoom,
      user: userData.anonymousId,
      users: roomData.userCount,
    });

    io.emit("room-list", getRoomList());

    if (callback && typeof callback === "function") {
      callback({ success: true, room: trimmedRoom });
    }
  });

  socket.on("leave-room", ({ room }) => {
    const userData = userSockets.get(socket.id);
    if (!userData || !room) return;

    if (userData.rooms.has(room)) {
      socket.leave(room);
      userData.rooms.delete(room);
      const roomData = rooms.get(room);
      if (roomData) {
        roomData.userCount = Math.max(0, roomData.userCount - 1);
        io.to(room).emit("user-left", {
          room,
          user: userData.anonymousId,
          users: roomData.userCount,
        });
      }
      socket.emit("room-left", { room });

      if (roomData && roomData.userCount === 0) {
        rooms.delete(room);
      }

      io.emit("room-list", getRoomList());
    }
  });

  socket.on("send-message", ({ room, text }) => {
    const userData = userSockets.get(socket.id);
    if (!userData || !room || !text || typeof text !== "string") return;

    const trimmedText = text.trim();
    if (!trimmedText) return;
    if (!userData.rooms.has(room)) return;

    const roomData = rooms.get(room);
    if (!roomData) return;

    const message = {
      id: generateId(),
      user: userData.anonymousId,
      color: userData.color,
      text: trimmedText,
      timestamp: Date.now(),
      room,
    };

    roomData.messages.push(message);
    if (roomData.messages.length > 200) {
      roomData.messages = roomData.messages.slice(-200);
    }

    io.to(room).emit("new-message", message);
  });

  socket.on("get-rooms", () => {
    socket.emit("room-list", getRoomList());
  });

  // ===== Feed Events =====

  // Create a post
  socket.on("create-post", ({ text, mediaUrl }) => {
    const userData = userSockets.get(socket.id);
    if (!userData || !text || typeof text !== "string") return;

    const trimmedText = text.trim();
    if (!trimmedText) return;

    const trimmedMedia = mediaUrl && typeof mediaUrl === "string" ? mediaUrl.trim() : null;
    const mediaType = trimmedMedia ? detectMediaType(trimmedMedia) : null;

    if (trimmedMedia && !mediaType) {
      // URL provided but couldn't detect type — store as link
    }

    const post = {
      id: generateId(),
      anonymousId: userData.anonymousId,
      color: userData.color,
      text: trimmedText,
      mediaUrl: trimmedMedia || null,
      mediaType: mediaType,
      timestamp: Date.now(),
      likes: new Set(),
      dislikes: new Set(),
    };

    posts.unshift(post);

    // Keep only last 500 posts
    if (posts.length > 500) {
      const removed = posts.pop();
      postComments.delete(removed.id);
    }

    io.emit("post-created", formatPostForClient(post));
  });

  // Toggle like on a post
  socket.on("toggle-like-post", ({ postId }) => {
    const userData = userSockets.get(socket.id);
    if (!userData || !postId) return;

    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    const userId = userData.anonymousId;

    if (post.likes.has(userId)) {
      post.likes.delete(userId);
    } else {
      post.likes.add(userId);
      post.dislikes.delete(userId); // Remove dislike if exists
    }

    io.emit("post-updated", formatPostForClient(post));
  });

  // Toggle dislike on a post
  socket.on("toggle-dislike-post", ({ postId }) => {
    const userData = userSockets.get(socket.id);
    if (!userData || !postId) return;

    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    const userId = userData.anonymousId;

    if (post.dislikes.has(userId)) {
      post.dislikes.delete(userId);
    } else {
      post.dislikes.add(userId);
      post.likes.delete(userId); // Remove like if exists
    }

    io.emit("post-updated", formatPostForClient(post));
  });

  // Add a comment to a post
  socket.on("add-comment", ({ postId, text }) => {
    const userData = userSockets.get(socket.id);
    if (!userData || !postId || !text || typeof text !== "string") return;

    const trimmedText = text.trim();
    if (!trimmedText) return;

    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    const comment = {
      id: generateId(),
      postId: postId,
      anonymousId: userData.anonymousId,
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

    // Keep only last 200 comments per post
    if (postComments.get(postId).length > 200) {
      postComments.get(postId) = postComments.get(postId).slice(-200);
    }

    io.emit("comment-added", {
      postId,
      comment: formatCommentForClient(comment),
      commentCount: postComments.get(postId).length,
    });
  });

  // Toggle like on a comment
  socket.on("toggle-like-comment", ({ postId, commentId }) => {
    const userData = userSockets.get(socket.id);
    if (!userData || !postId || !commentId) return;

    const comments = postComments.get(postId);
    if (!comments) return;

    const comment = comments.find((c) => c.id === commentId);
    if (!comment) return;

    const userId = userData.anonymousId;

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

  // Toggle dislike on a comment
  socket.on("toggle-dislike-comment", ({ postId, commentId }) => {
    const userData = userSockets.get(socket.id);
    if (!userData || !postId || !commentId) return;

    const comments = postComments.get(postId);
    if (!comments) return;

    const comment = comments.find((c) => c.id === commentId);
    if (!comment) return;

    const userId = userData.anonymousId;

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

  // Get comments for a post
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
    const userData = userSockets.get(socket.id);
    if (!userData) return;

    console.log(`[Disconnect] ${userData.anonymousId} disconnected`);

    for (const room of userData.rooms) {
      socket.leave(room);
      const roomData = rooms.get(room);
      if (roomData) {
        roomData.userCount = Math.max(0, roomData.userCount - 1);
        io.to(room).emit("user-left", {
          room,
          user: userData.anonymousId,
          users: roomData.userCount,
        });

        if (roomData.userCount === 0) {
          rooms.delete(room);
        }
      }
    }

    userSockets.delete(socket.id);
    io.emit("room-list", getRoomList());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  🚀 Social app running at http://localhost:${PORT}\n`);
});
