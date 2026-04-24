export type KillSwitchLevel = 'NORMAL' | 'GLOBAL_PAUSE' | 'GLOBAL_STOP';

export function getKillSwitchLevel(value: unknown): KillSwitchLevel {
  if (value && typeof value === 'object' && 'level' in value) {
    const level = (value as { level?: unknown }).level;
    if (level === 'GLOBAL_PAUSE' || level === 'GLOBAL_STOP') {
      return level;
    }
    return 'NORMAL';
  }

  if (value === 'GLOBAL_PAUSE' || value === 'GLOBAL_STOP') {
    return value;
  }

  return 'NORMAL';
}

export function isKillSwitchActive(level: KillSwitchLevel): boolean {
  return level === 'GLOBAL_PAUSE' || level === 'GLOBAL_STOP';
}
