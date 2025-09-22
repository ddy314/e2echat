<script setup>
import { ref } from 'vue'

const emit = defineEmits(['send-message'])
const message = ref('')

function sendMessage() {
    const text = message.value.trim()
    if (!text) return
    emit('send-message', message.value)
    message.value = ''
}
</script>

<template>
  <form @submit.prevent="sendMessage">
    <input v-model="message" type="text" placeholder="Type a message..." />
    <button type="submit">Send</button>
  </form>
</template>

<style scoped></style>