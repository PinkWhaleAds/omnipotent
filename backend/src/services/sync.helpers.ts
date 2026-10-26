/**
 * @module services/sync.helpers
 *
 * The **dirty bit** of the synchronization, and nothing else.
 *
 * It lives apart from the engine on purpose: every service that writes something a platform can see
 * marks it, and none of them should have to know what a sync is. The rule it enforces is the fourth
 * of D34 — *never load a clean campaign* (`../../CADRAGE.md` § 14):
 *
 * > Chaque modification d'une campagne lancée marque les unités concernées `pending` **dans la même
 * > transaction** que la modification.
 *
 * In the same transaction is the whole point. A modification that commits while its mark does not
 * would be a campaign the engine believes is up to date and never looks at again — and nothing would
 * ever notice, because the engine's whole economy is that it does not look at clean campaigns.
 */
import { EntityManager, In, Not } from 'typeorm';

import { LineEntity, PlatformUnitEntity } from '@src/database/entities';

/**
 * Mark every unit of a campaign as having something to apply.
 *
 * Safe to call for a draft, for a campaign nobody launched, for one whose platforms have no adapter:
 * there are no units, nothing is marked, and it costs one indexed `UPDATE` that touches no row.
 * Callers therefore never have to ask whether a campaign is live.
 *
 * The **fingerprint is left alone**, which is what makes this cheap to be generous with: a
 * modification that does not actually change what a platform must hold leaves the hash equal, so the
 * sync it triggers makes **no call at all** (`docs/phase-9.md` § 3). A modification is also a fresh
 * start, so the failed attempts and the backoff are cleared — including on a unit whose last failure
 * was definitive, since that is exactly the state a correction is meant to leave.
 *
 * @param manager - The transaction the modification is being written in
 * @param campaignId - The campaign that changed
 * @returns How many units were marked
 *
 * @example
 * ```typescript
 * await manager.save(LineEntity, line);
 * await markCampaignDirty(manager, line.campaignId);
 * ```
 */
export async function markCampaignDirty(manager: EntityManager, campaignId: string): Promise<number> {
  return mark(manager, { campaignId });
}

/**
 * Mark the units a condition names.
 *
 * The one place the mark is written, so the three questions above differ only by **which** units they
 * are asking about.
 *
 * @param manager - The transaction
 * @param where - Which units
 * @returns How many were marked; `0` with a driver that does not report it
 */
async function mark(manager: EntityManager, where: Record<string, unknown>): Promise<number> {
  const { affected }: { affected?: number | null } = await manager.update(
    PlatformUnitEntity,
    { ...where, syncState: Not('pending') },
    { syncState: 'pending', attempts: 0, nextAttemptAt: null }
  );
  return affected ?? 0;
}

/**
 * Mark the units of several campaigns at once.
 *
 * @param manager - The transaction
 * @param campaignIds - The campaigns that changed; an empty list does nothing
 * @returns How many units were marked
 */
export async function markCampaignsDirty(manager: EntityManager, campaignIds: readonly string[]): Promise<number> {
  if (campaignIds.length === 0) return 0;
  return mark(manager, { campaignId: In([...new Set(campaignIds)]) });
}

/**
 * Mark every campaign whose Lines deliver a given creative.
 *
 * A creative lives at the Advertiser and is shared by Lines of **several** campaigns (phase 6), so
 * activating another version, deleting it or bringing it back changes what more than one campaign
 * must hold over there. The Line itself has not been written, so nothing else would mark them.
 *
 * @param manager - The transaction
 * @param creativeId - The creative that changed
 * @returns How many units were marked
 *
 * @example
 * ```typescript
 * await markCreativeDirty(manager, creativeId); // after activating a version
 * ```
 */
export async function markCreativeDirty(manager: EntityManager, creativeId: string): Promise<number> {
  const lines: { campaignId: string }[] = await manager.find(LineEntity, {
    where: { creativeId },
    select: { campaignId: true },
    withDeleted: true,
  });
  return markCampaignsDirty(
    manager,
    lines.map((line: { campaignId: string }): string => line.campaignId)
  );
}

/**
 * Mark every campaign whose targeting mentions a given reusable list.
 *
 * A list is referenced **by id**, inside the targeting of a TargetingGroup, under whichever dimension
 * uses it (phase 5). Its contents are therefore not part of the desired state's fingerprint, and
 * editing a list would otherwise reach no platform ever.
 *
 * The search is a plain containment on the serialized targeting, in one statement, and it is
 * deliberately **over-inclusive**: it cannot miss a reference, and a false positive costs nothing at
 * all — the fingerprint of that campaign has not changed, so its sync makes no call
 * (`docs/phase-9.md` § 3). Being generous here is free; being precise would need an index per
 * dimension.
 *
 * @param manager - The transaction
 * @param listId - The list that changed
 * @returns How many units were marked
 *
 * @example
 * ```typescript
 * await markListDirty(manager, listId); // after adding values to a list
 * ```
 */
export async function markListDirty(manager: EntityManager, listId: string): Promise<number> {
  const rows: { campaignId: string }[] = await manager.query(
    'SELECT DISTINCT campaign_id AS "campaignId" FROM targeting_groups WHERE targeting::text LIKE $1',
    [`%${listId}%`]
  );
  return markCampaignsDirty(
    manager,
    rows.map((row: { campaignId: string }): string => row.campaignId)
  );
}

/**
 * Mark every unit that buys on a given account.
 *
 * An account that was refused and is fixed, or whose key is replaced, has units nobody has written
 * since: they were skipped while the access was broken, and nothing in their own campaigns changed.
 * Without this, they would wait for the next modification of a campaign that may never come.
 *
 * @param manager - The transaction
 * @param adAccountId - The account whose access changed
 * @returns How many units were marked
 *
 * @example
 * ```typescript
 * await markAccountDirty(manager, adAccountId); // after a new key was stored
 * ```
 */
export async function markAccountDirty(manager: EntityManager, adAccountId: string): Promise<number> {
  return mark(manager, { adAccountId });
}
