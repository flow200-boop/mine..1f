const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// ===== User Storage (in-memory — transient socket sessions) =====
const users = new Map(); // socketId -> { id, name, color }

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

// ===== Supabase Helpers =====

function dbPostToClient(post, commentCount = 0) {
  return {
    id: post.id,
    anonymousId: post.anonymous_id,
    color: post.color,
    text: post.text,
    mediaUrl: post.media_url || null,
    mediaType: post.media_type || null,
    timestamp: new Date(post.created_at).getTime(),
    likes: post.likes || [],
    dislikes: post.dislikes || [],
    commentCount,
  };
}

function dbCommentToClient(comment) {
  return {
    id: comment.id,
    postId: comment.post_id,
    anonymousId: comment.anonymous_id,
    color: comment.color,
    text: comment.text,
    timestamp: new Date(comment.created_at).getTime(),
    likes: comment.likes || [],
    dislikes: comment.dislikes || [],
  };
}

async function loadPosts() {
  const { data: dbPosts, error } = await supabase
    .from("posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[DB] Error loading posts:", error.message);
    return [];
  }

  if (!dbPosts || dbPosts.length === 0) return [];

  // Get comment counts
  const postIds = dbPosts.map((p) => p.id);
  const { data: allComments } = await supabase
    .from("comments")
    .select("post_id");

  const countMap = {};
  (allComments || []).forEach((c) => {
    countMap[c.post_id] = (countMap[c.post_id] || 0) + 1;
  });

  return dbPosts.map((p) => dbPostToClient(p, countMap[p.id] || 0));
}

async function loadCommentsForPost(postId) {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[DB] Error loading comments:", error.message);
    return [];
  }

  return (data || []).map(dbCommentToClient);
}

async function getCommentCount(postId) {
  const { count, error } = await supabase
    .from("comments")
    .select("*", { count: "exact", head: true })
    .eq("post_id", postId);

  if (error) {
    console.error("[DB] Error counting comments:", error.message);
    return 0;
  }
  return count || 0;
}

