import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/authStore';
import type { ApiResponse, AuthPayload } from '@/types';

const baseURL = import.meta.env.VITE_API_URL ?? '/api';

export const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

// Separate instance for the refresh call so a 401 from /refresh-token cannot
// re-enter the response interceptor and start an infinite refresh loop.
const refreshClient = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach auth token to every request.
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

type RetriableConfig = AxiosRequestConfig & { _retry?: boolean };

// Endpoints where a 401 means "these credentials are wrong", not "the access
// token aged out" — retrying them with a fresh token would be meaningless.
// Note this is deliberately not every /auth/* route: /auth/me and /auth/logout
// are ordinary authenticated calls and must still refresh.
const NO_REFRESH_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh-token',
  '/auth/forgot-password',
  '/auth/reset-password',
];

// While one refresh is in flight, other 401s wait on the same promise instead
// of each firing their own rotation — concurrent rotations would revoke each
// other's tokens and trip the backend's token-reuse detection.
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const { refreshToken, setTokens, logout } = useAuthStore.getState();
  if (!refreshToken) throw new Error('No refresh token available');

  try {
    const { data } = await refreshClient.post<ApiResponse<AuthPayload>>(
      '/auth/refresh-token',
      { refreshToken }
    );
    if (!data.data) throw new Error('Malformed refresh response');

    setTokens(data.data.accessToken, data.data.refreshToken);
    return data.data.accessToken;
  } catch (err) {
    logout();
    throw err;
  }
}

// Centralized error handling + transparent access-token refresh on 401.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiResponse<unknown>>) => {
    const original = error.config as RetriableConfig | undefined;
    const skipRefresh = NO_REFRESH_PATHS.some((path) => original?.url?.startsWith(path));

    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !skipRefresh &&
      useAuthStore.getState().refreshToken
    ) {
      original._retry = true;
      try {
        refreshPromise = refreshPromise ?? refreshAccessToken();
        const token = await refreshPromise;
        refreshPromise = null;

        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return api(original);
      } catch {
        refreshPromise = null;
        return Promise.reject(new Error('Session expired. Please sign in again.'));
      }
    }

    const message =
      error.response?.data?.error?.message ?? error.message ?? 'Request failed';
    return Promise.reject(new Error(message));
  }
);
