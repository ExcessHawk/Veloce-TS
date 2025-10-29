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
        checks[check.name || 'unknown'] = result;
        
        if (result.status === 'unhealthy') {
          allHealthy = false;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        checks[check.name || 'unknown'] = {
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
    const criticalChecks = this.options.checks.filter(check => 
      check.name?.includes('database') || 
      check.name?.includes('cache') ||
      check.name?.includes('ready')
    );

    let isReady = true;
    const checks: Record<string, CheckResult> = {};

    for (const check of criticalChecks) {
      try {
        const result = await Promise.resolve(check());
        checks[check.name || 'unknown'] = result;
        
        if (result.status === 'unhealthy') {
          isReady = false;
        }
      } catch (error) {
        isReady = false;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        checks[check.name || 'unknown'] = {
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
    checker.name = 'database';
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
    checker.name = 'memory';
    return checker;
  },

  /**
   * Disk space checker
   */
  disk(maxUsagePercent: number = 90): HealthChecker {
    const checker: HealthChecker = () => {
      // This would require additional dependencies
      return {
        status: 'healthy',
        message: 'Disk check not implemented (requires additional dependencies)'
      };
    };
    checker.name = 'disk';
    return checker;
  }
};

