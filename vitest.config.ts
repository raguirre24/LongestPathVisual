import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        include: ['tests/**/*.test.ts'],
        environment: 'node',
    },
    resolve: {
        alias: {
            'powerbi-visuals-api': './node_modules/powerbi-visuals-api',
        },
    },
});
