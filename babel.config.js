module.exports = (api) => {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
    // Drizzle's generated ./drizzle/migrations.js imports each migration as `.sql`. Metro is
    // told to resolve the extension (see metro.config.js), which means it then hands the file
    // to Babel as source — and Babel tries to parse `CREATE TABLE` as JavaScript. This plugin
    // inlines the file as a string instead. Both halves are required; either alone fails.
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
