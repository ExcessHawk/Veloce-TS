import { Plugin } from '../../core/plugin';
import { VeloceTS } from '../../core/application';
import { DrizzleConfig, DrizzleDatabase, DrizzleTable, DrizzleTableMetadata } from './types';
import { DrizzleRepository as DrizzleRepositoryClass } from './repository';
import { DrizzleTransactionManager } from './transaction-manager';
import { setGlobalTransactionManager } from '../transaction-manager';
import { DrizzleZodSchemaConverter } from './schema-converter';
import { createChildLogger } from '../../logging';

// Re-export repository class for convenience
export { DrizzleRepository } from './repository';

/**
 * Drizzle ORM integration plugin for VeloceTS
 * 
 * Provides seamless integration with Drizzle ORM, including:
 * - Automatic repository generation from schemas
 * - Transaction management with decorator support
 * - Zod schema conversion and validation
 * - Query builder utilities
 * - Database seeding support
 */
export class DrizzlePlugin implements Plugin {
  name = 'drizzle';
  version = '1.0.0';
  
  private database: DrizzleDatabase;
  private config: DrizzleConfig;
  private transactionManager: DrizzleTransactionManager;
  private schemaConverter: DrizzleZodSchemaConverter;
  private tables: Map<string, DrizzleTable> = new Map();
  private tableMetadata: Map<string, DrizzleTableMetadata> = new Map();
  private logger = createChildLogger({ component: 'DrizzlePlugin' });
  
  constructor(database: DrizzleDatabase, config?: DrizzleConfig) {
    this.database = database;
    this.config = {
      logger: false,
      mode: 'default',
      ...config
    };
    this.transactionManager = new DrizzleTransactionManager(database);
    this.schemaConverter = new DrizzleZodSchemaConverter();
  }
  
  async install(app: VeloceTS): Promise<void> {
    try {
      this.logger.info('Installing Drizzle ORM plugin...');
      
      // Set global transaction manager
      setGlobalTransactionManager(this.transactionManager);
      this.logger.debug('Global transaction manager configured');
      
      // Register schema if provided
      if (this.config.schema) {
        this.registerSchema(this.config.schema);
      }
      
      // Register repository factory in DI container
      this.registerRepositoryFactory(app);
      
      // Register database utilities
      this.registerDatabaseUtilities(app);
      
      this.logger.info('✅ Drizzle plugin installed successfully');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to install Drizzle plugin', err);
      throw new Error(`Drizzle plugin installation failed: ${err.message}`);
    }
  }
  
  /**
   * Register Drizzle schema tables
   * @param schema - Object containing Drizzle table definitions
   */
  private registerSchema(schema: Record<string, unknown>): void {
    let registeredCount = 0;
    let skippedCount = 0;
    
    for (const [tableName, table] of Object.entries(schema)) {
      if (this.isValidDrizzleTable(table)) {
        try {
          this.tables.set(tableName, table);
          
          // Extract metadata and generate Zod schemas
          const metadata = this.schemaConverter.extractTableMetadata(table);
          this.tableMetadata.set(tableName, metadata);
          registeredCount++;
          
          this.logger.debug(`Registered table: ${tableName}`);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.error(`Failed to register table ${tableName}`, err, { tableName });
          skippedCount++;
        }
      } else {
        this.logger.debug(`Skipped invalid table: ${tableName}`);
        skippedCount++;
      }
    }
    
    this.logger.info(`📝 Registered ${registeredCount} Drizzle table(s)${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}`);
  }
  
