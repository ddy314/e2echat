<script setup>
import { ref } from 'vue'
import { api } from '../net/api'
import { store } from '../services/store'

const isLogin = ref(true)
const username = ref('')
const password = ref('')
const error = ref('')

async function submit() {
  error.value = ''
  try {
    const res = isLogin.value 
      ? await api.login(username.value, password.value)
      : await api.register(username.value, password.value)
    
    store.setAuth(res.token, res.user)
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="auth-container">
    <div class="auth-box">
      <h2>{{ isLogin ? '欢迎回来' : '创建账号' }}</h2>
      <form @submit.prevent="submit">
        <div class="form-group">
          <label>用户名</label>
          <input v-model="username" type="text" required />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input v-model="password" type="password" required />
        </div>
        <div v-if="error" class="error">{{ error }}</div>
        <button type="submit">{{ isLogin ? '登录' : '注册' }}</button>
      </form>
      <p class="switch-mode">
        {{ isLogin ? '没有账号?' : '已有账号?' }}
        <a href="#" @click.prevent="isLogin = !isLogin">
          {{ isLogin ? '去注册' : '去登录' }}
        </a>
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop') center/cover;
}
.auth-box {
  background: var(--bg-sidebar);
  padding: 2rem;
  border-radius: 8px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.3);
}
.form-group {
  margin-bottom: 1rem;
}
label {
  display: block;
  margin-bottom: 0.5rem;
  color: var(--text-muted);
  font-size: 0.9rem;
  font-weight: 500;
}
input {
  width: 100%;
  padding: 10px;
  background: var(--bg-channel);
  border: none;
  color: white;
  border-radius: 4px;
  margin-top: 5px;
}
button {
  width: 100%;
  padding: 10px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  margin-top: 1rem;
}
button:hover {
  background: #4752c4;
}
.switch-mode {
  text-align: center;
  margin-top: 1rem;
  font-size: 0.9rem;
}
.switch-mode a {
  color: var(--primary);
  text-decoration: none;
  margin-left: 0.5rem;
}
.switch-mode a:hover {
  text-decoration: underline;
}
.error {
  color: #fa777c;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  background: rgba(250, 119, 124, 0.1);
  padding: 0.5rem;
  border-radius: 4px;
}
h2 {
  margin: 0 0 1.5rem 0;
  text-align: center;
}
</style>
