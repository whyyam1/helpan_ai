/**
 * KES minor units (fils). Integer arithmetic only.
 * Per Reboot Pack §9.2: no floating-point for monetary values anywhere.
 */
export type KesMinorUnits = number & { readonly __brand: 'KesMinorUnits' };

export function toKesMinorUnits(value: number): KesMinorUnits {
  if (!Number.isInteger(value)) {
    throw new Error(`KES minor units must be an integer; got ${value}`);
  }
  return value as KesMinorUnits;
}

export function formatKes(minor: KesMinorUnits): string {
  const major = Math.floor(minor / 100);
  const cents = (minor % 100).toString().padStart(2, '0');
  return `KES ${major.toLocaleString('en-KE')}.${cents}`;
}

export function assertNonNegative(amount: KesMinorUnits): void {
  if (amount < 0) {
    throw new Error(`Amount must be non-negative; got ${amount}`);
  }
}

export function assertPositive(amount: KesMinorUnits): void {
  if (amount <= 0) {
    throw new Error(`Amount must be positive; got ${amount}`);
  }
}
