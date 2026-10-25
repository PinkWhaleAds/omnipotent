import { Paginated } from '@src/types';
import { toPage, toSkipTake } from '@utils';

describe('Unit::Utils::Pagination', () => {
  describe('toSkipTake', () => {
    it.each([
      [
        { page: 1, limit: 50 },
        { skip: 0, take: 50 },
      ],
      [
        { page: 3, limit: 20 },
        { skip: 40, take: 20 },
      ],
      [
        { page: 2, limit: 1 },
        { skip: 1, take: 1 },
      ],
    ])('should translate %o into %o', (query, expected): void => {
      expect(toSkipTake(query)).toEqual(expected);
    });
  });

  describe('toPage', () => {
    it('should wrap the items with the total and the page request', (): void => {
      const page: Paginated<string> = toPage(['a', 'b'], 12, { page: 2, limit: 2 });

      expect(page).toEqual({ items: ['a', 'b'], total: 12, page: 2, limit: 2 });
    });

    it('should wrap an empty page', (): void => {
      const page: Paginated<number> = toPage([], 0, { page: 1, limit: 50 });

      expect(page).toEqual({ items: [], total: 0, page: 1, limit: 50 });
    });
  });
});
