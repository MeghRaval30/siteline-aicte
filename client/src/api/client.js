const API_BASE = '/api/v1';

const FRIENDLY = {
  INVALID_CREDENTIALS: 'Incorrect email or password',
  ACCOUNT_INACTIVE: 'This account has been deactivated',
  VALIDATION_ERROR: 'Please check the highlighted fields',
  FORBIDDEN: 'You do not have permission to do that',
  UNAUTHORIZED: 'Your session has expired. Please sign in again',
};

async function fetchWithAuth(url, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  try {
    const response = await fetch(`${API_BASE}${url}`, { ...options, headers });
    if (response.status === 401 && !url.startsWith('/auth/')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      return null;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(FRIENDLY[data.error] || data.error || `Request failed: ${response.status}`);
    return data.data !== undefined ? data.data : data;
  } catch (error) {
    if (error.message === 'Failed to fetch') throw new Error('Unable to connect to server');
    throw error;
  }
}

export const apiClient = {
  get: (url) => fetchWithAuth(url),
  post: (url, body) => fetchWithAuth(url, { method: 'POST', body: JSON.stringify(body) }),
  put: (url, body) => fetchWithAuth(url, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (url, body) => fetchWithAuth(url, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (url) => fetchWithAuth(url, { method: 'DELETE' }),
};
