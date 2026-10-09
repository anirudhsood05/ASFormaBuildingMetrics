import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [preact()],
	// Relative asset paths so the build works from any sub-path,
	// e.g. https://<user>.github.io/ASFormaBuildingMetrics/
	base: './',
});
