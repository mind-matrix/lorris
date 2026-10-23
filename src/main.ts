import { mount } from 'svelte';
import { setupServiceWorker } from './pwa/register';
import { setInGameBotFactory } from './ai';
import { WorkerBot } from './ai/worker/WorkerBot';
import App from './ui/App.svelte';
import './ui/theme.css';

// Cache the app for offline use; new versions are offered with an "Update available" banner.
setupServiceWorker();

// Bots think in a Web Worker so the table never freezes.
if (typeof Worker !== 'undefined') setInGameBotFactory((seed) => new WorkerBot(seed));

const app = mount(App, { target: document.getElementById('app')! });

export default app;
