import { Plugin } from '../../core/plugin';
import { VeloceTS } from '../../core/application';
import { TypeORMConfig, DataSourceLike, TypeORMEntityMetadata } from './types';
import { TypeORMRepository } from './repository';
import { TypeORMTransactionManager } from './transaction-manager';
import { setGlobalTransactionManager } from '../transaction-manager';
import fs from 'fs';
import path from 'path';

/**
 * TypeORM integration plugin for FastAPI-TS
 */
export class TypeORMPlugin implements Plugin {
  name = 'typeorm';
  version = '1.0.0';
  
  private dataSource: DataSourceLike;
  private config: TypeORMConfig;
  private transactionManager: TypeORMTransactionManager;
  private entities: Map<string, TypeORMEntityMetadata> = new Map();
  
  constructor(dataSource: DataSourceLike, config?: Partial<TypeORMConfig>) {
    this.dataSource = dataSource;
    this.config = {
      synchronize: false,
      logging: false,
      migrationsRun: false,
      dropSchema: false,
      cache: false,
      ...config
    } as TypeORMConfig;
    this.transactionManager = new TypeORMTransactionManager(dataSource);
  }
  
  async install(app: VeloceTS): Promise<void> {
    // Initialize data source if not already initialized
    if (!this.dataSource.isInitialized) {
      await this.dataSource.initialize();
    }
    
    // Set global transaction manager
    setGlobalTransactionManager(this.transactionManager);
    
    // Extract entity metadata
    this.extractEntityMetadata();
    
    // Register repository factory in DI container
    this.registerRepositoryFactory(app);
    
    // Register migration and seeding utilities
    this.registerMigrationUtilities(app);
    
    // Add cleanup on app shutdown
    this.registerShutdownHook(app);
    
    console.log('✅ TypeORM plugin installed successfully');
  }
  
  /**
   * Extract metadata from TypeORM entities
   */
  private extractEntityMetadata(): void {
    try {
      // Get all entity metadata from the data source
      const entityMetadatas = this.dataSource.entityMetadatas || this.dataSource.manager.connection?.entityMetadatas || [];
      
      for (const metadata of entityMetadatas) {
        const entityMeta: TypeORMEntityMetadata = {
          name: metadata.name,
          tableName: metadata.tableName,
          columns: metadata.columns?.map((col: any) => ({
            propertyName: col.propertyName,
            type: col.type as string,
            isPrimary: col.isPrimary,
            isGenerated: col.isGenerated,
            isNullable: col.isNullable,
            isUnique: col.isUnique,
            length: col.length,
            default: col.default
          })) || [],
          relations: metadata.relations?.map((rel: any) => ({
            propertyName: rel.propertyName,
            type: rel.relationType as any,
            target: rel.inverseEntityMetadata?.name || 'unknown',
            inverseSide: rel.inverseSidePropertyPath,
            joinColumn: rel.joinColumns?.[0]?.databaseName,
            joinTable: rel.joinTableName
          })) || []
        };
        
        this.entities.set(metadata.name, entityMeta);
      }
      
      console.log(`📝 Extracted metadata for ${this.entities.size} entities`);
    } catch (error) {
      console.error('❌ Failed to extract entity metadata:', error);
    }
  }
  
  /**
   * Register repository factory in DI container
   */
  private registerRepositoryFactory(app: VeloceTS): void {
    const container = app.getContainer();
    
    // Create token classes for DI registration
    class TypeORMRepositoryFactoryToken {}
    class DataSourceToken {}
    class EntityManagerToken {}
    class TransactionManagerToken {}
    
    // Register a factory for creating TypeORM repositories
    container.register(TypeORMRepositoryFactoryToken, {
      scope: 'singleton',
      factory: () => ({
        create: <T>(entity: any, zodSchema?: any) => {
          const repository = this.dataSource.getRepository<T>(entity);
          
          return new TypeORMRepository<T>({
            dataSource: this.dataSource,
            repository,
            entity,
            zodSchema
          });
        }
      })
    });
    
    // Register data source
    container.register(DataSourceToken, {
      scope: 'singleton',
      factory: () => this.dataSource
    });
    
    // Register entity manager
    container.register(EntityManagerToken, {
      scope: 'request',
      factory: () => this.dataSource.manager
    });
    
    // Register transaction manager
    container.register(TransactionManagerToken, {
      scope: 'singleton',
      factory: () => this.transactionManager
    });
  }
  
