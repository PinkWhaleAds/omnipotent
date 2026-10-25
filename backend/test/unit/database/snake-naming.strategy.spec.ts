import { SnakeNamingStrategy } from '@src/database/snake-naming.strategy';

describe('Unit::Database::SnakeNamingStrategy', () => {
  let strategy: SnakeNamingStrategy;

  beforeEach((): void => {
    jest.clearAllMocks();
    strategy = new SnakeNamingStrategy();
  });

  describe('tableName', () => {
    it('should snake_case the entity class name', (): void => {
      expect(strategy.tableName('OrganizationMembership', undefined)).toBe('organization_membership');
    });

    it('should keep an explicit table name', (): void => {
      expect(strategy.tableName('OrganizationMembershipEntity', 'organization_memberships')).toBe(
        'organization_memberships'
      );
    });
  });

  describe('columnName', () => {
    it('should snake_case the property name', (): void => {
      expect(strategy.columnName('lastLoginAt', undefined, [])).toBe('last_login_at');
    });

    it('should keep an explicit column name', (): void => {
      expect(strategy.columnName('lastLoginAt', 'last_seen', [])).toBe('last_seen');
    });

    it('should prefix the column of an embedded entity', (): void => {
      expect(strategy.columnName('countryCode', undefined, ['billingAddress', 'geoPoint'])).toBe(
        'billing_address_geo_point_country_code'
      );
    });

    it('should prefix an explicit column name of an embedded entity', (): void => {
      expect(strategy.columnName('countryCode', 'country', ['billingAddress'])).toBe('billing_address_country');
    });
  });

  describe('relationName', () => {
    it('should snake_case the relation property', (): void => {
      expect(strategy.relationName('parentOrganization')).toBe('parent_organization');
    });
  });

  describe('joinColumnName', () => {
    it('should join the relation and the referenced column', (): void => {
      expect(strategy.joinColumnName('seat', 'id')).toBe('seat_id');
      expect(strategy.joinColumnName('parentOrganization', 'externalId')).toBe('parent_organization_external_id');
    });
  });

  describe('joinTableName', () => {
    it('should name the junction table after both tables and the owning property', (): void => {
      expect(strategy.joinTableName('campaigns', 'platforms', 'platforms')).toBe('campaigns_platforms_platforms');
    });

    it('should flatten a nested owning property', (): void => {
      expect(strategy.joinTableName('campaigns', 'platforms', 'targeting.platforms')).toBe(
        'campaigns_targeting_platforms_platforms'
      );
    });
  });

  describe('joinTableColumnName', () => {
    it('should join the table and its primary key property', (): void => {
      expect(strategy.joinTableColumnName('campaigns', 'id')).toBe('campaigns_id');
    });

    it('should prefer the explicit primary key column name', (): void => {
      expect(strategy.joinTableColumnName('campaigns', 'id', 'campaignUuid')).toBe('campaigns_campaign_uuid');
    });
  });
});
