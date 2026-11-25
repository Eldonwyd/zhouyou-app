export interface NotificationPrefs {
  enabled: boolean;
  inAppBanner: boolean;
  systemPopup: boolean;
  sound: boolean;
  types: {
    friendRequests: boolean;
    planShares: boolean;
    groupUpdates: boolean;
  };
}

export const NOTIFICATION_PREFS_KEY = 'zhouyou-notification-prefs';
export const NOTIFICATION_PREFS_EVENT = 'zhouyou-notification-prefs-change';
export const SEEN_NOTIFICATIONS_KEY = 'zhouyou-seen-notification-ids';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  inAppBanner: true,
  systemPopup: false,
  sound: true,
  types: {
    friendRequests: true,
    planShares: true,
    groupUpdates: true,
  },
};

export function readNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      enabled: parsed.enabled ?? DEFAULT_NOTIFICATION_PREFS.enabled,
      inAppBanner: parsed.inAppBanner ?? DEFAULT_NOTIFICATION_PREFS.inAppBanner,
      systemPopup: parsed.systemPopup ?? DEFAULT_NOTIFICATION_PREFS.systemPopup,
      sound: parsed.sound ?? DEFAULT_NOTIFICATION_PREFS.sound,
      types: {
        friendRequests: parsed.types?.friendRequests ?? DEFAULT_NOTIFICATION_PREFS.types.friendRequests,
        planShares: parsed.types?.planShares ?? DEFAULT_NOTIFICATION_PREFS.types.planShares,
        groupUpdates: parsed.types?.groupUpdates ?? DEFAULT_NOTIFICATION_PREFS.types.groupUpdates,
      },
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function writeNotificationPrefs(next: NotificationPrefs): void {
  try {
    localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(NOTIFICATION_PREFS_EVENT, { detail: next }));
}

export function shouldNotifyForType(prefs: NotificationPrefs, notificationType: string): boolean {
  if (!prefs.enabled) return false;
  const kind = notificationType.toLowerCase();
  if (kind.includes('friend') || kind.includes('intimacy')) return prefs.types.friendRequests;
  if (kind.includes('share') || kind.includes('plan')) return prefs.types.planShares;
  if (kind.includes('group') || kind.includes('expense') || kind.includes('vote') || kind.includes('comment')) {
    return prefs.types.groupUpdates;
  }
  return true;
}

export function readSeenNotificationIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_NOTIFICATIONS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function writeSeenNotificationIds(ids: Set<string>): void {
  try {
    const trimmed = [...ids].slice(-120);
    localStorage.setItem(SEEN_NOTIFICATIONS_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

/** 轻量柔和双音提示音（纯 Web Audio 合成，离线可用，无外部音频文件依赖）。 */
export function playNotificationChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const playNote = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.09, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };
    playNote(784, 0, 0.16);
    playNote(1046.5, 0.12, 0.24);
    window.setTimeout(() => { void ctx.close().catch(() => undefined); }, 600);
  } catch { /* ignore autoplay restrictions */ }
}

export function isSystemNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getSystemNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isSystemNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestSystemNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isSystemNotificationSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function fireSystemNotification(title: string, body?: string, onClick?: () => void): void {
  if (!isSystemNotificationSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body: body || '打开周游地图查看详情',
      icon: '/icons/icon-192.png',
      tag: 'zhouyou-social-notif',
    });
    if (onClick) {
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
    }
  } catch { /* ignore */ }
}
