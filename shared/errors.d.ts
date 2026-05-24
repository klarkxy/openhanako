export const ErrorSeverity: {
  readonly CRITICAL: 'critical';
  readonly DEGRADED: 'degraded';
  readonly COSMETIC: 'cosmetic';
};

export const ErrorCategory: {
  readonly NETWORK: 'network';
  readonly LLM: 'llm';
  readonly FILESYSTEM: 'filesystem';
  readonly IPC: 'ipc';
  readonly RENDER: 'render';
  readonly BRIDGE: 'bridge';
  readonly CONFIG: 'config';
  readonly AUTH: 'auth';
  readonly UNKNOWN: 'unknown';
};

export type ErrorSeverityValue = 'critical' | 'degraded' | 'cosmetic';
export type ErrorCategoryValue =
  | 'network' | 'llm' | 'filesystem' | 'ipc' | 'render'
  | 'bridge' | 'config' | 'auth' | 'unknown';

export interface ErrorDef {
  severity: ErrorSeverityValue;
  category: ErrorCategoryValue;
  i18nKey: string;
  retryable: boolean;
  httpStatus?: number;
}

export const ERROR_DEFS: Readonly<Record<string, Readonly<ErrorDef>>>;

export interface AppErrorOptions {
  message?: string;
  context?: Record<string, unknown>;
  traceId?: string;
  cause?: Error;
}

export declare class AppError extends Error {
  readonly code: string;
  readonly severity: ErrorSeverityValue;
  readonly category: ErrorCategoryValue;
  retryable: boolean;
  readonly userMessageKey: string;
  readonly httpStatus: number;
  context: Record<string, unknown>;
  readonly traceId: string;
  cause?: Error;

  constructor(code: string, opts?: AppErrorOptions);

  toJSON(): { code: string; message: string; context: Record<string, unknown>; traceId: string };
  static fromJSON(data: { code?: string; message?: string; context?: Record<string, unknown>; traceId?: string }): AppError;
  static wrap(err: unknown, fallbackCode?: string): AppError;
}
