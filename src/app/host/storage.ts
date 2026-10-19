/**
 * The app's storage target (#600 S12), chosen once, here: every named collection, core's and an
 * extension's, reaches its provider through the SDK's storage seam (`@thoremin/sdk-ui/storage`),
 * and this is the one place that decides what that provider is. Today: the browser's localStorage,
 * under each store's own key (what every store used before the seam, so nothing moves). Files or a
 * cloud target later replace this one line, never a store.
 */
import { localStorageCollectionProvider, provideStorage } from '@thoremin/sdk-ui/storage';

provideStorage({ collection: localStorageCollectionProvider });
