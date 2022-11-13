import hash from 'hash.js';
import fs from 'node:fs';
import type { OutputAsset, OutputChunk, OutputPlugin } from 'rollup';

interface ImportmapPluginOptions {
  base: string;
  external: boolean;
  indexHtml: string;
}

interface ImportMap {
  imports: {
    [importName in string]?: string;
  };
}

function createImportMapAsset (importMap: ImportMap): OutputAsset {
  const source = JSON.stringify(importMap);
  const hashValue = hash.sha1().update(source).digest('hex');

  return {
    type: 'asset',
    name: 'importMap',
    fileName: `import-map.${hashValue}.importmap`,
    source,
  };
}

function createSystemJsChunk (): OutputChunk {
  const systemJsCode = fs.readFileSync(require.resolve('systemjs/dist/s.js'), 'utf8');
  const systemJsHash = hash.sha1().update(systemJsCode).digest('hex');

  return {
    fileName: `s.${systemJsHash}.js`,
    code: systemJsCode,
    name: 'systemJs',
    type: 'chunk',
    imports: [],
    exports: [],
    map: null,
    dynamicImports: [],
    facadeModuleId: null,
    isEntry: false,
    implicitlyLoadedBefore: [],
    importedBindings: {},
    isDynamicEntry: false,
    modules: { },
    referencedFiles: [],
    isImplicitEntry: false,
    moduleIds: [],
  };
}

function createImportMapScript (importMapAsset: OutputAsset, systemJs: boolean, external?: boolean): string {
  const importMapSource = String(importMapAsset.source);
  const type = systemJs ? 'systemjs-importmap' : 'importmap';

  return external
    ? `<script type="${type}" src="/${importMapAsset.fileName}"></script>`
    : `<script type="${type}">${importMapSource}</script>`;
}

export default function ImportmapPlugin ({
  base,
  external = false,
  indexHtml = 'index.html',
}: ImportmapPluginOptions): OutputPlugin {
  const importMap: ImportMap = { imports: {} };

  return {
    name: 'importmap-plugin',
    renderStart (config) {
      if (config.format !== 'system' && config.format !== 'es') {
        this.error('This plugin supports only "system"/"systemjs" and "es"/"esm" formats.');
      }

      if (config.format === 'es' && external) {
        this.warn('Browsers don\'t support native external import maps. There might be a polyfill that you need to add on your own.');
      }

      if (typeof config.entryFileNames !== 'string') {
        this.error('output.entryFileNames must be a string.');
      } else if (config.entryFileNames.toLowerCase().includes('[hash]')) {
        this.warn('This plugin won\'t do its job if output.entryFileNames option contain hash.');
      }

      if (typeof config.chunkFileNames !== 'string') {
        this.error('output.chunkFileNames must be a string.');
      } else if (config.chunkFileNames.toLowerCase().includes('[hash]')) {
        this.warn('This plugin won\'t do its job if output.chunkFileNames option contain hash.');
      }
    },
    generateBundle (config, bundle) {
      importMap.imports = {};

      Object.entries(bundle).forEach(([filename, chunk]) => {
        if (chunk.type !== 'chunk') return;

        const hashValue = hash.sha1().update(chunk.code).digest('hex');

        importMap.imports[`${base}${filename}`] = `${base}${filename}`.replace(/\.js$/, `.${hashValue}.js`);
      });

      if (external) {
        bundle.importMap = createImportMapAsset(importMap);
      }

      if (config.format === 'system') {
        bundle.systemJs = createSystemJsChunk();
      }
    },
    writeBundle (config, bundle) {
      const { dir = './dist', entryFileNames } = config;
      const systemJs = config.format === 'system';
      const importMapAsset = (bundle.importMap as OutputAsset | undefined) ?? createImportMapAsset(importMap);
      const importMapScript = createImportMapScript(importMapAsset, systemJs, external);
      const entryFileName = `/${String(entryFileNames)}`;
      const entryDestinationFilename = importMap.imports[entryFileName];
      const indexPath = `${dir}/${indexHtml}`;

      if (!entryDestinationFilename) {
        throw new Error(`Missing import map entry for entry file: ${entryFileName}`);
      }

      Object.keys(importMap.imports).forEach(filename => {
        const destinationFilename = importMap.imports[filename];

        if (fs.existsSync(`${dir}${filename}`) && destinationFilename) {
          fs.renameSync(`${dir}${filename}`, `${dir}${destinationFilename}`);
        } else {
          this.warn(`Failed to rename ${dir}${filename} to ${dir}${destinationFilename ?? '<MISSING FILENAME>'}`);
        }
      });

      const indexHtmlContents = fs
        .readFileSync(indexPath, 'utf-8')
        .replace('</title>', systemJs ? `</title>\n<script src="${base}${bundle.systemJs.fileName}"></script>\n${importMapScript}` : `</title>\n${importMapScript}`)
        .replace('type="module"', systemJs ? 'type="systemjs-module"' : 'type="module"')
        .replace(`src="${entryFileName}"`, `src="${entryDestinationFilename}"`);

      fs.writeFileSync(indexPath, indexHtmlContents);
    },
  };
}
