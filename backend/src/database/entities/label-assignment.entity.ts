import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from './base.entity';

/**
 * A Label posted on one resource: **one polymorphic table** for every labelable kind, not a join
 * table per kind (D39).
 *
 * The consequence is deliberate: referential integrity towards the resource is carried by the
 * application, not by the database, so that making a new kind labelable needs **no migration**.
 * Resources being soft-deleted, an orphan assignment is harmless and sweepable.
 *
 * `resourceType` is an application-level enumeration that grows with each phase (`advertiser`
 * today), which is exactly why it is a `varchar` and not a PostgreSQL enum: adding a kind would
 * otherwise be a migration.
 */
@Entity({ name: 'label_assignments' })
@Index(['labelId', 'resourceType', 'resourceId'], { unique: true })
@Index(['resourceType', 'resourceId'])
export class LabelAssignmentEntity extends BaseEntity {
  /** The Label posted. */
  @Index()
  @Column({ type: 'uuid' })
  labelId!: string;

  /** What kind of resource it is posted on, e.g. `advertiser`. */
  @Column({ type: 'varchar', length: 32 })
  resourceType!: string;

  /** The resource it is posted on. */
  @Column({ type: 'uuid' })
  resourceId!: string;
}
