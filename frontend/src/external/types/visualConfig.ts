/**
 * Secondary-development visual config type extension.
 * Re-exports community types and adds secondary-dev specific types.
 */

export type { VisualConfigValues, DEFAULT_VISUAL_VALUES } from '@/types/visualConfig';

export interface PaginationState {
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalItems?: number;
}
