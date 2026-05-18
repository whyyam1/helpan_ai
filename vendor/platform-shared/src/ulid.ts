import { ulid } from 'ulid';

export type Ulid = string & { readonly __brand: 'Ulid' };

export function generateUlid(): Ulid {
  return ulid() as Ulid;
}

export function isUlid(value: string): value is Ulid {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
