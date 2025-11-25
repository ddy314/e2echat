<script setup>
import { store } from './services/store'
import Auth from './components/Auth.vue'
import ChatLayout from './components/ChatLayout.vue'
</script>

<template>
  <Auth v-if="!store.token" />
  <ChatLayout v-else />
</template>

<style>
/* 全局样式在 style.css 中定义 */
</style>