  /**
   * Check if an object is a valid Drizzle table
   * @param obj - Object to validate
   * @returns true if object is a valid Drizzle table
   */
  private isValidDrizzleTable(obj: unknown): obj is DrizzleTable {
    if (!obj || typeof obj !== 'object') {
      return false;
    }
    
    const table = obj as any;
    
    // Check for Drizzle table structure
    if (!table._ || typeof table._ !== 'object') {
      return false;
    }
    
    // Validate name
    if (typeof table._.name !== 'string' || table._.name.trim().length === 0) {
      return false;
    }
    
    // Validate columns exist and is non-empty object
    if (!table._.columns || typeof table._.columns !== 'object') {
      return false;
    }
    
    // Ensure at least one column exists
    if (Object.keys(table._.columns).length === 0) {
      this.logger.warn(`Table ${table._.name} has no columns defined`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Register repository factory in DI container
   * @param app - VeloceTS application instance
   */
  private registerRepositoryFactory(app: VeloceTS): void {
    const container = app.getContainer();
    
    // Register a factory for creating Drizzle repositories
    container.register('DrizzleRepositoryFactory', {
      scope: 'singleton',
      factory: () => ({
        create: <T>(tableName: string, zodSchema?: any) => {
          const table = this.tables.get(tableName);
          if (!table) {
            throw new Error(`Table ${tableName} not found in Drizzle schema`);
          }
          
          return new DrizzleRepositoryClass<T>({
            database: this.database,
            table,
            zodSchema: zodSchema || this.tableMetadata.get(tableName)?.zodSchema
          });
        },
        createFromTable: <T>(table: DrizzleTable, zodSchema?: any) => {
          return new DrizzleRepositoryClass<T>({
            database: this.database,
            table,
            zodSchema
          });
        }
      })
    });
    
    // Register database instance
    container.register('DrizzleDatabase', {
      scope: 'singleton',
      factory: () => this.database
    });
    
    // Register transaction manager
    container.register('TransactionManager', {
      scope: 'singleton',
      factory: () => this.transactionManager
    });
    
    // Register schema converter
    container.register('DrizzleSchemaConverter', {
      scope: 'singleton',
      factory: () => this.schemaConverter
    });
  }
  
  /**
   * Register database utilities
   * @param app - VeloceTS application instance
   */
  private registerDatabaseUtilities(app: VeloceTS): void {
    const container = app.getContainer();
    
    // Register query builder utility
    container.register('QueryBuilder', {
      scope: 'request',
      factory: () => ({
        select: (fields?: any) => this.database.select(fields),
        insert: (table: DrizzleTable) => this.database.insert(table),
        update: (table: DrizzleTable) => this.database.update(table),
        delete: (table: DrizzleTable) => this.database.delete(table),
        raw: (sql: string, params?: any[]) => this.database.execute({ sql, params })
      })
    });
    
    // Note: Migration utilities are handled by drizzle-kit CLI
    // See: https://orm.drizzle.team/kit-docs/overview
    // Users should run: 
    //   - drizzle-kit generate:pg (or mysql/sqlite)
    //   - drizzle-kit push:pg
    //   - drizzle-kit migrate
    
    // Register seeder utility
    container.register('Seeder', {
      scope: 'singleton',
      factory: () => ({
        seed: async (seeders: DrizzleSeeder[]) => {
          const logger = createChildLogger({ component: 'Seeder' });
          try {
            logger.info(`Running ${seeders.length} seeder(s)...`);
            await this.transactionManager.executeInTransaction(async (tx) => {
              for (const seeder of seeders) {
                if (typeof seeder.run === 'function') {
                  logger.debug(`Running seeder: ${seeder.constructor.name}`);
                  await seeder.run(tx);
                } else {
                  logger.warn(`Skipping invalid seeder (no run method): ${seeder.constructor.name}`);
                }
              }
            });
            logger.info('✅ Database seeded successfully');
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error('Failed to seed database', err);
            throw new Error(`Database seeding failed: ${err.message}`);
          }
        }
      })
    });
  }
  
  /**
   * Get table by name
   */
  getTable(name: string): DrizzleTable | undefined {
    return this.tables.get(name);
  }
  
  /**
   * Get all registered tables
   */
  getTables(): Map<string, DrizzleTable> {
    return this.tables;
  }
  
  /**
   * Get table metadata
   */
  getTableMetadata(name: string): DrizzleTableMetadata | undefined {
    return this.tableMetadata.get(name);
  }
  
  /**
   * Get all table metadata
   */
  getAllTableMetadata(): Map<string, DrizzleTableMetadata> {
    return this.tableMetadata;
  }
  
  /**
   * Create a repository for a specific table
   * @param tableName - Name of the table to create repository for
   * @param zodSchema - Optional Zod schema for validation
   * @returns DrizzleRepository instance
   * @throws Error if table is not found
   */
  createRepository<T>(tableName: string, zodSchema?: any): DrizzleRepositoryClass<T> {
    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} not found in Drizzle schema`);
    }
    
    return new DrizzleRepositoryClass<T>({
      database: this.database,
      table,
      zodSchema: zodSchema || this.tableMetadata.get(tableName)?.zodSchema
    });
  }
  
  /**
   * Create a repository from a table instance
   * @param table - Drizzle table instance
   * @param zodSchema - Optional Zod schema for validation
   * @returns DrizzleRepository instance
   */
  createRepositoryFromTable<T>(table: DrizzleTable, zodSchema?: any): DrizzleRepositoryClass<T> {
    return new DrizzleRepositoryClass<T>({
      database: this.database,
      table,
      zodSchema
    });
  }
  
  /**
   * Get the Drizzle database instance
   */
  getDatabase(): DrizzleDatabase {
    return this.database;
  }
  
  /**
   * Get the transaction manager
   */
  getTransactionManager(): DrizzleTransactionManager {
    return this.transactionManager;
  }
  
  /**
   * Get the schema converter
   */
  getSchemaConverter(): DrizzleZodSchemaConverter {
    return this.schemaConverter;
  }
  
  /**
   * Add a table to the schema dynamically
   * @param name - Table name
   * @param table - Drizzle table instance
   */
  addTable(name: string, table: DrizzleTable): void {
    if (!this.isValidDrizzleTable(table)) {
      throw new Error(`Invalid Drizzle table: ${name}`);
    }
    
    this.tables.set(name, table);
    
    // Extract metadata and generate Zod schema
    const metadata = this.schemaConverter.extractTableMetadata(table);
    this.tableMetadata.set(name, metadata);
    
    this.logger.debug(`Added table dynamically: ${name}`);
  }
  
  /**
   * Remove a table from the schema
   * @param name - Table name to remove
   * @returns true if table was removed, false if it didn't exist
   */
  removeTable(name: string): boolean {
    const hadTable = this.tables.has(name);
    this.tables.delete(name);
    this.tableMetadata.delete(name);
    
    if (hadTable) {
      this.logger.debug(`Removed table: ${name}`);
    }
    
    return hadTable;
  }
  
  /**
   * Generate Zod schemas for all tables
   */
  generateZodSchemas(): Record<string, any> {
    const schemas: Record<string, any> = {};
    
    for (const [tableName, table] of this.tables) {
      const allSchemas = this.schemaConverter.generateAllSchemas(table);
      schemas[tableName] = allSchemas;
    }
    
    return schemas;
  }
  
  /**
   * Execute raw SQL query
   * @param sql - Raw SQL query string
   * @param params - Query parameters
   * @returns Query result
   * @warning Use with caution - prefer using the query builder for type safety
   */
  async executeRaw(sql: string, params?: any[]): Promise<any> {
    try {
      this.logger.debug('Executing raw SQL query');
      const result = await this.database.execute({ sql, params });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Raw SQL query failed', err);
      throw new Error(`SQL execution failed: ${err.message}`);
    }
  }
  
  /**
   * Execute multiple queries in a transaction
   * @param callback - Async function that receives transaction database instance
   * @returns Result of the callback
   * @throws Error if transaction fails
   */
  async executeInTransaction<T>(callback: (db: DrizzleDatabase) => Promise<T>): Promise<T> {
    try {
      return await this.transactionManager.executeInTransaction(callback);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Transaction failed', err);
      throw error;
    }
  }
}

/**
 * Helper function to create Drizzle plugin
 */
export function createDrizzlePlugin(database: DrizzleDatabase, config?: DrizzleConfig): DrizzlePlugin {
  return new DrizzlePlugin(database, config);
}

/**
 * Decorator to automatically inject Drizzle repository
 * @param tableName - Name of the table to inject repository for
 * @param zodSchema - Optional Zod schema for validation
 * @returns Property decorator
 * 
 * @example
 * ```typescript
 * class UserService {
 *   @InjectDrizzleRepository('users', UserSchema)
 *   private userRepo!: DrizzleRepository<User>;
 * }
 * ```
 * 
 * @deprecated This decorator is not yet fully implemented. 
 * Use dependency injection or direct instantiation instead:
 * ```typescript
 * const factory = container.resolve('DrizzleRepositoryFactory');
 * const repo = factory.create<User>('users');
 * ```
 */
export function InjectDrizzleRepository(tableName: string, zodSchema?: any): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata = {
      type: 'drizzle-repository',
      tableName,
      zodSchema
    };
    
    Reflect.defineMetadata('inject', metadata, target, propertyKey);
    
    // TODO: Implement automatic injection in the DI container
    // This would require intercepting property access and resolving from container
    const logger = createChildLogger({ component: 'DrizzleRepository' });
    logger.warn('@InjectDrizzleRepository decorator is not fully implemented yet. Consider using factory pattern instead.');
  };
}

/**
 * Seeder base class for Drizzle
 */
export abstract class DrizzleSeeder {
  abstract run(database: DrizzleDatabase): Promise<void>;
}

/**
 * Migration base class for Drizzle (placeholder)
 */
export abstract class DrizzleMigration {
  abstract up(database: DrizzleDatabase): Promise<void>;
  abstract down(database: DrizzleDatabase): Promise<void>;
}