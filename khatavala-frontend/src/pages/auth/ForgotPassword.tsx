import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { AuthCard, FormError } from './AuthCard';
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/lib/validators/auth';
import * as authService from '@/services/auth.service';

export function ForgotPassword() {
  const [error, setError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: ForgotPasswordValues) => {
    setError(null);
    try {
      setSentMessage(await authService.forgotPassword(values));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send reset link');
    }
  };

  return (
    <AuthCard
      title="Forgot password"
      description="We'll email you a link to set a new password."
      footer={
        <Link to="/login" className="underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      {sentMessage ? (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {sentMessage}
        </p>
      ) : (
        <>
          <FormError message={error} />
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          </Form>
        </>
      )}
    </AuthCard>
  );
}
