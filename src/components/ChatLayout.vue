<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'
import { store } from '../services/store'
import { api } from '../net/api'

const messages = ref([])
const messageInput = ref('')
const ws = ref(null)
const messagesContainer = ref(null)
const newRoomName = ref('')
const showCreateRoom = ref(false)
const newFriendName = ref('')

// 初始化加载数据
onMounted(async () => {
  try {
    const [profile, rooms] = await Promise.all([
      api.getProfile(),
      api.getRooms()
    ])
    store.friends = profile.friends
    store.rooms = rooms.rooms
  } catch (e) {
    console.error(e)
  }
})

// 监听房间切换
watch(() => store.currentRoom, async (newRoom) => {
  if (!newRoom) return
  
  // 1. 关闭旧连接
  if (ws.value) ws.value.close()
  messages.value = []

  // 2. 获取历史记录 (API)
  try {
    const history = await api.getMessages(newRoom.id)
    messages.value = history.messages
    scrollToBottom()
  } catch (e) {
    console.error("Failed to load history", e)
  }

  // 3. 建立 WebSocket 连接
  // 后端支持 ?token=... 鉴权
  const wsUrl = import.meta.env.VITE_WEBSOCKET_URL || 'ws://localhost:8787/ws'
  const socketUrl = wsUrl.replace('{room}', newRoom.id)
  const socket = new WebSocket(`${socketUrl}?token=${store.token}`)
  
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.type === 'chat') {
      messages.value.push(data.message)
      scrollToBottom()
    } else if (data.type === 'history') {
      // WebSocket 也会推送最近的历史，这里做去重或合并
      // 简单起见，我们主要依赖 API 获取完整历史，这里忽略或仅追加新消息
    }
  }
  
  socket.onerror = (error) => {
    console.error('WebSocket error:', error)
  }
  
  socket.onclose = () => {
    console.log('WebSocket closed')
  }
  
  ws.value = socket
})

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

function sendMessage() {
  if (!messageInput.value.trim() || !ws.value) return
  
  // 注意：这里暂时发送明文作为 ciphertext。
  // 真正的 E2E 加密应该在这里使用 WebCrypto API 加密 messageInput.value
  const payload = {
    type: 'chat',
    ciphertext: messageInput.value, 
    kind: 'text'
  }
  
  ws.value.send(JSON.stringify(payload))
  messageInput.value = ''
}

async function createRoom() {
  if (!newRoomName.value) return
  try {
    const res = await api.createRoom(newRoomName.value)
    store.rooms.push(res.room)
    store.currentRoom = res.room
    newRoomName.value = ''
    showCreateRoom.value = false
  } catch (e) {
    alert(e.message)
  }
}

async function addFriend() {
  if (!newFriendName.value) return
  try {
    await api.addFriend(newFriendName.value)
    alert('好友请求已发送')
    newFriendName.value = ''
  } catch (e) {
    alert(e.message)
  }
}
</script>

