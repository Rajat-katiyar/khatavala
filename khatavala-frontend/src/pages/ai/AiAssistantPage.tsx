import { useState } from 'react';
import { Sparkles, Send, Bot, User, Loader2, BarChart2, Lightbulb } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCompanyStore } from '@/store/companyStore';
import { formatMoney } from '@/lib/utils';
import * as aiService from '@/services/aiAssistant.service';
import type { AiQuestionResult } from '@/services/aiAssistant.service';

const PRESETS = [
  'Who is my top customer this month?',
  'Which products are slow moving or not selling?',
  'What is my current inventory valuation?',
  'Show customer outstanding aging breakdown',
];

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text?: string;
  data?: AiQuestionResult;
}

export function AiAssistantPage() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'ai',
      text: 'Hello! I am your Khatavala AI Business Intelligence Assistant. Ask me anything about your sales, inventory valuation, top customers, or overdue aging balances.',
    },
  ]);

  const handleSend = async (questionText?: string) => {
    const q = (questionText || input).trim();
    if (!q || loading) return;

    const userMsgId = Date.now().toString();
    setMessages((prev) => [...prev, { id: userMsgId, sender: 'user', text: q }]);
    if (!questionText) setInput('');
    setLoading(true);

    try {
      const res = await aiService.askAiQuestion(q);
      setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), sender: 'ai', data: res }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          text: 'Sorry, I encountered an issue analyzing your query. Please try rephrasing.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto flex flex-col h-[calc(100vh-6rem)]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Khatavala AI Business Assistant
        </h1>
        <p className="text-sm text-muted-foreground">
          Ask natural-language business questions to analyze sales pipelines, inventory valuation, and aging risks.
        </p>
      </div>

      {/* Preset Prompt Chips */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            variant="outline"
            size="sm"
            onClick={() => handleSend(preset)}
            disabled={loading}
            className="text-xs gap-1.5 hover:border-primary transition-colors"
          >
            <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
            {preset}
          </Button>
        ))}
      </div>

      {/* Chat Messages Feed */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2 border rounded-xl p-4 bg-card shadow-xs">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-3 text-sm ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`p-2 rounded-lg shrink-0 ${
                msg.sender === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
              }`}
            >
              {msg.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-primary" />}
            </div>

            <div className={`space-y-3 max-w-2xl ${msg.sender === 'user' ? 'text-right' : ''}`}>
              {msg.text && (
                <div
                  className={`p-3 rounded-lg text-sm leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'bg-muted/50 border text-foreground'
                  }`}
                >
                  {msg.text}
                </div>
              )}

              {msg.data && (
                <Card className="border-primary/20 bg-card text-left">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> AI Intelligence Response
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">{msg.data.answer}</p>

                    {/* Mini Visualizer Chart */}
                    {msg.data.chartData && msg.data.chartData.length > 0 && (
                      <div className="pt-2 border-t">
                        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                          <BarChart2 className="w-3.5 h-3.5" /> Data Breakdown
                        </p>

                        <div className="h-56">
                          <ResponsiveContainer width="100%" height="100%">
                            {msg.data.chartType === 'line' ? (
                              <LineChart data={msg.data.chartData}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} />
                                <Tooltip formatter={(val: any) => formatMoney(Number(val || 0), currency)} />
                                <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} />
                              </LineChart>
                            ) : (
                              <BarChart data={msg.data.chartData}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} />
                                <Tooltip formatter={(val: any) => formatMoney(Number(val || 0), currency)} />
                                <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            )}
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 bg-muted/40 rounded-lg w-fit">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            Analyzing your database records…
          </div>
        )}
      </div>

      {/* Input Box */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        className="flex items-center gap-2 pt-2"
      >
        <Input
          placeholder="Ask a question (e.g. Who is my top customer this month?)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          className="flex-1 h-11"
        />
        <Button type="submit" disabled={loading || !input.trim()} className="h-11 px-5 gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Ask AI
        </Button>
      </form>
    </div>
  );
}
