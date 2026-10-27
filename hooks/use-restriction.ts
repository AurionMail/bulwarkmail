import { usePolicyStore } from '@/stores/policy-store';

export interface RestrictionView {
  /** Not offered to the user at all. */
  hidden: boolean;
  /** Shown with the admin's value and "Set by your organisation", not changeable. */
  locked: boolean;
  /** Values the user may pick from, when the admin limited them. */
  allowedValues: unknown[] | null;
  min: number | null;
  max: number | null;
  /** The value a lock pins, if it names one. */
  value: unknown;
}

/**
 * The admin's restriction on one user-facing option, from the effective
 * policy of the active account (domain and group scopes applied). Every
 * option an admin can restrict reads it through here, so locking works the
 * same everywhere.
 */
export function useRestriction(key: string): RestrictionView {
  const restriction = usePolicyStore((state) => state.policy.restrictions[key]);
  return {
    hidden: restriction?.hidden === true,
    locked: restriction?.locked === true,
    allowedValues: Array.isArray(restriction?.allowedValues) && restriction.allowedValues.length > 0 ? restriction.allowedValues : null,
    min: typeof restriction?.min === 'number' ? restriction.min : null,
    max: typeof restriction?.max === 'number' ? restriction.max : null,
    value: restriction?.value,
  };
}