<template>
  <div class="layout">
    <!-- 侧边栏 -->
    <div class="sidebar">
      <div class="user-profile">
        <div class="avatar">{{ store.user.username[0].toUpperCase() }}</div>
        <div class="username">{{ store.user.username }}</div>
        <button @click="store.logout()" class="logout-btn">退出</button>
      </div>

      <div class="section">
        <div class="section-header">
          <span>群组 / 房间</span>
          <button @click="showCreateRoom = !showCreateRoom">+</button>
        </div>
        
        <div v-if="showCreateRoom" class="create-form">
          <input v-model="newRoomName" placeholder="房间名" @keyup.enter="createRoom">
        </div>

        <div 
          v-for="room in store.rooms" 
          :key="room.id"
          class="channel-item"
          :class="{ active: store.currentRoom?.id === room.id }"
          @click="store.currentRoom = room"
        >
          # {{ room.name }}
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span>好友</span>
        </div>
        <div class="add-friend">
          <input v-model="newFriendName" placeholder="添加好友..." @keyup.enter="addFriend">
        </div>
        <div v-for="friend in store.friends" :key="friend" class="friend-item">
          {{ friend }}
        </div>
      </div>
    </div>

    <!-- 聊天主区域 -->
    <div class="chat-area">
      <div v-if="store.currentRoom" class="chat-header">
        <h3># {{ store.currentRoom.name }}</h3>
        <span class="topic">E2E Encrypted Channel</span>
      </div>

      <div v-if="store.currentRoom" class="messages" ref="messagesContainer">
        <div 
          v-for="msg in messages" 
          :key="msg.id" 
          class="message-row"
          :class="{ 'own-message': msg.from === store.user.username }"
        >
          <div class="message-avatar" v-if="msg.from !== store.user.username">
            {{ msg.from[0].toUpperCase() }}
          </div>
          <div class="message-content">
            <div class="message-meta" v-if="msg.from !== store.user.username">
              <span class="sender">{{ msg.from }}</span>
              <span class="time">{{ new Date(msg.createdAt).toLocaleTimeString() }}</span>
            </div>
            <div class="bubble">
              {{ msg.ciphertext }}
            </div>
          </div>
        </div>
      </div>

      <div v-else class="empty-state">
        <p>选择一个房间开始聊天</p>
      </div>

      <div v-if="store.currentRoom" class="input-area">
        <input 
          v-model="messageInput" 
          placeholder="发送消息..." 
          @keyup.enter="sendMessage"
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
}

/* Sidebar */
.sidebar {
  width: 240px;
  background: var(--bg-sidebar);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}
.user-profile {
  padding: 1rem;
  background: #232428;
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar {
  width: 32px;
  height: 32px;
  background: var(--primary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  color: white;
  font-size: 0.9rem;
}
.username {
  font-size: 0.9rem;
  font-weight: 500;
}
.logout-btn {
  margin-left: auto;
  background: none;
  border: 1px solid #fa777c;
  color: #fa777c;
  font-size: 0.7rem;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 3px;
}
.logout-btn:hover {
  background: rgba(250, 119, 124, 0.1);
}
.section {
  padding: 1rem 0.5rem;
  border-bottom: 1px solid rgba(0,0,0,0.2);
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  margin-bottom: 0.5rem;
  padding: 0 0.5rem;
  font-weight: 600;
}
.section-header button {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1.2rem;
  padding: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.section-header button:hover {
  color: var(--text-normal);
}
.channel-item {
  padding: 6px 8px;
  margin: 2px 0;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.9rem;
}
.channel-item:hover {
  background: #35373c;
  color: var(--text-normal);
}
.channel-item.active {
  background: #404249;
  color: white;
}
.create-form input, .add-friend input {
  width: 100%;
  background: var(--bg-dark);
  border: none;
  color: white;
  padding: 6px 8px;
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 0.85rem;
}
.create-form input:focus, .add-friend input:focus {
  outline: 1px solid var(--primary);
}
.friend-item {
  padding: 6px 8px;
  margin: 2px 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* Chat Area */
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-dark);
}
.chat-header {
  height: 48px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 1rem;
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
}
.chat-header h3 {
  margin: 0;
  margin-right: 1rem;
  font-size: 1rem;
}
.topic {
  color: var(--text-muted);
  font-size: 0.8rem;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.message-row {
  display: flex;
  gap: 10px;
}
.message-row.own-message {
  flex-direction: row-reverse;
}
.message-avatar {
  width: 40px;
  height: 40px;
  background: #5865f2;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-weight: bold;
  color: white;
}
.message-content {
  max-width: 70%;
}
.message-meta {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.message-meta .sender {
  font-weight: 600;
}
.message-meta .time {
  margin-left: 8px;
}
.bubble {
  background: var(--bg-channel);
  padding: 8px 12px;
  border-radius: 0 8px 8px 8px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.own-message .bubble {
  background: var(--primary);
  color: white;
  border-radius: 8px 0 8px 8px;
}
.input-area {
  padding: 1rem;
  background: var(--bg-dark);
}
.input-area input {
  width: 100%;
  padding: 12px;
  background: #383a40;
  border: none;
  border-radius: 8px;
  color: var(--text-normal);
  outline: none;
  font-size: 0.95rem;
}
.input-area input:focus {
  background: #40424a;
}
.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 1.1rem;
}
</style>
