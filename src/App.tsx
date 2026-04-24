/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Theremin from './components/Theremin';
import { PluginProvider } from './plugins/PluginProvider';

export default function App() {
  return (
    <div className="min-h-screen bg-black">
      <PluginProvider>
        <Theremin />
      </PluginProvider>
    </div>
  );
}