// ===== Socket.IO =====

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

  // Send init data (posts loaded asynchronously)
  loadPosts().then((posts) => {
    socket.emit("init", {
      user,
      onlineUsers,
      posts,
    });
  });

  // Broadcast new user to everyone else
  socket.broadcast.emit("user-online", { id: user.id, name: user.name, color: user.color });

  // ===== DM Events =====

  socket.on("send-dm", async ({ to, text }) => {
    const fromUser = users.get(socket.id);
    if (!fromUser || !text || typeof text !== "string") return;

    const trimmed = text.trim();
    if (!trimmed) return;

    const message = {
      id: generateId(),
      sender_id: fromUser.id,
      receiver_id: to,
      text: trimmed,
    };

    const { error } = await supabase.from("dm_messages").insert(message);
    if (error) {
      console.error("[DB] Error saving DM:", error.message);
      return;
    }

    const clientMsg = {
      from: fromUser.id,
      to,
      text: trimmed,
      timestamp: Date.now(),
    };

    // Send to recipient if online
    for (const [sid, u] of users) {
      if (u.id === to) {
        io.to(sid).emit("dm-message", clientMsg);
        break;
      }
    }

    // Send back to sender
    socket.emit("dm-message", clientMsg);
  });

  socket.on("get-dm-history", async ({ with: otherId }) => {
    const myUser = users.get(socket.id);
    if (!myUser || !otherId) return;

    const { data, error } = await supabase
      .from("dm_messages")
      .select("*")
      .or(
        `and(sender_id.eq.${myUser.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myUser.id})`
      )
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) {
      console.error("[DB] Error loading DM history:", error.message);
      return;
    }

    const messages = (data || []).map((m) => ({
      from: m.sender_id,
      to: m.receiver_id,
      text: m.text,
      timestamp: new Date(m.created_at).getTime(),
    }));

    socket.emit("dm-history", {
      with: otherId,
      messages,
    });
  });

  // ===== Feed Events =====

  socket.on("create-post", async ({ text, mediaUrl }) => {
    const userData = users.get(socket.id);
    if (!userData || !text || typeof text !== "string") return;

    const trimmedText = text.trim();
    if (!trimmedText) return;

    const trimmedMedia = mediaUrl && typeof mediaUrl === "string" ? mediaUrl.trim() : null;
    const mediaType = trimmedMedia ? detectMediaType(trimmedMedia) : null;

    const now = new Date().toISOString();
    const dbPost = {
      id: generateId(),
      anonymous_id: userData.id,
      color: userData.color,
      text: trimmedText,
      media_url: trimmedMedia || null,
      media_type: mediaType,
      created_at: now,
      likes: [],
      dislikes: [],
    };

    const { error } = await supabase.from("posts").insert(dbPost);
    if (error) {
      console.error("[DB] Error creating post:", error.message);
      return;
    }

    const clientPost = dbPostToClient(dbPost);
    io.emit("post-created", clientPost);
  });

  socket.on("toggle-like-post", async ({ postId }) => {
    const userData = users.get(socket.id);
    if (!userData || !postId) return;

    const { data: post, error: fetchError } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      console.error("[DB] Error fetching post for like:", fetchError?.message);
      return;
    }

    let likes = post.likes || [];
    let dislikes = post.dislikes || [];

    if (likes.includes(userData.id)) {
      likes = likes.filter((id) => id !== userData.id);
    } else {
      likes = [...likes, userData.id];
      dislikes = dislikes.filter((id) => id !== userData.id);
    }

    const { error: updateError } = await supabase
      .from("posts")
      .update({ likes, dislikes })
      .eq("id", postId);

    if (updateError) {
      console.error("[DB] Error updating post likes:", updateError.message);
      return;
    }

    const commentCount = await getCommentCount(postId);
    io.emit("post-updated", dbPostToClient({ ...post, likes, dislikes }, commentCount));
  });

  socket.on("toggle-dislike-post", async ({ postId }) => {
    const userData = users.get(socket.id);
    if (!userData || !postId) return;

    const { data: post, error: fetchError } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      console.error("[DB] Error fetching post for dislike:", fetchError?.message);
      return;
    }

    let likes = post.likes || [];
    let dislikes = post.dislikes || [];

    if (dislikes.includes(userData.id)) {
      dislikes = dislikes.filter((id) => id !== userData.id);
    } else {
      dislikes = [...dislikes, userData.id];
      likes = likes.filter((id) => id !== userData.id);
    }

    const { error: updateError } = await supabase
      .from("posts")
      .update({ likes, dislikes })
      .eq("id", postId);

    if (updateError) {
      console.error("[DB] Error updating post dislikes:", updateError.message);
      return;
    }

    const commentCount = await getCommentCount(postId);
    io.emit("post-updated", dbPostToClient({ ...post, likes, dislikes }, commentCount));
  });

  socket.on("add-comment", async ({ postId, text }) => {
    const userData = users.get(socket.id);
    if (!userData || !postId || !text || typeof text !== "string") return;

    const trimmedText = text.trim();
    if (!trimmedText) return;

    // Verify post exists
    const { data: post, error: postCheck } = await supabase
      .from("posts")
      .select("id")
      .eq("id", postId)
      .single();

    if (postCheck || !post) return;

    const commentId = generateId();
    const now = new Date().toISOString();
    const dbComment = {
      id: commentId,
      post_id: postId,
      anonymous_id: userData.id,
      color: userData.color,
      text: trimmedText,
      created_at: now,
      likes: [],
      dislikes: [],
    };

    const { error } = await supabase.from("comments").insert(dbComment);
    if (error) {
      console.error("[DB] Error adding comment:", error.message);
      return;
    }

    const clientComment = dbCommentToClient(dbComment);
    const commentCount = await getCommentCount(postId);

    io.emit("comment-added", {
      postId,
      comment: clientComment,
      commentCount,
    });
  });

  socket.on("toggle-like-comment", async ({ postId, commentId }) => {
    const userData = users.get(socket.id);
    if (!userData || !postId || !commentId) return;

    const { data: comment, error: fetchError } = await supabase
      .from("comments")
      .select("*")
      .eq("id", commentId)
      .single();

    if (fetchError || !comment) {
      console.error("[DB] Error fetching comment for like:", fetchError?.message);
      return;
    }

    let likes = comment.likes || [];
    let dislikes = comment.dislikes || [];

    if (likes.includes(userData.id)) {
      likes = likes.filter((id) => id !== userData.id);
    } else {
      likes = [...likes, userData.id];
      dislikes = dislikes.filter((id) => id !== userData.id);
    }

    const { error: updateError } = await supabase
      .from("comments")
      .update({ likes, dislikes })
      .eq("id", commentId);

    if (updateError) {
      console.error("[DB] Error updating comment likes:", updateError.message);
      return;
    }

    io.emit("comment-updated", {
      postId,
      comment: dbCommentToClient({ ...comment, likes, dislikes }),
    });
  });

  socket.on("toggle-dislike-comment", async ({ postId, commentId }) => {
    const userData = users.get(socket.id);
    if (!userData || !postId || !commentId) return;

    const { data: comment, error: fetchError } = await supabase
      .from("comments")
      .select("*")
      .eq("id", commentId)
      .single();

    if (fetchError || !comment) {
      console.error("[DB] Error fetching comment for dislike:", fetchError?.message);
      return;
    }

    let likes = comment.likes || [];
    let dislikes = comment.dislikes || [];

    if (dislikes.includes(userData.id)) {
      dislikes = dislikes.filter((id) => id !== userData.id);
    } else {
      dislikes = [...dislikes, userData.id];
      likes = likes.filter((id) => id !== userData.id);
    }

    const { error: updateError } = await supabase
      .from("comments")
      .update({ likes, dislikes })
      .eq("id", commentId);

    if (updateError) {
      console.error("[DB] Error updating comment dislikes:", updateError.message);
      return;
    }

    io.emit("comment-updated", {
      postId,
      comment: dbCommentToClient({ ...comment, likes, dislikes }),
    });
  });

  socket.on("get-comments", async ({ postId }) => {
    if (!postId) return;
    const comments = await loadCommentsForPost(postId);
    socket.emit("comments-loaded", {
      postId,
      comments,
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
