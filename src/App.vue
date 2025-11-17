<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { api } from "./services/api";
import { createRoomSocket } from "./net/socket";
import { createMessageId, hydrateMessage, toDisplayText } from "./services/messageService";

type Room = {
    id: string;
    name: string;
    type: string;
    members: string[];
    createdAt: number;
    createdBy: string;
};

type UserProfile = {
    username: string;
    publicKey?: string | null;
    friends: string[];
    friendRequests: string[];
    rooms: Room[];
};

type ChatMessage = ReturnType<typeof hydrateMessage>;

const authMode = ref<"login" | "register">("login");
const authForm = reactive({ username: "", password: "" });
const token = ref<string | null>(localStorage.getItem("token"));
const currentUser = ref<UserProfile | null>(null);
const rooms = ref<Room[]>([]);
const friends = ref<string[]>([]);
const pendingRequests = ref<string[]>([]);
const selectedRoomId = ref<string | null>(null);
const messages = ref<ChatMessage[]>([]);
const messageInput = ref("");
const messageContainer = ref<HTMLDivElement | null>(null);
const leftPanelOpen = ref(true);
const notice = ref<string | null>(null);
const loadingProfile = ref(false);
const loadingMessages = ref(false);
const friendInput = ref("");
const socketStatus = ref<"idle" | "connecting" | "open" | "closed">("idle");
const contextMenu = ref<{ x: number; y: number; message: ChatMessage } | null>(null);

let messageIndex = new Map<string, number>();
let socketControl: { dispose: VoidFunction; sendChat: (payload: any) => void } | null = null;

const selectedRoom = computed(() => rooms.value.find((r) => r.id === selectedRoomId.value) || null);
const sortedMessages = computed(() => [...messages.value].sort((a, b) => a.createdAt - b.createdAt));
const isMobile = computed(() => window.innerWidth < 900);

const canDeleteMessage = (msg: ChatMessage) => {
    const room = selectedRoom.value;
    const username = currentUser.value?.username;
    if (!room || !username) return false;
    return msg.from === username || room.createdBy === username;
};

watch(
    () => messages.value.length,
    async () => {
        await nextTick();
        if (messageContainer.value) {
            messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
        }
    }
);

onMounted(() => {
    if (token.value) {
        bootstrap();
    }
    leftPanelOpen.value = !isMobile.value;
    document.addEventListener("click", closeContextMenu);
});

onBeforeUnmount(() => {
    disconnectRoom();
    document.removeEventListener("click", closeContextMenu);
});

function setToken(value: string | null) {
    token.value = value;
    if (value) localStorage.setItem("token", value);
    else localStorage.removeItem("token");
}

function showNotice(message: string) {
    notice.value = message;
    setTimeout(() => {
        if (notice.value === message) notice.value = null;
    }, 3200);
}

async function bootstrap() {
    if (!token.value) return;
    loadingProfile.value = true;
    try {
        const profile = await api.profile(token.value);
        currentUser.value = profile;
        rooms.value = profile.rooms || [];
        friends.value = profile.friends || [];
        pendingRequests.value = profile.friendRequests || [];
        if (!selectedRoomId.value && rooms.value.length) {
            await selectRoom(rooms.value[0].id);
        }
    } catch (err: any) {
        showNotice(err?.message || "无法加载用户信息");
        setToken(null);
    } finally {
        loadingProfile.value = false;
    }
}

async function handleAuth() {
    const credentials = { username: authForm.username.trim(), password: authForm.password.trim() };
    if (!credentials.username || !credentials.password) {
        showNotice("请输入用户名和密码");
        return;
    }
    loadingProfile.value = true;
    try {
        const resp =
            authMode.value === "login" ? await api.login(credentials) : await api.register({ ...credentials });
        setToken(resp.token);
        await bootstrap();
    } catch (err: any) {
        showNotice(err?.message || "操作失败");
    } finally {
        loadingProfile.value = false;
    }
}

function logout() {
    disconnectRoom();
    currentUser.value = null;
    rooms.value = [];
    friends.value = [];
    pendingRequests.value = [];
    messages.value = [];
    selectedRoomId.value = null;
    setToken(null);
}

async function sendFriendRequest() {
    if (!friendInput.value.trim() || !token.value) return;
    const target = friendInput.value.trim();
    try {
        await api.sendFriendRequest(token.value, target);
        showNotice(`已发送好友请求给 ${target}`);
        friendInput.value = "";
        await bootstrap();
    } catch (err: any) {
        showNotice(err?.message || "好友请求发送失败");
    }
}

