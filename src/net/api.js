import { store } from '../services/store'

// 使用环境变量中的 API Base URL
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787'

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  }

  if (store.token) {
    headers['Authorization'] = `Bearer ${store.token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  })

  if (res.status === 401) {
    store.logout()
    throw new Error('Unauthorized')
  }

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'API Error')
  return data
}

export const api = {
  login: (username, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username, password) => request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password, publicKey: 'mock-key' }) }),
  getProfile: () => request('/api/profile'),
  getRooms: () => request('/api/rooms'),
  createRoom: (name, members = []) => request('/api/rooms', { method: 'POST', body: JSON.stringify({ name, members }) }),
  getMessages: (roomId) => request(`/api/messages?room=${roomId}`),
  getFriends: () => request('/api/friends'),
  addFriend: (username) => request('/api/friends/request', { method: 'POST', body: JSON.stringify({ to: username }) }),
}

