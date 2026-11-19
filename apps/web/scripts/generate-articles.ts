import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, context, type BuildOptions } from 'esbuild';

// The renderer runs in Node at build time. Only the resulting Markdown goes to the Worker.
export async function generateArticles(watch: boolean) {
  const directory = resolve('.generated');
  const target = resolve(directory, 'public-articles.json');
  const options: BuildOptions = {
    entryPoints: ['scripts/render-public-articles.ts'],
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
    external: ['next', 'react', 'react-dom'],
    plugins: [{
      name: 'emit-public-articles',
      setup(builder) {
        builder.onEnd((result) => {
          if (result.errors.length || !result.outputFiles) return;
          const json = execFileSync(process.execPath, ['-'], { input: result.outputFiles[0].contents, encoding: 'utf8' });
          if (existsSync(target) && readFileSync(target, 'utf8') === json) return;
          mkdirSync(directory, { recursive: true });
          const temporary = target + '.' + process.pid;
          writeFileSync(temporary, json);
          renameSync(temporary, target);
        });
      },
    }],
  };
  if (watch) {
    const compiler = await context(options);
    await compiler.rebuild();
    await compiler.watch();
  } else {
    await build(options);
  }
}