async function respondFriend(user: string, accept: boolean) {
    if (!token.value) return;
    try {
        await api.respondFriendRequest(token.value, user, accept);
        showNotice(accept ? `已接受 ${user}` : `已忽略 ${user}`);
        await bootstrap();
    } catch (err: any) {
        showNotice(err?.message || "处理好友请求失败");
    }
}

async function startChatWith(friend: string) {
    const existing = rooms.value.find((r) => r.type === "direct" && r.members.includes(friend));
    if (existing) {
        await selectRoom(existing.id);
        return;
    }
    if (!token.value) return;
    try {
        const created = await api.createRoom(token.value, {
            name: `Chat with ${friend}`,
            type: "direct",
            members: [friend],
        });
        const newRoom = created.room as Room;
        rooms.value = [newRoom, ...rooms.value];
        await selectRoom(newRoom.id);
    } catch (err: any) {
        showNotice(err?.message || "创建会话失败");
    }
}

async function selectRoom(roomId: string) {
    if (!token.value) return;
    selectedRoomId.value = roomId;
    contextMenu.value = null;
    messageInput.value = "";
    messages.value = [];
    messageIndex = new Map<string, number>();
    await loadMessages(roomId);
    connectRoom(roomId);
    if (isMobile.value) {
        leftPanelOpen.value = false;
    }
}

async function loadMessages(roomId: string) {
    if (!token.value) return;
    loadingMessages.value = true;
    try {
        const data = await api.getMessages(token.value, roomId);
        messages.value = [];
        messageIndex = new Map<string, number>();
        (data.messages || []).forEach((m: any) => upsertMessage(hydrateMessage(m)));
    } catch (err: any) {
        showNotice(err?.message || "拉取消息失败");
    } finally {
        loadingMessages.value = false;
    }
}

function connectRoom(roomId: string) {
    disconnectRoom();
    socketStatus.value = "connecting";
    socketControl = createRoomSocket(roomId, token.value!, {
        onOpen: () => (socketStatus.value = "open"),
        onClose: () => (socketStatus.value = "closed"),
        onError: () => showNotice("连接异常"),
        onHistory: (history: any[]) => history.forEach((m) => upsertMessage(hydrateMessage(m))),
        onChat: (msg: any) => upsertMessage(hydrateMessage(msg)),
        onDeleted: (id: string) => markDeleted(id),
    });
}

function disconnectRoom() {
    socketControl?.dispose();
    socketControl = null;
    socketStatus.value = "closed";
}

function upsertMessage(msg: ChatMessage) {
    if (!msg.id) return;
    const existingIndex = messageIndex.get(msg.id);
    if (existingIndex !== undefined) {
        messages.value[existingIndex] = { ...messages.value[existingIndex], ...msg, pending: false };
        messages.value = [...messages.value];
    } else {
        messageIndex.set(msg.id, messages.value.length);
        messages.value = [...messages.value, msg];
    }
}

function markDeleted(id: string) {
    const idx = messageIndex.get(id);
    if (idx === undefined) return;
    messages.value[idx] = { ...messages.value[idx], deleted: true, pending: false };
    messages.value = [...messages.value];
}

async function sendCurrentMessage() {
    if (!messageInput.value.trim() || !socketControl || socketStatus.value !== "open" || !currentUser.value) return;
    const id = createMessageId();
    const text = messageInput.value.trim();
    const pendingMsg = {
        id,
        from: currentUser.value.username,
        ciphertext: text,
        createdAt: Date.now(),
        kind: "text",
        pending: true,
    } as ChatMessage;
    upsertMessage(pendingMsg);
    messageInput.value = "";
    try {
        socketControl.sendChat({ id, ciphertext: text, kind: "text" });
    } catch (err: any) {
        showNotice(err?.message || "发送失败");
        markDeleted(id);
    }
}

async function deleteMessage(message: ChatMessage) {
    if (!selectedRoomId.value || !token.value || !canDeleteMessage(message)) return;
    try {
        await api.deleteMessage(token.value, selectedRoomId.value, message.id);
        markDeleted(message.id);
    } catch (err: any) {
        showNotice(err?.message || "撤回失败");
    } finally {
        closeContextMenu();
    }
}

