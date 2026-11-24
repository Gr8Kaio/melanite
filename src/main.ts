import './app/ui/dom';
import 'katex/dist/katex.min.css';
import './app/theme/app.css';
import { registerSW } from 'virtual:pwa-register';
import { MelaniteDB } from './core/db';
import { Vault } from './core/vault';
import { App } from './app/app';
import { WELCOME_NOTE } from './app/welcome';

async function main() {
  const db = new MelaniteDB();
  const vault = await Vault.open(db);
  if (!(await db.kv.get('welcomed'))) {
    if (!vault.getMarkdownFiles().length) await vault.create('Welcome.md', WELCOME_NOTE);
    await db.kv.put({ key: 'welcomed', value: true });
  }
  const app = new App(vault);
  (window as unknown as { app: App }).app = app;
  await app.start(document.body);
  void navigator.storage?.persist?.();
}

main().catch((err) => {
  console.error(err);
  document.body.textContent = `Melanite could not start: ${(err as Error).message}`;
});

registerSW({ immediate: true });
