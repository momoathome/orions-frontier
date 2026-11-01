import { expect, test } from 'vitest';
import { mergeById } from '../../src/shared/lib/paging';

test('merging a page keeps the order and drops entries already shown', () => {
  const shown = [{ id: 'c' }, { id: 'b' }];
  const page = [{ id: 'b' }, { id: 'a' }];
  expect(mergeById(shown, page)).toEqual([{ id: 'c' }, { id: 'b' }, { id: 'a' }]);
});