function openContextMenu(event: MouseEvent, message: ChatMessage) {
    event.preventDefault();
    contextMenu.value = { x: event.clientX, y: event.clientY, message };
}

function closeContextMenu() {
    contextMenu.value = null;
}

async function copyMessage(message: ChatMessage) {
    try {
        await navigator.clipboard.writeText(toDisplayText(message));
        showNotice("已复制");
    } catch {
        showNotice("复制失败");
    } finally {
        closeContextMenu();
    }
}

const avatarStyle = (name: string) => {
    const hash = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const hue = hash % 360;
    const hue2 = (hash * 7) % 360;
    return {
        background: `linear-gradient(135deg, hsl(${hue}, 70%, 55%), hsl(${hue2}, 70%, 50%))`,
        color: "#fff",
    };
};

const displayName = (name: string) => name || "匿名";
</script>

<template>
  <div class="app">
    <div v-if="!token || !currentUser" class="auth-page">
      <div class="auth-card">
        <div class="brand">E2E Chat</div>
        <div class="mode-switch">
          <button :class="{ active: authMode === 'login' }" @click="authMode = 'login'">登录</button>
          <button :class="{ active: authMode === 'register' }" @click="authMode = 'register'">注册</button>
        </div>
        <div class="field">
          <label>用户名</label>
          <input v-model="authForm.username" autocomplete="username" />
        </div>
        <div class="field">
          <label>密码</label>
          <input v-model="authForm.password" type="password" autocomplete="current-password" />
        </div>
        <button class="primary" :disabled="loadingProfile" @click="handleAuth">
          {{ authMode === 'login' ? '登录' : '注册并开始聊天' }}
        </button>
        <p class="hint">登录后即可添加好友、创建会话并实时聊天。</p>
      </div>
    </div>

    <div v-else class="layout">
      <header class="top-bar">
        <div class="brand">E2E Chat</div>
        <div class="top-actions">
          <div class="user-chip">
            <div class="avatar" :style="avatarStyle(currentUser.username)">{{ currentUser.username[0]?.toUpperCase() }}</div>
            <div class="meta">
              <div class="name">{{ displayName(currentUser.username) }}</div>
              <div class="status">
                <span class="dot" :class="socketStatus"></span>
                {{ socketStatus === 'open' ? '在线' : socketStatus === 'connecting' ? '连接中' : '未连接' }}
              </div>
            </div>
          </div>
          <button class="ghost small" @click="leftPanelOpen = !leftPanelOpen">好友/房间</button>
          <button class="ghost small" @click="bootstrap" :disabled="loadingProfile">刷新</button>
          <button class="danger small" @click="logout">退出</button>
        </div>
      </header>

      <div class="content">
        <aside class="side-panel" :class="{ open: leftPanelOpen }">
          <section class="card">
            <div class="section-title">添加好友</div>
            <div class="row">
              <input v-model="friendInput" placeholder="输入好友用户名" @keyup.enter="sendFriendRequest" />
              <button class="primary small" @click="sendFriendRequest">邀请</button>
            </div>
          </section>

          <section class="card" v-if="pendingRequests.length">
            <div class="section-title">待验证</div>
            <div class="pill-list">
              <div class="pill" v-for="u in pendingRequests" :key="u">
                <span>{{ u }}</span>
                <div class="actions">
                  <button class="ghost tiny" @click="respondFriend(u, true)">通过</button>
                  <button class="ghost tiny" @click="respondFriend(u, false)">忽略</button>
                </div>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="section-title">好友</div>
            <div v-if="!friends.length" class="empty">暂无好友</div>
            <div v-else class="list">
              <div class="list-item" v-for="f in friends" :key="f" @click="startChatWith(f)">
                <div class="avatar small" :style="avatarStyle(f)">{{ f[0]?.toUpperCase() }}</div>
                <div class="info">
                  <div class="name">{{ displayName(f) }}</div>
                  <div class="sub">点击开始私聊</div>
                </div>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="section-title">会话</div>
            <div v-if="!rooms.length" class="empty">还没有加入任何房间</div>
            <div class="list">
              <div
                v-for="room in rooms"
                :key="room.id"
                class="list-item"
                :class="{ active: room.id === selectedRoomId }"
                @click="selectRoom(room.id)"
              >
                <div class="avatar small" :style="avatarStyle(room.name)">{{ room.name[0]?.toUpperCase() }}</div>
                <div class="info">
                  <div class="name">{{ room.name }}</div>
                  <div class="sub">{{ room.type === 'direct' ? '单聊' : '群组' }} · {{ room.members.length }} 人</div>
                </div>
              </div>
            </div>
          </section>
        </aside>

        <main class="chat-panel">
          <div v-if="!selectedRoom" class="placeholder">
            <p>选择好友或房间开始聊天</p>
          </div>

          <div v-else class="chat-window">
            <div class="chat-header">
              <div>
                <div class="title">{{ selectedRoom.name }}</div>
                <div class="sub">
                  {{ selectedRoom.type === 'direct' ? '双人会话' : '群组会话' }} · {{ selectedRoom.members.join(', ') }}
                </div>
              </div>
              <div class="status-pill">
                <span class="dot" :class="socketStatus"></span>
                {{ socketStatus === 'open' ? '实时同步' : '等待连接' }}
              </div>
            </div>

            <div ref="messageContainer" class="messages" :class="{ loading: loadingMessages }">
              <transition-group name="msg" tag="div">
                <div
                  v-for="msg in sortedMessages"
                  :key="msg.id"
                  class="bubble-row"
                  :class="{ me: msg.from === currentUser.username }"
                  @contextmenu="openContextMenu($event, msg)"
                >
                  <div class="avatar small" :style="avatarStyle(msg.from)">{{ msg.from[0]?.toUpperCase() }}</div>
                  <div class="bubble">
                    <div class="bubble-meta">
                      <span class="who">{{ msg.from === currentUser.username ? '我' : msg.from }}</span>
                      <span class="time">{{ new Date(msg.createdAt).toLocaleTimeString() }}</span>
                      <span v-if="msg.pending" class="pending">发送中</span>
                      <span v-if="msg.deleted" class="pending">已撤回</span>
                    </div>
                    <div class="bubble-text">{{ toDisplayText(msg) }}</div>
                  </div>
                </div>
              </transition-group>
            </div>

            <div class="input-bar">
              <textarea
                v-model="messageInput"
                rows="2"
                placeholder="按 Enter 发送，Shift+Enter 换行"
                @keydown.enter.exact.prevent="sendCurrentMessage"
              />
              <button class="primary" :disabled="!messageInput.trim()" @click="sendCurrentMessage">发送</button>
            </div>
          </div>
        </main>
      </div>
    </div>

    <div v-if="contextMenu" class="context-menu" :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }">
      <button @click.stop="copyMessage(contextMenu.message)">复制</button>
      <button v-if="canDeleteMessage(contextMenu.message)" @click.stop="deleteMessage(contextMenu.message)">撤回</button>
      <button class="ghost" @click.stop="closeContextMenu">关闭</button>
    </div>

    <div v-if="notice" class="toast">{{ notice }}</div>
  </div>
