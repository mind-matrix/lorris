/** "0.0.1 (abc1234)": the package version plus the build, so every deploy is distinguishable. */
export const APP_VERSION_LABEL = `${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'} (${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'})`;
