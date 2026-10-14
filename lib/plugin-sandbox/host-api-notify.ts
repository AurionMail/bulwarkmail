// Host side of api.notifications.show: a system notification when the user
// has allowed them for the webmail, otherwise a toast. Every one names the
// plugin that sent it, and a plugin may send only a few a minute.

import type { InstalledPlugin, NotificationInput } from '../plugin-types';
import { toast as appToast } from '@/stores/toast-store';
import { toastHooks } from '../plugin-hooks';
import { readObject, readString, withinRate } from './host-api-input';

export const MAX_NOTIFICATION_TITLE = 120;
export const MAX_NOTIFICATION_BODY = 300;
export const NOTIFICATIONS_PER_MINUTE = 5;
const TAG_RE = /^[A-Za-z0-9._:-]{1,64}$/;

// eslint-disable-next-line no-control-regex -- line breaks and other control characters become spaces
const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

/**
 * Show a notification from a plugin. Resolves to 'system' when the browser
 * showed it, 'toast' when the app did. Clicking a system notification
 * brings the webmail to the front and fires onNotificationClick for this
 * plugin only, with the tag it passed.
 */
export function doNotificationsShow(plugin: InstalledPlugin, input: unknown): 'system' | 'toast' {
  const method = 'notifications.show';
  const data = readObject(input, method, 'notification', ['title', 'body', 'tag']) as NotificationInput & Record<string, unknown>;
  const title = oneLine(readString(data.title, method, 'title', MAX_NOTIFICATION_TITLE, { min: 1 }));
  if (!title) throw new Error(`${method}: title must not be empty`);
  const body = data.body === undefined ? '' : oneLine(readString(data.body, method, 'body', MAX_NOTIFICATION_BODY));
  let tag: string | undefined;
  if (data.tag !== undefined) {
    if (typeof data.tag !== 'string' || !TAG_RE.test(data.tag)) {
      throw new Error(`${method}: tag must be 1-64 letters, digits or . _ : -`);
    }
    tag = data.tag;
  }
  if (!withinRate('notifications', plugin.id, NOTIFICATIONS_PER_MINUTE)) {
    throw new Error(`${method}: at most ${NOTIFICATIONS_PER_MINUTE} notifications a minute`);
  }

  const source = plugin.name || plugin.id;
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const notification = new Notification(title, {
        body: body ? `${body}\n${source}` : source,
        // Scoped to the plugin, so one plugin's tag can't replace another's notification.
        ...(tag ? { tag: `plugin:${plugin.id}:${tag}` } : {}),
      });
      notification.onclick = () => {
        try { window.focus(); } catch { /* ignore */ }
        notification.close();
        void toastHooks.onNotificationClick.emitTo(plugin.id, { tag: tag ?? '' });
      };
      return 'system';
    } catch {
      // Some browsers (Chrome on Android) only allow notifications from a
      // service worker; the toast below still tells the user.
    }
  }
  appToast.info(title, { message: body ? `${body} (${source})` : source });
  return 'toast';
}
