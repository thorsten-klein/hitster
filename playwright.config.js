// @ts-check
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    testDir: './tests',
    timeout: 15_000,
    expect: { timeout: 5_000 },
    fullyParallel: false,     // tests share localStorage state in the same browser context
    retries: 0,
    reporter: 'list',
    use: {
        // Open the local HTML file directly — no server needed
        baseURL: 'file://' + path.resolve(__dirname, 'index.html'),
        headless: true,
        viewport: { width: 1400, height: 900 },
        actionTimeout: 8_000,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], channel: 'chrome' } // use system Chrome (no download needed)
        },
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] }
        },
        // TODO: webkit is slow and instable
        // {
        //     name: 'webkit',
        //     use: { ...devices['Desktop Safari'] }
        // },
    ],
    // Snapshot dir for visual regression baselines
    snapshotDir: './tests/snapshots',
});
