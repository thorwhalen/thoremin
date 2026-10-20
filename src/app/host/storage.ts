/**
 * The app's storage target (#600 S12), chosen once, here: every named collection, core's and an
 * extension's, reaches its provider through the SDK's storage seam (`@thoremin/sdk-ui/storage`),
 * and so does every key-value store (the persist stores, the profiles, a JSON blob): this is the
 * one place that decides both targets. Today: the browser's localStorage, under each store's own key (what every store used before the seam, so nothing moves). Files or a
 * cloud target later replace this one line, never a store.
 */
import { localStorageCollectionProvider, localStorageValues, provideStorage } from '@thoremin/sdk-ui/storage';

provideStorage({ collection: localStorageCollectionProvider, values: localStorageValues });
