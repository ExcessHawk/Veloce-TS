/**
 * Health Check Plugin for Veloce-TS
 * 
 * Adds health check endpoints for monitoring and orchestration
 */

import type { Plugin } from '../core/plugin';
import type { VeloceTS } from '../core/application';
import type { Context } from '../types';
import { getLogger } from '../logging';

export interface HealthCheckOptions {
  path?: string;
  readyPath?: string;
  livePath?: string;
  checks?: HealthChecker[];
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks?: Record<string, CheckResult>;
}

export interface CheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  [key: string]: any;
}

export type HealthChecker = {
  (): Promise<CheckResult> | CheckResult;
  name?: string;
};

/**
 * Bun (and some runtimes) reject plain assignment `fn.name = 'x'` on async functions.
 * Use defineProperty so check names appear correctly in /health JSON.
 */
function setCheckerDisplayName(checker: HealthChecker, displayName: string): void {
  try {
    Object.defineProperty(checker, 'name', {
      value: displayName,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  } catch {
    (checker as HealthChecker & { __veloceCheckerName?: string }).__veloceCheckerName = displayName;
  }
}

function getCheckerKey(check: HealthChecker): string {
  const anyCheck = check as HealthChecker & { __veloceCheckerName?: string };
  return check.name || anyCheck.__veloceCheckerName || 'unknown';
}

/**
 * Health Check Plugin
 * Adds /health, /ready, and /live endpoints
 */
export class HealthCheckPlugin implements Plugin {
  name = 'health';
  version = '1.0.0';

  private options: Required<Omit<HealthCheckOptions, 'checks'>> & { checks: HealthChecker[] };
  private startTime: number;
  private logger = getLogger().child({ plugin: 'health' });

  constructor(options?: HealthCheckOptions) {
    this.options = {
      path: options?.path || '/health',
      readyPath: options?.readyPath || '/ready',
      livePath: options?.livePath || '/live',
      checks: options?.checks || []
    };
    this.startTime = Date.now();
  }

  async install(app: VeloceTS): Promise<void> {
    // Health endpoint - comprehensive health check
    app.get(this.options.path, {
      handler: async (c: Context) => {
        return this.handleHealth(c);
      },
      docs: {
        summary: 'Health Check',
        description: 'Comprehensive health check endpoint',
        tags: ['Health']
      }
    });

    // Readiness endpoint - checks if app is ready to serve traffic
    app.get(this.options.readyPath, {
      handler: async (c: Context) => {
        return this.handleReady(c);
      },
      docs: {
        summary: 'Readiness Check',
        description: 'Check if the application is ready to serve traffic',
        tags: ['Health']
      }
    });

    // Liveness endpoint - checks if app is alive
    app.get(this.options.livePath, {
      handler: async (c: Context) => {
        return this.handleLive(c);
      },
      docs: {
        summary: 'Liveness Check',
        description: 'Check if the application is alive',
        tags: ['Health']
      }
    });

    this.logger.info('Health check endpoints registered', {
      health: this.options.path,
      ready: this.options.readyPath,
      live: this.options.livePath
    });
  }

  /**
   * Handle comprehensive health check
   */
  private async handleHealth(c: Context): Promise<any> {
    const uptime = Date.now() - this.startTime;
    const checks: Record<string, CheckResult> = {};
    
    let allHealthy = true;

    // Run all custom checks
    for (const check of this.options.checks) {
      try {
        const result = await Promise.resolve(check());
        checks[getCheckerKey(check)] = result;
        
        if (result.status === 'unhealthy') {
          allHealthy = false;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        checks[getCheckerKey(check)] = {
          status: 'unhealthy',
          message: errorMessage
        };
        allHealthy = false;
      }
    }

    const result: HealthCheckResult = {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime,
      checks: Object.keys(checks).length > 0 ? checks : undefined
    };

    return c.json(result, allHealthy ? 200 : 503);
  }

  /**
   * Handle readiness check
   */
  private async handleReady(c: Context): Promise<any> {
    const uptime = Date.now() - this.startTime;
    
    // Run readiness checks (only critical checks)
    const criticalChecks = this.options.checks.filter((check) => {
      const key = getCheckerKey(check);
      return key.includes('database') || key.includes('cache') || key.includes('ready');
    });

    let isReady = true;
    const checks: Record<string, CheckResult> = {};

    for (const check of criticalChecks) {
      try {
        const result = await Promise.resolve(check());
        checks[getCheckerKey(check)] = result;
        
        if (result.status === 'unhealthy') {
          isReady = false;
        }
      } catch (error) {
        isReady = false;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        checks[getCheckerKey(check)] = {
          status: 'unhealthy',
          message: errorMessage
        };
      }
    }

    const result = {
      status: isReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      uptime,
      checks: Object.keys(checks).length > 0 ? checks : undefined
    };

    return c.json(result, isReady ? 200 : 503);
  }

  /**
   * Handle liveness check (simple ping)
   */
  private handleLive(c: Context): any {
    const uptime = Date.now() - this.startTime;
    
    return c.json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime
    }, 200);
  }
}

/**
 * Create common health checkers
 */
export const HealthCheckers = {
  /**
   * Always healthy checker (for testing)
   */
  alwaysHealthy(): CheckResult {
    return { status: 'healthy', message: 'OK' };
  },

  /**
   * Database connectivity checker
   */
  database(pingFn: () => Promise<boolean> | boolean): HealthChecker {
    const checker: HealthChecker = async () => {
      try {
        const isHealthy = await Promise.resolve(pingFn());
        return {
          status: isHealthy ? 'healthy' : 'unhealthy',
          message: isHealthy ? 'Database connection OK' : 'Database connection failed'
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'Database check failed'
        };
      }
    };
    setCheckerDisplayName(checker, 'database');
    return checker;
  },

  /**
   * Memory usage checker
   */
  memory(maxUsageMB: number = 512): HealthChecker {
    const checker: HealthChecker = () => {
      if (typeof process === 'undefined' || !process.memoryUsage) {
        return { status: 'healthy', message: 'Memory check not available' };
      }

      const usage = process.memoryUsage();
      const heapUsedMB = usage.heapUsed / 1024 / 1024;
      const isHealthy = heapUsedMB < maxUsageMB;

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        message: `Heap usage: ${heapUsedMB.toFixed(2)}MB / ${maxUsageMB}MB`,
        heapUsedMB: heapUsedMB.toFixed(2),
        maxUsageMB
      };
    };
    setCheckerDisplayName(checker, 'memory');
    return checker;
  },

  /**
   * Disk space checker.
   *
   * Uses `fs.statfs` (Node 18+ / Bun) to read free blocks on the filesystem
   * that contains `path`.  Falls back gracefully on platforms that do not
   * support the syscall.
   *
   * @param path           - Filesystem path to check (default: current working directory)
   * @param maxUsagePercent - Alert threshold in percent (default: 90)
   */
  disk(path: string = process.cwd(), maxUsagePercent: number = 90): HealthChecker {
    const checker: HealthChecker = async () => {
      try {
        // statfs is available in Node 18+ and Bun
        const { statfs } = await import('fs/promises');
        if (typeof statfs !== 'function') {
          return { status: 'healthy', message: 'statfs not available on this platform' };
        }

        const stats = await (statfs as Function)(path) as {
          blocks: number;
          bfree: number;
          bsize: number;
        };

        const totalBytes = stats.blocks * stats.bsize;
        const freeBytes  = stats.bfree  * stats.bsize;
        const usedBytes  = totalBytes - freeBytes;
        const usagePct   = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
        const isHealthy  = usagePct < maxUsagePercent;

        return {
          status: isHealthy ? 'healthy' : 'unhealthy',
          message: `Disk usage: ${usagePct.toFixed(1)}% (threshold: ${maxUsagePercent}%)`,
          usagePercent: parseFloat(usagePct.toFixed(1)),
          freeGB:        parseFloat((freeBytes  / 1e9).toFixed(2)),
          totalGB:       parseFloat((totalBytes / 1e9).toFixed(2)),
          path,
        };
      } catch (err) {
        // statfs may throw ENOSYS on some platforms — degrade gracefully
        return {
          status: 'healthy',
          message: `Disk check unavailable: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    };
    setCheckerDisplayName(checker, 'disk');
    return checker;
  }
};

