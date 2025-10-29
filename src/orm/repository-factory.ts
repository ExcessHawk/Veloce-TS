import { z } from 'zod';
import { BaseRepository, IBaseRepository } from './base-repository';
import { PrismaRepository } from './prisma/repository';
import { TypeORMRepository } from './typeorm/repository';
import { DrizzleRepository } from './drizzle/repository';

// Repository factory interface
export interface IRepositoryFactory {
  createRepository<T, ID = string | number>(
    type: 'prisma' | 'typeorm' | 'drizzle',
    options: any
  ): IBaseRepository<T, ID>;
}

/**
 * Universal repository factory for creating ORM-specific repositories
 */
export class RepositoryFactory implements IRepositoryFactory {
  private static instance: RepositoryFactory;
  
  private constructor() {}
  
  static getInstance(): RepositoryFactory {
    if (!RepositoryFactory.instance) {
      RepositoryFactory.instance = new RepositoryFactory();
    }
    return RepositoryFactory.instance;
  }
  
  /**
   * Create a repository based on ORM type
   */
  createRepository<T, ID = string | number>(
    type: 'prisma' | 'typeorm' | 'drizzle',
    options: any
  ): IBaseRepository<T, ID> {
    switch (type) {
      case 'prisma':
        return new PrismaRepository<T, ID>(options);
      case 'typeorm':
        return new TypeORMRepository<T, ID>(options);
      case 'drizzle':
        return new DrizzleRepository<T, ID>(options);
      default:
        throw new Error(`Unsupported repository type: ${type}`);
    }
  }
  
  /**
   * Create a Prisma repository
   */
  createPrismaRepository<T, ID = string | number>(options: {
    client: any;
    delegate: any;
    model: string;
    zodSchema?: z.ZodSchema<T>;
  }): PrismaRepository<T, ID> {
    return new PrismaRepository<T, ID>(options);
  }
  
  /**
   * Create a TypeORM repository
   */
  createTypeORMRepository<T, ID = string | number>(options: {
    dataSource: any;
    repository: any;
    entity: any;
    zodSchema?: z.ZodSchema<T>;
  }): TypeORMRepository<T, ID> {
    return new TypeORMRepository<T, ID>(options);
  }
  
  /**
   * Create a Drizzle repository
   */
  createDrizzleRepository<T, ID = string | number>(options: {
    database: any;
    table: any;
    zodSchema?: z.ZodSchema<T>;
  }): DrizzleRepository<T, ID> {
    return new DrizzleRepository<T, ID>(options);
  }
}

/**
 * Repository registry for managing multiple repositories
 */
export class RepositoryRegistry {
  private repositories = new Map<string, IBaseRepository<any>>();
  private factory: RepositoryFactory;
  
  constructor() {
    this.factory = RepositoryFactory.getInstance();
  }
  
  /**
   * Register a repository
   */
  register<T, ID = string | number>(
    name: string,
    repository: IBaseRepository<T, ID>
  ): void {
    this.repositories.set(name, repository as IBaseRepository<any, string | number>);
  }
  
  /**
   * Get a registered repository
   */
  get<T, ID = string | number>(name: string): IBaseRepository<T, ID> | undefined {
    return this.repositories.get(name) as IBaseRepository<T, ID> | undefined;
  }
  
  /**
   * Create and register a repository
   */
  createAndRegister<T, ID = string | number>(
    name: string,
    type: 'prisma' | 'typeorm' | 'drizzle',
    options: any
  ): IBaseRepository<T, ID> {
    const repository = this.factory.createRepository<T, ID>(type, options);
    this.register(name, repository);
    return repository;
  }
  
  /**
   * Remove a repository
   */
  remove(name: string): boolean {
    return this.repositories.delete(name);
  }
  
  /**
   * Get all registered repository names
   */
  getNames(): string[] {
    return Array.from(this.repositories.keys());
  }
  
  /**
   * Clear all repositories
   */
  clear(): void {
    this.repositories.clear();
  }
  
  /**
   * Get repository count
   */
  size(): number {
    return this.repositories.size;
  }
}

/**
 * Generic repository decorator for automatic repository creation
 */
export function GenericRepository<T>(
  name: string,
  type: 'prisma' | 'typeorm' | 'drizzle',
  options: any
): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata = {
      type: 'generic-repository',
      name,
      ormType: type,
      options
    };
    
    Reflect.defineMetadata('inject', metadata, target, propertyKey);
  };
}

/**
 * Repository mixin for adding common repository functionality
 * 
 * Note: Members are public because TypeScript doesn't allow exporting
 * anonymous classes with protected/private members (TS4094)
 */
export function withRepositoryMixin<T extends new (...args: any[]) => {}>(Base: T) {
  return class extends Base {
    public repositories: RepositoryRegistry = new RepositoryRegistry();
    
    /**
     * Get a repository by name
     */
    public getRepository<R, ID = string | number>(name: string): IBaseRepository<R, ID> | undefined {
      return this.repositories.get<R, ID>(name);
    }
    
    /**
     * Create and register a repository
     */
    public createRepository<R, ID = string | number>(
      name: string,
      type: 'prisma' | 'typeorm' | 'drizzle',
      options: any
    ): IBaseRepository<R, ID> {
      return this.repositories.createAndRegister<R, ID>(name, type, options);
    }
    
    /**
     * Execute operation with multiple repositories in transaction
     */
    public async withRepositories<R>(
      repositoryNames: string[],
      callback: (repos: Map<string, IBaseRepository<any>>) => Promise<R>
    ): Promise<R> {
      const repos = new Map<string, IBaseRepository<any>>();
      
      for (const name of repositoryNames) {
        const repo = this.repositories.get(name);
        if (repo) {
          repos.set(name, repo);
        }
      }
      
      // If all repositories support transactions, use the first one's transaction
      const firstRepo = repos.values().next().value;
      if (firstRepo && typeof firstRepo.withTransaction === 'function') {
        return await firstRepo.withTransaction(async () => {
          return await callback(repos);
        });
      }
      
      // Otherwise, execute without transaction
      return await callback(repos);
    }
  };
}

/**
 * Repository service base class
 */
export abstract class RepositoryService {
  protected repositories: RepositoryRegistry = new RepositoryRegistry();
  
  constructor() {
    this.initializeRepositories();
  }
  
  /**
   * Initialize repositories - to be implemented by subclasses
   */
  protected abstract initializeRepositories(): void;
  
  /**
   * Get a repository by name
   */
  protected getRepository<T, ID = string | number>(name: string): IBaseRepository<T, ID> {
    const repo = this.repositories.get<T, ID>(name);
    if (!repo) {
      throw new Error(`Repository '${name}' not found`);
    }
    return repo;
  }
  
  /**
   * Execute operation in transaction across multiple repositories
   */
  protected async executeInTransaction<T>(
    repositoryNames: string[],
    callback: (repos: Map<string, IBaseRepository<any>>) => Promise<T>
  ): Promise<T> {
    const repos = new Map<string, IBaseRepository<any>>();
    
    for (const name of repositoryNames) {
      const repo = this.repositories.get(name);
      if (repo) {
        repos.set(name, repo);
      }
    }
    
    // Use the first repository's transaction if available
    const firstRepo = repos.values().next().value;
    if (firstRepo && typeof firstRepo.withTransaction === 'function') {
      return await firstRepo.withTransaction(async () => {
        return await callback(repos);
      });
    }
    
    return await callback(repos);
  }
}

// Global repository registry instance
export const globalRepositoryRegistry = new RepositoryRegistry();