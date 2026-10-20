'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from '@/components/icons';
import { apiFetch } from '@/lib/browser-navigation';
import { Button } from '@/components/ui/button';
import { AdminPageHeader } from '@/components/admin/page-header';
import { Flash, useFlash } from '@/components/admin/flash-message';
import { inputClass } from '@/components/admin/config-items';
import { cn } from '@/lib/utils';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useFlash();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'The new password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'The new passwords do not match.' });
      return;
    }

    setLoading(true);
    const res = await apiFetch('/api/admin/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (res.ok) {
      setMessage({ type: 'success', text: 'Password changed. Taking you back to the overview.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => router.push('/admin'), 2000);
    } else {
      const data = await res.json().catch(() => ({}));
      setMessage({ type: 'error', text: data.error || 'Could not change the password.' });
    }
    setLoading(false);
  }

  const fields = [
    { id: 'current', label: 'Current password', value: currentPassword, set: setCurrentPassword, autoComplete: 'current-password' },
    { id: 'new', label: 'New password', value: newPassword, set: setNewPassword, autoComplete: 'new-password' },
    { id: 'confirm', label: 'Confirm new password', value: confirmPassword, set: setConfirmPassword, autoComplete: 'new-password' },
  ] as const;

  return (
    <div className="max-w-md">
      <AdminPageHeader title="Change password" description="The password for this admin panel. At least 8 characters." back={{ href: '/admin', label: 'Overview' }} />

      <Flash message={message} onDismiss={() => setMessage(null)} />

      <form onSubmit={handleSubmit} className="space-y-4">
        {fields.map((field) => (
          <div key={field.id} className="space-y-1.5">
            <label htmlFor={`password-${field.id}`} className="text-sm font-medium text-foreground">{field.label}</label>
            <input
              id={`password-${field.id}`}
              type="password"
              value={field.value}
              onChange={(e) => field.set(e.target.value)}
              required
              minLength={field.id === 'current' ? undefined : 8}
              autoComplete={field.autoComplete}
              className={cn(inputClass, 'w-full')}
            />
          </div>
        ))}

        <Button type="submit" size="sm" disabled={loading} className="gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Change password
        </Button>
      </form>
    </div>
  );
}