  /**
   * Register migration and seeding utilities
   */
  private registerMigrationUtilities(app: VeloceTS): void {
    const container = app.getContainer();
    
    // Create token classes for migration utilities
    class MigrationRunnerToken {}
    class SeederToken {}
    
    // Register migration runner
    container.register(MigrationRunnerToken, {
      scope: 'singleton',
      factory: () => ({
        run: async () => {
          if (this.config.migrationsRun && this.dataSource.runMigrations) {
            await this.dataSource.runMigrations();
            console.log('✅ Migrations executed successfully');
          }
        },
        revert: async () => {
          if (this.dataSource.undoLastMigration) {
            await this.dataSource.undoLastMigration();
            console.log('✅ Last migration reverted successfully');
          }
        },
        generate: async (name: string) => {
          // This would require TypeORM CLI integration
          console.log(`📝 Generate migration: ${name}`);
        }
      })
    });
    
    // Register seeder utility
    container.register(SeederToken, {
      scope: 'singleton',
      factory: () => ({
        seed: async (seeders: any[]) => {
          for (const seeder of seeders) {
            if (typeof seeder.run === 'function') {
              await seeder.run(this.dataSource);
            }
          }
          console.log('✅ Database seeded successfully');
        }
      })
    });
  }
  
  /**
   * Register shutdown hook to close data source
   */
  private registerShutdownHook(app: VeloceTS): void {
    // Add shutdown handler
    process.on('SIGINT', async () => {
      console.log('🔌 Closing database connection...');
      if (this.dataSource.isInitialized) {
        await this.dataSource.destroy();
      }
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('🔌 Closing database connection...');
      if (this.dataSource.isInitialized) {
        await this.dataSource.destroy();
      }
      process.exit(0);
    });
  }
  
  /**
   * Get entity metadata
   */
  getEntity(name: string): TypeORMEntityMetadata | undefined {
    return this.entities.get(name);
  }
  
  /**
   * Get all entities
   */
  getEntities(): Map<string, TypeORMEntityMetadata> {
    return this.entities;
  }
  
  /**
   * Create a repository for a specific entity
   */
  createRepository<T>(entity: any, zodSchema?: any): TypeORMRepository<T> {
    const repository = this.dataSource.getRepository<T>(entity);
    
    return new TypeORMRepository<T>({
      dataSource: this.dataSource,
      repository,
      entity,
      zodSchema
    });
  }
  
  /**
   * Get the TypeORM data source
   */
  getDataSource(): DataSourceLike {
    return this.dataSource;
  }
  
  /**
   * Get the transaction manager
   */
  getTransactionManager(): TypeORMTransactionManager {
    return this.transactionManager;
  }
  
  /**
   * Run migrations
   */
  async runMigrations(): Promise<void> {
    if (this.dataSource.runMigrations) {
      await this.dataSource.runMigrations();
      console.log('✅ Migrations executed successfully');
    } else {
      console.warn('⚠️  Migration support not available');
    }
  }
  
  /**
   * Revert last migration
   */
  async revertMigration(): Promise<void> {
    if (this.dataSource.undoLastMigration) {
      await this.dataSource.undoLastMigration();
      console.log('✅ Last migration reverted successfully');
    } else {
      console.warn('⚠️  Migration revert not available');
    }
  }
  
  /**
   * Synchronize database schema (use with caution in production)
   */
  async synchronize(): Promise<void> {
    if (this.config.synchronize && this.dataSource.synchronize) {
      await this.dataSource.synchronize();
      console.log('✅ Database schema synchronized');
    } else {
      console.warn('⚠️  Schema synchronization is disabled or not available');
    }
  }
  
  /**
   * Drop database schema (use with extreme caution)
   */
  async dropSchema(): Promise<void> {
    if (this.config.dropSchema && this.dataSource.dropDatabase) {
      await this.dataSource.dropDatabase();
      console.log('✅ Database schema dropped');
    } else {
      console.warn('⚠️  Schema dropping is disabled or not available');
    }
  }
}

/**
 * Helper function to create TypeORM plugin
 */
export function createTypeORMPlugin(dataSource: DataSourceLike, config?: Partial<TypeORMConfig>): TypeORMPlugin {
  return new TypeORMPlugin(dataSource, config);
}

/**
 * Migration base class
 */
export abstract class Migration {
  abstract up(queryRunner: any): Promise<void>;
  abstract down(queryRunner: any): Promise<void>;
}

/**
 * Seeder base class
 */
export abstract class Seeder {
  abstract run(dataSource: DataSourceLike): Promise<void>;
}

/**
 * Entity subscriber base class
 */
export abstract class EntitySubscriber {
  abstract listenTo(): any;
  
  beforeInsert?(event: any): Promise<void> | void;
  afterInsert?(event: any): Promise<void> | void;
  beforeUpdate?(event: any): Promise<void> | void;
  afterUpdate?(event: any): Promise<void> | void;
  beforeRemove?(event: any): Promise<void> | void;
  afterRemove?(event: any): Promise<void> | void;
}