// @vitest-environment jsdom
/**
 * A remembered select (`play/src/remembered_select.ts`) keeps the player's own choice, and not one
 * a game opened from a file set (the spec bar's `change` is not the player's).
 */
import { it, expect } from 'vitest';
import { rememberedSelect } from '../../play/src/remembered_select';

it('does not remember a choice an opened game set', () => {
  localStorage.clear();
  const sel = document.createElement('select');
  rememberedSelect(sel, { a: 'A', b: 'B' }, 'k');
  sel.value = 'b';
  sel.dispatchEvent(new Event('change'));
  expect(localStorage.getItem('k')).toBeNull();
  // (A player's own change is a trusted event, which jsdom cannot make; the smoke covers the page.)
});
