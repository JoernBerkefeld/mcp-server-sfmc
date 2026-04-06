/**
 * eslint.config.mjs — SFMC project ESLint configuration
 *
 * Copy this file to your project root to enable eslint-plugin-sfmc rules
 * for AMPscript (.amp, .ampscript) and SSJS (.ssjs) files.
 *
 * Usage:
 *   npm install --save-dev eslint eslint-plugin-sfmc
 *   npx eslint .
 */

import sfmc from 'eslint-plugin-sfmc';

export default [
    // eslint-plugin-sfmc recommended rules for .amp, .ampscript, .ssjs, and .html files
    ...sfmc.configs.recommended,

    // Optional: customise rules for your project
    {
        rules: {
            // Increase the maximum number of problems reported per file
            // 'sfmc/max-problems': ['warn', { max: 200 }],
        },
    },
];
