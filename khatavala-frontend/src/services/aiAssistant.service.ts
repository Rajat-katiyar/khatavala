import { api } from './api';
import type { ApiResponse } from '@/types';

export interface AiQuestionResult {
  question: string;
  answer: string;
  intent: 'sales_summary' | 'top_customers' | 'slow_movers' | 'inventory_valuation' | 'aging' | 'reorder' | 'general';
  chartType: 'bar' | 'line' | 'pie' | 'table';
  chartData: any[];
}

export interface DemandForecastItem {
  productId: string;
  productName: string;
  sku: string;
  currentStock: number;
  minStockLevel: number;
  salesLast30Days: number;
  dailyBurnRate: number;
  daysUntilStockOut: number;
  suggestedReorderQty: number;
  riskLevel: 'High' | 'Medium' | 'Low';
}

export async function askAiQuestion(question: string): Promise<AiQuestionResult> {
  const { data } = await api.post<ApiResponse<AiQuestionResult>>('/ai/ask', { question });
  return data.data!;
}

export async function getDemandForecast(): Promise<DemandForecastItem[]> {
  const { data } = await api.get<ApiResponse<DemandForecastItem[]>>('/ai/demand-forecast');
  return data.data!;
}
