import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';
import { snakeCase } from 'typeorm/util/StringUtils';

/**
 * TypeORM naming strategy mapping camelCase properties to snake_case columns.
 *
 * Keeps the database idiomatic for SQL (`created_at`, `seat_id`) while the
 * entities stay idiomatic for TypeScript (`createdAt`, `seatId`). Explicit names
 * given in a decorator are kept as they are.
 *
 * @example
 * ```typescript
 * new DataSource({ ..., namingStrategy: new SnakeNamingStrategy() });
 * // UserEntity.lastLoginAt -> users.last_login_at
 * ```
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  /**
   * Name of the table of an entity.
   *
   * @param targetName - Class name of the entity
   * @param userSpecifiedName - Name given in `@Entity({ name })`, if any
   * @returns The explicit name, or the snake_cased class name
   */
  override tableName(targetName: string, userSpecifiedName: string | undefined): string {
    return userSpecifiedName ?? snakeCase(targetName);
  }

  /**
   * Name of a column.
   *
   * @param propertyName - Property name on the entity
   * @param customName - Name given in `@Column({ name })`, if any
   * @param embeddedPrefixes - Prefixes of the embedded entities the column belongs to
   * @returns The snake_cased, prefixed column name
   */
  override columnName(propertyName: string, customName: string | undefined, embeddedPrefixes: string[]): string {
    const prefix: string = embeddedPrefixes.map((part: string): string => `${snakeCase(part)}_`).join('');
    return prefix + (customName ?? snakeCase(propertyName));
  }

  /**
   * Name of a relation property.
   *
   * @param propertyName - Property name on the entity
   * @returns The snake_cased name
   */
  override relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  /**
   * Name of the column holding a foreign key when `@JoinColumn` gives none.
   *
   * @param relationName - Name of the relation property
   * @param referencedColumnName - Column referenced on the other side
   * @returns E.g. `seat_id` for relation `seat` referencing `id`
   */
  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  /**
   * Name of the junction table of a many-to-many relation.
   *
   * @param firstTableName - Table of the owning side
   * @param secondTableName - Table of the other side
   * @param firstPropertyName - Relation property on the owning side
   * @returns E.g. `campaigns_platforms`
   */
  override joinTableName(firstTableName: string, secondTableName: string, firstPropertyName: string): string {
    return snakeCase(`${firstTableName}_${firstPropertyName.replaceAll('.', '_')}_${secondTableName}`);
  }

  /**
   * Name of a column of a junction table.
   *
   * @param tableName - Table the column points to
   * @param propertyName - Primary key property on that table
   * @param columnName - Explicit primary key column name, if any
   * @returns E.g. `campaigns_id`
   */
  override joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return snakeCase(`${tableName}_${columnName ?? propertyName}`);
  }
}
