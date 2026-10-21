import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './ui/App.svelte';
import './ui/theme.css';

// Cache the app for offline use and update it silently when a new version is deployed.
registerSW({ immediate: true });

const app = mount(App, { target: document.getElementById('app')! });

export default app;
