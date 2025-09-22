<script setup lang="ts">
type Msg = { id: string; text: string; role: string; ts: string };
const props = defineProps<{ messages: Msg[] }>();
</script>

<template>
  <div>
    <div v-for="item in messages" :key="item.id" :class="['msg-row', item.role]">
      <div class="message">
        <div class="message-content">
          <p>{{ item.text }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg-row {
  display: flex;
  margin-bottom: 8px;
}

.msg-row.me {
  justify-content: flex-end;
}

.msg-row.peer {
  justify-content: flex-start;
}

.msg-row.system {
  justify-content: center;
}

.message {
  max-width: 70%;
  background-color: aliceblue;
  padding: 8px 12px;
  border-radius: 12px;
  line-height: 1.5;
}

.message-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>