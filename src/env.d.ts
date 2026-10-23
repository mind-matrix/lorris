/** Injected by Vite from package.json. */
declare const __APP_VERSION__: string;
/** Short commit SHA of the build (CI), or "dev". Injected by Vite. */
declare const __BUILD_ID__: string;

/** Build-time relay settings (see .env.example). All optional. */
interface ImportMetaEnv {
  readonly VITE_METERED_APP?: string;
  readonly VITE_METERED_API_KEY?: string;
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}
