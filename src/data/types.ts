/**
 * Core data model for Vista.
 *
 * Two rules from PLAN.md that this file encodes:
 *  - IDs are client-generated UUIDs, never auto-increment, so later device sync can merge safely.
 *  - Every record carries createdAt / updatedAt for eventual conflict resolution.
 */

export type Category =
  | 'personal'
  | 'rest'
  | 'connection'
  | 'creative'
  | 'learning'
  | 'milestone';

/** What a logged win becomes in the city. */
export type StructureKind =
  | 'skyscraper'
  | 'house'
  | 'park'
  | 'bridge'
  | 'studio'
  | 'library'
  | 'installation'
  // Earned or structural, rather than logged: rewards, signage, and year monuments.
  | 'treeRound'
  | 'treePalm'
  | 'garden'
  | 'billboard'
  | 'monumentSpire'
  | 'monumentDome'
  | 'monumentArch';

export type CadencePeriod = 'day' | 'week' | 'month';

/** How often the user intends to keep a commitment, e.g. { times: 2, per: 'month' }. */
export interface Cadence {
  times: number;
  per: CadencePeriod;
}

/** A one-off win. Becomes a permanent structure somewhere in the city. */
export interface Entry {
  id: string;
  /** ISO date (YYYY-MM-DD) of the day it happened. May be backdated. */
  date: string;
  /** The user's own words, one line. Never generated or summarised. */
  text: string;
  category: Category;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A recurring commitment. Becomes one skyscraper downtown. Unlimited count. */
export interface Commitment {
  id: string;
  name: string;
  cadence: Cadence;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One completion of a commitment. Adds exactly one floor, whatever the cadence. */
export interface CommitmentLog {
  id: string;
  commitmentId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  isDemo?: boolean;
  createdAt: string;
}

export interface CategoryMeta {
  id: Category;
  label: string;
  structure: StructureKind;
  /** Placeholder copy for the log form — sets the tone for what counts. */
  hint: string;
  /** Index 0-5. Fixes which 60-degree wedge of the city this category occupies. */
  wedge: number;
  /** Base colour, used for the structure and its category chip. */
  color: string;
}

/**
 * Category order here is load-bearing: `wedge` determines the angle a structure sits at,
 * so reordering this array moves existing buildings. Append, don't reorder.
 */
export const CATEGORIES: readonly CategoryMeta[] = [
  {
    id: 'personal',
    label: 'Personal',
    structure: 'house',
    hint: 'cooked a real meal',
    wedge: 0,
    color: '#c98a6b',
  },
  {
    id: 'rest',
    label: 'Rest',
    structure: 'park',
    hint: 'napped without feeling guilty',
    wedge: 1,
    color: '#7f9b76',
  },
  {
    id: 'connection',
    label: 'Connection',
    structure: 'bridge',
    hint: 'finally called mum back',
    wedge: 2,
    color: '#6f8ba8',
  },
  {
    id: 'creative',
    label: 'Creative',
    structure: 'studio',
    hint: 'finished the drawing',
    wedge: 3,
    color: '#a97fa0',
  },
  {
    id: 'learning',
    label: 'Learning',
    structure: 'library',
    hint: 'understood recursion, finally',
    wedge: 4,
    color: '#b6a05e',
  },
  {
    id: 'milestone',
    label: 'Milestone',
    structure: 'installation',
    hint: 'handed in the dissertation',
    wedge: 5,
    color: '#e8b4c8',
  },
] as const;

export const CATEGORY_BY_ID: Readonly<Record<Category, CategoryMeta>> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<Category, CategoryMeta>;

export const WEDGE_COUNT = CATEGORIES.length;

/** Everything needed to draw a city, as read from the store. */
export interface CityData {
  entries: Entry[];
  commitments: Commitment[];
  logs: CommitmentLog[];
}