</template>

<style scoped>
:global(body) {
  margin: 0;
  font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
  background: radial-gradient(circle at 20% 20%, #ecf3ff, #fdfdff 45%), radial-gradient(circle at 80% 0%, #e3f7ff, #ffffff 40%);
  min-height: 100vh;
}

.app {
  color: #0f172a;
}

.brand {
  font-weight: 800;
  letter-spacing: 0.4px;
}

.auth-page {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 24px;
}

.auth-card {
  width: min(420px, 90vw);
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);
  padding: 28px;
  animation: float-in 320ms ease;
}

.auth-card .brand {
  font-size: 24px;
  margin-bottom: 16px;
}

.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 16px;
}
.mode-switch button {
  border: 1px solid #e2e8f0;
  padding: 10px;
  border-radius: 10px;
  background: #f8fafc;
  cursor: pointer;
  transition: all 0.2s ease;
}
.mode-switch button.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
  box-shadow: 0 10px 30px rgba(37, 99, 235, 0.25);
}

.field {
  display: flex;
  flex-direction: column;
  margin-bottom: 12px;
}
.field label {
  font-size: 12px;
  color: #475569;
  margin-bottom: 4px;
}
.field input {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  transition: border-color 0.2s ease;
}
.field input:focus {
  outline: none;
  border-color: #2563eb;
}

.primary {
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 12px 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.2s ease;
}
.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 30px rgba(79, 70, 229, 0.25);
}

