import type { AppError } from './errors.js';

export interface ErrorEntry {
  error: AppError;
  timestamp: number;
  breadcrumbs: Breadcrumb[];
}

export interface Breadcrumb {
  [key: string]: unknown;
  timestamp?: number;
}

export type ErrorRoute = 'statusbar' | 'boundary' | 'toast';

export interface ReportExtra {
  context?: Record<string, unknown>;
  route?: ErrorRoute;
  dedupeKey?: string;
}

export declare class ErrorBus {
  addBreadcrumb(crumb: Breadcrumb): void;
  report(error: unknown, extra?: ReportExtra): void;
  subscribe(listener: (entry: ErrorEntry, route: ErrorRoute) => void): () => void;
}

export const errorBus: ErrorBus;
