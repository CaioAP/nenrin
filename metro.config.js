const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Drizzle emits migrations as .sql files that ./drizzle/migrations.js imports directly.
// Metro does not resolve .sql out of the box, so the bundle fails without this line.
config.resolver.sourceExts.push('sql');

module.exports = config;