.ghost {
  background: transparent;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
.danger {
  background: #ef4444;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
.small {
  padding: 8px 10px;
  font-size: 13px;
}
.tiny {
  padding: 4px 8px;
  font-size: 12px;
}

.hint {
  color: #6b7280;
  font-size: 12px;
  margin-top: 10px;
  text-align: center;
}

.layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  backdrop-filter: blur(8px);
  background: rgba(255, 255, 255, 0.9);
  position: sticky;
  top: 0;
  z-index: 4;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}
.user-chip .meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.user-chip .name {
  font-weight: 700;
}
.user-chip .status {
  color: #64748b;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  display: inline-block;
  background: #94a3b8;
}
.dot.open {
  background: #22c55e;
  box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.15);
}
.dot.connecting {
  background: #f59e0b;
  box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.15);
}
.dot.closed,
.dot.idle {
  background: #cbd5e1;
}

.content {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 14px;
  padding: 14px;
}

.side-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
  padding: 14px;
  border: 1px solid #e2e8f0;
}

.section-title {
  font-weight: 700;
  margin-bottom: 10px;
  color: #0f172a;
}

.row {
  display: flex;
  gap: 8px;
}
.row input,
.card input {
  flex: 1;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px;
}

.pill-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pill {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pill .actions {
  display: flex;
  gap: 6px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.list-item {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  padding: 8px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.12s ease;
}
.list-item:hover {
  background: #f1f5f9;
  transform: translateY(-1px);
}
.list-item.active {
  background: #e0ecff;
  border: 1px solid #c7d7ff;
}
.info .name {
  font-weight: 700;
}
.info .sub {
  color: #64748b;
  font-size: 12px;
}

.avatar {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-weight: 800;
  color: #fff;
}
.avatar.small {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-size: 14px;
}

.chat-panel {
  min-height: 65vh;
}

.placeholder {
  background: rgba(255, 255, 255, 0.8);
  border: 1px dashed #d0d7e2;
  border-radius: 16px;
  min-height: 300px;
  display: grid;
  place-items: center;
  color: #475569;
}

.chat-window {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 160px);
  min-height: 420px;
}

.chat-header {
  padding: 14px 16px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.chat-header .title {
  font-size: 18px;
  font-weight: 800;
}
.chat-header .sub {
  color: #64748b;
  font-size: 13px;
}
.status-pill {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  background: linear-gradient(#f8fbff, #fff);
}
.messages.loading {
  opacity: 0.6;
}

.bubble-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  margin-bottom: 10px;
  align-items: flex-end;
}
.bubble-row.me {
  grid-template-columns: 1fr auto;
}
.bubble-row.me .bubble {
  background: #2563eb;
  color: #fff;
}
.bubble-row.me .bubble-text {
  color: #fff;
}
.bubble-row.me .avatar {
  order: 2;
}

.bubble {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 10px 12px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.07);
}
.bubble-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 4px;
}
.bubble-text {
  white-space: pre-wrap;
  color: #0f172a;
}
.pending {
  color: #f59e0b;
}

.input-bar {
  border-top: 1px solid #e2e8f0;
  padding: 12px;
  display: flex;
  gap: 10px;
}
.input-bar textarea {
  flex: 1;
  resize: none;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 10px;
  font-size: 14px;
  min-height: 60px;
}

.context-menu {
  position: fixed;
  background: #fff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  border-radius: 10px;
  padding: 6px;
  display: grid;
  gap: 4px;
  z-index: 20;
}
.context-menu button {
  text-align: left;
  border: none;
  background: #f8fafc;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
}

.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #0f172a;
  color: #fff;
  padding: 12px 16px;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.3);
  animation: fade-in 200ms ease;
  z-index: 30;
}

.empty {
  color: #94a3b8;
  font-size: 13px;
}

@media (max-width: 960px) {
  .content {
    grid-template-columns: 1fr;
  }
  .side-panel {
    position: fixed;
    top: 64px;
    left: 0;
    right: 0;
    padding: 12px;
    background: rgba(255, 255, 255, 0.97);
    transform: translateY(-110%);
    transition: transform 0.2s ease;
    z-index: 5;
  }
  .side-panel.open {
    transform: translateY(0);
  }
  .chat-window {
    height: calc(100vh - 200px);
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translate(-50%, 10px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

@keyframes float-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.msg-enter-active,
.msg-leave-active {
  transition: all 0.18s ease;
}
.msg-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.msg-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
