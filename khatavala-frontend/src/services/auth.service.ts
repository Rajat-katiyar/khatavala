import { api } from './api';
import { useAuthStore } from '@/store/authStore';
import { useCompanyStore } from '@/store/companyStore';
import { usePermissionStore } from '@/store/permissionStore';
import type { ApiResponse, AuthPayload, User } from '@/types';
import type {
  ForgotPasswordValues,
  LoginValues,
  RegisterValues,
  ResetPasswordValues,
} from '@/lib/validators/auth';

export async function register(values: RegisterValues): Promise<AuthPayload> {
  const { confirmPassword: _confirmPassword, phoneNumber, ...rest } = values;
  // The field is optional: send it only when filled, since the backend
  // validates the format of any phoneNumber it receives.
  const body = phoneNumber ? { ...rest, phoneNumber } : rest;
  const { data } = await api.post<ApiResponse<AuthPayload>>('/auth/register', body);
  const payload = data.data!;
  useAuthStore.getState().setSession(payload);
  return payload;
}

export async function login(values: LoginValues): Promise<AuthPayload> {
  const { data } = await api.post<ApiResponse<AuthPayload>>('/auth/login', values);
  const payload = data.data!;
  useAuthStore.getState().setSession(payload);
  return payload;
}

export async function logout(allSessions = false): Promise<void> {
  const { refreshToken, logout: clearSession } = useAuthStore.getState();
  try {
    if (refreshToken) {
      await api.post('/auth/logout', { refreshToken, allSessions });
    }
  } finally {
    // Always clear locally, even if the revoke call fails. The company and
    // permission stores go too — leaving an active company behind would show
    // the next user on this device the previous tenant's name, and leaving
    // permissions behind would briefly show them the previous user's UI.
    clearSession();
    useCompanyStore.getState().reset();
    usePermissionStore.getState().reset();
  }
}

export async function forgotPassword(values: ForgotPasswordValues): Promise<string> {
  const { data } = await api.post<ApiResponse<{ message: string }>>(
    '/auth/forgot-password',
    values
  );
  return data.data!.message;
}

export async function resetPassword(values: ResetPasswordValues): Promise<string> {
  const { confirmPassword: _confirmPassword, ...body } = values;
  const { data } = await api.post<ApiResponse<{ message: string }>>(
    '/auth/reset-password',
    body
  );
  return data.data!.message;
}

export async function fetchMe(): Promise<User> {
  const { data } = await api.get<ApiResponse<{ user: User }>>('/auth/me');
  return data.data!.user;
}
