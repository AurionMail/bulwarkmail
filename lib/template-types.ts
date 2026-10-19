export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  isHTML?: boolean;
  category: string;
  defaultRecipients?: {
    to?: string[];
    cc?: string[];
    bcc?: string[];
  };
  identityId?: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export const BUILT_IN_PLACEHOLDERS = [
  'recipient_name',
  'company',
  'date',
  'short_date',
  'day',
  'month',
  'year',
  'day_of_week',
  'sender_name',
] as const;
