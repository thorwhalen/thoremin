/**
 * thoremin-daw: thoremin's own build (the landing, the camera app `instruments/`, the listening
 * pages, `public/`) with the gated DAW app's extension list, `extensions.daw.json` (the camera
 * build's plus `@thoremin/ext-daw`), served at `/thoremin-daw/` to signed-in users only
 * (`enlace_apps/thoremin-daw/app.toml`, `access = "protected:user"`). The public build
 * (`npm run build`, `extensions.json`) never lists the DAW, so its code ships only here.
 *
 * `npm run build:daw` writes `enlace_apps/thoremin-daw/frontend/`, the app dir tw_platform deploys;
 * the deployer sets `VITE_PUBLIC_BASE=/thoremin-daw/`. Same wrapper pattern as funfon's
 * (`vite.funfon.config.ts`), but over the main config, since this is the camera app itself.
 *
 * The player guide is rebuilt for this list into the output's `guide/` (`guideForExtensions`): the
 * committed `public/guide/` is the public build's, which leaves out the pages of an extension it
 * does not list (`extension:` in a page's front matter, `scripts/lib_guide.ts`).
 *
 * The landing page (`index.html`) gets this app's own head (`dawHead`): its name, its line, and the
 * theme colour and preview picture every app on the platform must declare (tw_platform's app
 * identity rule; the icon is the platform's `app_icons/thoremin-daw.png`). The source page is the
 * public app's and stays untouched.
 */
import path from 'path';
import { defineConfig, mergeConfig, type Plugin, type UserConfig } from 'vite';
import baseConfig from './vite.config';
import { readExtensionEntries } from './vite.extensions';
import { guideForExtensions } from './vite.guide';

/** The gated app's extension list. */
export const DAW_MANIFEST = 'extensions.daw.json';
/** The app dir's `frontend_dir` (`enlace_apps/thoremin-daw/app.toml`). */
export const DAW_OUT_DIR = path.resolve(__dirname, 'enlace_apps', 'thoremin-daw', 'frontend');

/** This app's head on the landing page: name, line, theme colour, preview picture (the DJ deck's
 *  guide picture, `public/guide/pics/dj-deck.jpg`). */
export const DAW_HEAD = {
  title: 'thoremin DAW',
  description: 'Thoremin with the DAW extension.',
  themeColor: '#4c1d95',
  image: 'guide/pics/dj-deck.jpg',
};

function dawHead(): Plugin {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return {
    name: 'thoremin-daw-head',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // The landing only (the root `index.html`); the camera app and the listening pages keep theirs.
        if (ctx.path !== '/index.html') return html;
        const head = [
          `<meta name="theme-color" content="${esc(DAW_HEAD.themeColor)}" />`,
          `<meta property="og:title" content="${esc(DAW_HEAD.title)}" />`,
          `<meta property="og:description" content="${esc(DAW_HEAD.description)}" />`,
          `<meta property="og:image" content="${esc(DAW_HEAD.image)}" />`,
        ].join('\n    ');
        return html
          .replace(/<title>[^<]*<\/title>/, `<title>${esc(DAW_HEAD.title)}</title>`)
          .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(DAW_HEAD.description)}" />\n    ${head}`);
      },
    },
  };
}

export default defineConfig((env) => {
  // Read by the extensions plugin when the main config is made, just below.
  process.env.THOREMIN_EXTENSIONS = DAW_MANIFEST;
  const base = (typeof baseConfig === 'function' ? baseConfig(env) : baseConfig) as UserConfig;
  return mergeConfig(base, {
    base: process.env.VITE_PUBLIC_BASE || '/thoremin-daw/',
    plugins: [guideForExtensions(__dirname, readExtensionEntries(path.resolve(__dirname, DAW_MANIFEST)).map((e) => e.id)), dawHead()],
    build: { outDir: DAW_OUT_DIR },
  } satisfies UserConfig);
});
