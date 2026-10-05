/**
 * Shell-test setup (#290). testing-library's `waitFor` / `findBy*` give up after 1 s by default.
 * Alone, the Instruments view seeds and renders in a few hundred milliseconds; under the full
 * suite's parallel load the same render has been seen to take longer, and a correct test
 * failed only because it stopped waiting. 4 s keeps a broken test failing quickly (well inside
 * vitest's 5 s test timeout) while a slow machine is not a red build. Only for the jsdom
 * environment: a Node test never waits on the DOM.
 */
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 4000 });
}
