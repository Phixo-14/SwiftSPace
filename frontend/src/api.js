import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// Attach the stored JWT to every request once the user is logged in.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('rd_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
