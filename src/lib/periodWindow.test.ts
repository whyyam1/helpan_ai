/**
 * Unit tests for the period-window key helper (H-4).
 * Shared between the H-3 validator and the H-4 usage writer; they MUST
 * agree on the window key shape or per-period limits break.
 */

import { describe, expect, it } from 'vitest';
import { periodWindowKey } from './periodWindow.js';

describe('periodWindowKey', () => {
  it('returns calendar-day for daily', () => {
    expect(periodWindowKey('daily', new Date('2026-05-21T14:33:00Z'))).toBe('2026-05-21');
  });

  it('returns calendar-day for single_use (window irrelevant; call_count enforces it)', () => {
    expect(periodWindowKey('single_use', new Date('2026-05-21T00:00:00Z'))).toBe('2026-05-21');
  });

  it('returns first-of-month for monthly', () => {
    expect(periodWindowKey('monthly', new Date('2026-05-21T14:33:00Z'))).toBe('2026-05-01');
    expect(periodWindowKey('monthly', new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
    expect(periodWindowKey('monthly', new Date('2026-12-31T23:59:59Z'))).toBe('2026-12-01');
  });

  it('returns ISO-Monday for weekly', () => {
    // Thursday 21 May 2026 → ISO-week Monday is Monday 18 May 2026.
    expect(periodWindowKey('weekly', new Date('2026-05-21T12:00:00Z'))).toBe('2026-05-18');
    // Sunday 24 May 2026 → same ISO-week Monday (Monday 18).
    expect(periodWindowKey('weekly', new Date('2026-05-24T23:00:00Z'))).toBe('2026-05-18');
    // Monday IS the Monday.
    expect(periodWindowKey('weekly', new Date('2026-05-18T00:00:00Z'))).toBe('2026-05-18');
  });

  it('defaults to calendar-day for unknown / undefined period', () => {
    expect(periodWindowKey(undefined, new Date('2026-05-21T14:33:00Z'))).toBe('2026-05-21');
    expect(periodWindowKey('quarterly', new Date('2026-05-21T14:33:00Z'))).toBe('2026-05-21');
  });
});
