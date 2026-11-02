// Adapté du modèle officiel windycom/windy-plugin-template (licence ISC).
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import serve from 'rollup-plugin-serve';
import rollupSvelte from 'rollup-plugin-svelte';
import rollupSwc from 'rollup-plugin-swc3';
import sveltePreprocess from 'svelte-preprocess';
import { transformCodeToESMPlugin, keyPEM, certificatePEM } from '@windycom/plugin-devtools';

const sourceDirectory = process.env.RHUM_SOURCE_DIR || 'src';
const outputDirectory = process.env.RHUM_OUTPUT_DIR || 'dist';

export default {
    input: `${sourceDirectory}/plugin.svelte`,
    output: [
        { file: `${outputDirectory}/plugin.js`, format: 'module', sourcemap: true },
        { file: `${outputDirectory}/plugin.min.js`, format: 'module', plugins: [terser()] }
    ],
    external: id => id.startsWith('@windy/'),
    watch: { include: [`${sourceDirectory}/**`], exclude: 'node_modules/**', clearScreen: false },
    plugins: [
        rollupSvelte({ emitCss: false, preprocess: sveltePreprocess({ sourceMap: true }) }),
        rollupSwc({ include: ['**/*.ts', '**/*.svelte'], sourceMaps: true }),
        resolve({ browser: true, mainFields: ['module', 'jsnext:main', 'main'], preferBuiltins: false, dedupe: ['svelte'] }),
        commonjs(),
        transformCodeToESMPlugin(),
        process.env.SERVE !== 'false' && serve({
            contentBase: outputDirectory, host: 'localhost', port: 9999,
            headers: { 'Access-Control-Allow-Origin': '*' },
            https: { key: keyPEM, cert: certificatePEM }
        })
    ]
};
