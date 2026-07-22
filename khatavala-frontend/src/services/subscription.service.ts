import { api } from './api';
import type { ApiResponse } from '@/types';

export interface Plan {
  _id: string;
  name: 'Trial' | 'Basic' | 'Pro' | 'Enterprise';
  price: number;
  billingCycle: string;
  maxUsers: number;
  maxInvoicesPerMonth: number;
  maxWarehouses: number;
  featureFlags: {
    posTerminal: boolean;
    multiWarehouse: boolean;
    customTemplates: boolean;
    apiAccess: boolean;
  };
}

export interface SubscriptionDetails {
  subscription: {
    _id: string;
    startDate: string;
    endDate: string;
    status: 'Trial' | 'Active' | 'Expired' | 'Cancelled';
    paymentReference?: string;
  };
  plan: Plan;
  status: string;
  usage: {
    invoicesThisMonth: number;
    maxInvoices: number;
    usersCount: number;
    maxUsers: number;
    warehousesCount: number;
    maxWarehouses: number;
  };
}

export interface RazorpayOrderData {
  orderId: string;
  amount: number;
  currency: string;
  planName: string;
  key: string;
}

export async function getPlans(): Promise<Plan[]> {
  const { data } = await api.get<ApiResponse<Plan[]>>('/subscriptions/plans');
  return data.data!;
}

export async function getSubscriptionDetails(): Promise<SubscriptionDetails> {
  const { data } = await api.get<ApiResponse<SubscriptionDetails>>('/subscriptions/current');
  return data.data!;
}

export async function createRazorpayOrder(planId: string): Promise<RazorpayOrderData> {
  const { data } = await api.post<ApiResponse<RazorpayOrderData>>('/subscriptions/create-order', { planId });
  return data.data!;
}

export async function verifyPayment(input: {
  planId: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
}) {
  const { data } = await api.post<ApiResponse<any>>('/subscriptions/verify', input);
  return data.data!;
}
