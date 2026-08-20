import { defineConfig } from 'vitest/config';

// The domain layer is pure TypeScript with zero Expo/React Native imports, so it runs in
// plain Node with no native mocks. Anything that needs a device belongs in src/sources,
// src/notifications or src/export and is verified on hardware instead — see the plan.
//
// The npm scripts pin TZ=Europe/London. Every date here is local-calendar arithmetic, so
// the machine's timezone is an input to the tests: run them in São Paulo (no DST since
// 2019) and the daylight-saving cases pass without ever crossing a transition. London has
// two transitions a year, which makes those tests test something.
export default defineConfig({
  test: {
    // src/db is included for the pure row<->domain mappers only. Everything in src/db that
    // touches expo-sqlite lives in client.ts / people.ts and is verified on a device; the
    // mappers deliberately import neither, which is what keeps them testable here.
    //
    // src/sources is included on the same terms. An adapter that imports Expo only as a
    // *type* is erased at runtime and runs here happily — map-contact.ts is the reason the
    // iOS/Android birthday fork is testable on a machine that is neither. Anything in
    // src/sources with a runtime Expo/React Native import (contacts.ts) has no test file
    // and is verified on hardware; that is deliberate, not an omission.
    include: ['src/domain/**/*.test.ts', 'src/db/**/*.test.ts', 'src/sources/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': new URL('./src/', import.meta.url).pathname },
  },
});
