<script setup lang="ts">
import { watch, ref, nextTick, onMounted, onUnmounted } from 'vue';
import Message from './components/Message.vue';
import InputBar from './components/InputBar.vue';
import { sendMessage, formatMessage } from './services/messageService.js';
import { connect, onMessage, disconnect, isConnected } from './net/socket.js';
// UI消息类型定义
type UIMessage = { id: string; text: string; role: string; ts: string };

// UI状态管理
const messages = ref<UIMessage[]>([]);
const scrollContainer = ref<HTMLDivElement | null>(null);
const connectionStatus = ref<string>('disconnected');

onMounted( async () => {
  try {
    await connect();
    connectionStatus.value = 'connected';
    messages.value.push(formatMessage('系统: 连接已建立', 'system'));
    onMessage((data) => {
      console.log('收到消息:', data);
      if (data && data.text) {
        const receivedMsg = formatMessage(data.text, 'peer');
        messages.value.push(receivedMsg);
      }
    });
  } catch (error) {
    console.error('连接失败:', error);
    connectionStatus.value = 'disconnected';
  }
} );

onUnmounted( () => {
  disconnect();
  connectionStatus.value = 'disconnected';
} );

// 发送
async function onSendMessage(msg: string) {
  try {
    const sentMessage = await sendMessage(msg);
    messages.value.push(sentMessage);
  } catch (error) {
    console.error('发送消息失败:', error);
    messages.value.push(formatMessage('系统: 消息发送失败', 'system'));
  }
}


//监听消息列表变化，自动滚动到底部
watch(() => messages.value.length, async () => {
  await nextTick();
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
  }
});
</script>

<template>
  <h1>欢迎来到E2EChat!</h1>
  <div class="status">连接状态: {{ connectionStatus }}</div>
  <div>
    <div ref="scrollContainer" class="messages-wrapper">
      <Message :messages="messages" />
    </div>
    <input-bar @send-message="onSendMessage" />
  </div>
</template>

<style>
.messages-wrapper {
  height: 320px;
  max-height: 60vh;
  overflow: auto;
  border: 1px solid #e5e7eb;
  padding: 8px;
  box-sizing: border-box;
}
</style>