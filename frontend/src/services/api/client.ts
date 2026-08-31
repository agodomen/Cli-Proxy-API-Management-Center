/**
 * Axios API 客户端
 * 替代原项目 src/core/api-client.js
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import type { ApiClientConfig, ApiError } from '@/types';
import {
  BUILD_DATE_HEADER_KEYS,
  CPA_BUILD_DATE_HEADER_KEYS,
  CPA_SUPPORT_PLUGIN_HEADER_KEYS,
  CPA_VERSION_HEADER_KEYS,
  REQUEST_TIMEOUT_MS,
  VERSION_HEADER_KEYS,
} from '@/utils/constants';

const CPAMC_API_PREFIX = '/v0/cpamc';
import { computeApiUrl, normalizeApiBase } from '@/utils/connection';
import { parseApiErrorResponse } from './apiError';

class ApiClient {
  private instance: AxiosInstance;
  private apiBase: string = '';
  private cpamcBase: string = '';
  private managementKey: string = '';

  constructor() {
    this.instance = axios.create({
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  /**
   * 设置 API 配置
   */
  setConfig(config: ApiClientConfig): void {
    this.apiBase = computeApiUrl(config.apiBase);
    this.cpamcBase = normalizeApiBase(config.apiBase) + CPAMC_API_PREFIX;
    this.managementKey = config.managementKey;

    if (config.timeout) {
      this.instance.defaults.timeout = config.timeout;
    } else {
      this.instance.defaults.timeout = REQUEST_TIMEOUT_MS;
    }
  }

  private readHeader(headers: Record<string, unknown> | undefined, keys: string[]): string | null {
    if (!headers) return null;

    const normalizeValue = (value: unknown): string | null => {
      if (value === undefined || value === null) return null;
      if (Array.isArray(value)) {
        const first = value.find(
          (entry) => entry !== undefined && entry !== null && String(entry).trim()
        );
        return first !== undefined ? String(first) : null;
      }
      const text = String(value);
      return text ? text : null;
    };

    const headerGetter = (headers as { get?: (name: string) => unknown }).get;
    if (typeof headerGetter === 'function') {
      for (const key of keys) {
        const match = normalizeValue(headerGetter.call(headers, key));
        if (match) return match;
      }
    }

    const entries =
      typeof (headers as { entries?: () => Iterable<[string, unknown]> }).entries === 'function'
        ? Array.from((headers as { entries: () => Iterable<[string, unknown]> }).entries())
        : Object.entries(headers);

    const normalized = Object.fromEntries(
      entries.map(([key, value]) => [String(key).toLowerCase(), value])
    );
    for (const key of keys) {
      const match = normalizeValue(normalized[key.toLowerCase()]);
      if (match) return match;
    }
    return null;
  }

  private readBooleanHeader(
    headers: Record<string, unknown> | undefined,
    keys: string[]
  ): boolean | null {
    const value = this.readHeader(headers, keys);
    if (value === null) return null;

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
  }

  /**
   * 设置请求/响应拦截器
   */
  private setupInterceptors(): void {
    // 请求拦截器
    this.instance.interceptors.request.use(
      (config) => {
        // 设置 baseURL（仅在调用方未显式指定时使用默认管理前缀）
        if (!config.baseURL) {
          config.baseURL = this.apiBase;
        }

        // 添加认证头
        if (this.managementKey) {
          config.headers.Authorization = `Bearer ${this.managementKey}`;
        }

        return config;
      },
      (error) => Promise.reject(this.handleError(error))
    );

    // 响应拦截器
    this.instance.interceptors.response.use(
      (response) => {
        const headers = response.headers as Record<string, string | undefined>;
        const cpaVersion = this.readHeader(headers, CPA_VERSION_HEADER_KEYS);
        const cpaBuildDate = this.readHeader(headers, CPA_BUILD_DATE_HEADER_KEYS);
        const version = cpaVersion || this.readHeader(headers, VERSION_HEADER_KEYS);
        const buildDate = cpaBuildDate || this.readHeader(headers, BUILD_DATE_HEADER_KEYS);
        const supportsPlugin = this.readBooleanHeader(headers, CPA_SUPPORT_PLUGIN_HEADER_KEYS);

        // 触发版本更新事件（后续通过 store 处理）
        if (version || buildDate) {
          window.dispatchEvent(
            new CustomEvent('server-version-update', {
              detail: { version: version || null, buildDate: buildDate || null },
            })
          );
        }
        if (supportsPlugin !== null) {
          window.dispatchEvent(
            new CustomEvent('server-plugin-support-update', {
              detail: { supportsPlugin },
            })
          );
        }

        return response;
      },
      (error) => Promise.reject(this.handleError(error))
    );
  }

  /**
   * 错误处理
   */
  private handleError(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      const responseData: unknown = error.response?.data;
      const parsedError = parseApiErrorResponse(responseData, error.message);
      const apiError = new Error(parsedError.message) as ApiError;
      apiError.name = 'ApiError';
      apiError.status = error.response?.status;
      apiError.code = error.code;
      apiError.apiCode = parsedError.apiCode;
      apiError.details = responseData;
      apiError.data = responseData;

      // 401 未授权 - 触发登出事件
      if (error.response?.status === 401) {
        window.dispatchEvent(new Event('unauthorized'));
      }

      return apiError;
    }

    const fallbackMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown error occurred';
    const fallback = new Error(fallbackMessage) as ApiError;
    fallback.name = 'ApiError';
    return fallback;
  }

  /**
   * GET 请求
   */
  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.get<T>(url, config);
    return response.data;
  }

  /**
   * POST 请求
   */
  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.post<T>(url, data, config);
    return response.data;
  }

  /**
   * PUT 请求
   */
  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.put<T>(url, data, config);
    return response.data;
  }

  /**
   * PATCH 请求
   */
  async patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.patch<T>(url, data, config);
    return response.data;
  }

  /**
   * 面板自身 origin 派生的 CPAMC API 基地址。
   * 管理面板由 CPAMC 后端直接提供（/management.html 嵌入部署）时，页面
   * origin 就是 CPAMC 后端；而 apiBase 可能被配置为外部 CLIProxyAPI 地址
   * （external-cpa 直连用法），该主机没有 /v0/cpamc/* 扩展路由。
   */
  private cpamcOriginBase(): string {
    try {
      const { protocol, host } = window.location;
      if (protocol !== 'http:' && protocol !== 'https:') return '';
      return normalizeApiBase(`${protocol}//${host}`) + CPAMC_API_PREFIX;
    } catch {
      return '';
    }
  }

  private isApiNotFound(error: unknown): boolean {
    return Boolean(error) && (error as ApiError).status === 404;
  }

  /**
   * CPAMC 请求统一入口：先按 apiBase 派生地址请求；若返回 404（目标主机
   * 没有 CPAMC 扩展路由，例如 apiBase 指向外部 CLIProxyAPI），且面板
   * origin 可用且不同源，则改用面板 origin 重试一次。重试使用独立请求
   * （不经过实例拦截器），其 401 作为普通错误抛出，避免触发全局登出。
   */
  private async cpamcRequest<T>(
    method: 'get' | 'post' | 'put' | 'delete' | 'patch',
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    try {
      const response = await this.instance.request<T>({
        ...config,
        url,
        method,
        data,
        baseURL: this.cpamcBase,
      });
      return response.data;
    } catch (error) {
      const fallbackBase = this.cpamcOriginBase();
      if (!this.isApiNotFound(error) || !fallbackBase || fallbackBase === this.cpamcBase) {
        throw error;
      }
      try {
        const headers: Record<string, string> = {
          ...((config?.headers as Record<string, string> | undefined) ?? {}),
        };
        if (this.managementKey) {
          headers.Authorization = `Bearer ${this.managementKey}`;
        }
        const response = await axios.request<T>({
          ...config,
          url,
          method,
          data,
          baseURL: fallbackBase,
          headers,
        });
        return response.data;
      } catch (fallbackError) {
        throw this.cpamcFallbackError(fallbackError);
      }
    }
  }

  /**
   * 将回退请求的错误转换为 ApiError，但不派发 unauthorized 事件，
   * 使面板 origin 后端的 401 以普通错误形式呈现给调用方。
   */
  private cpamcFallbackError(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      const responseData: unknown = error.response?.data;
      const parsedError = parseApiErrorResponse(responseData, error.message);
      const apiError = new Error(parsedError.message) as ApiError;
      apiError.name = 'ApiError';
      apiError.status = error.response?.status;
      apiError.code = error.code;
      apiError.apiCode = parsedError.apiCode;
      apiError.details = responseData;
      apiError.data = responseData;
      return apiError;
    }
    const fallbackMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    const fallback = new Error(fallbackMessage) as ApiError;
    fallback.name = 'ApiError';
    return fallback;
  }

  async cpamcGet<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.cpamcRequest<T>('get', url, undefined, config);
  }

  async cpamcPost<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.cpamcRequest<T>('post', url, data, config);
  }

  async cpamcPut<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.cpamcRequest<T>('put', url, data, config);
  }

  async cpamcDelete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.cpamcRequest<T>('delete', url, undefined, config);
  }

  async cpamcPatch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.cpamcRequest<T>('patch', url, data, config);
  }

  async cpamcPostForm<T = unknown>(url: string, formData: FormData, config?: AxiosRequestConfig): Promise<T> {
    return this.cpamcRequest<T>('post', url, formData, {
      ...config,
      headers: {
        ...(config?.headers || {}),
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  /**
   * DELETE 请求
   */
  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.delete<T>(url, config);
    return response.data;
  }

  /**
   * 获取原始响应（用于下载等场景）
   */
  async getRaw(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.instance.get(url, config);
  }

  /**
   * 发送 FormData
   */
  async postForm<T = unknown>(
    url: string,
    formData: FormData,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.instance.post<T>(url, formData, {
      ...config,
      headers: {
        ...(config?.headers || {}),
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }
}

// 导出单例
export const apiClient = new ApiClient();
