// Regression: the isolated-runtime launchers handed ECHO the Steam AppId of
// ECHO Playtest (5105150) instead of ECHO's own (5105090), overriding the value
// Steam passes when it starts the launcher. The Manager reads 5105090 from
// appmanifest_5105090.acf.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ECHO_APP_ID = '5105090';
const PLAYTEST_APP_ID = '5105150';

test('launchers and the loader status use ECHO\'s Steam AppId, not Playtest\'s', () => {
  assert.match(read('ShinawaseLoader/modded-host.cs'), new RegExp(`private const string SteamAppId = "${ECHO_APP_ID}";`));
  assert.match(read('ShinawaseLoader/echo-modded-host.mjs'), new RegExp(`const steamAppId = '${ECHO_APP_ID}';`));
  assert.match(read('ShinawaseLoader/ShinawaseLoader.mjs'), new RegExp(`const echoSteamAppId = '${ECHO_APP_ID}';`));
  for (const path of ['ShinawaseLoader/echo-modded-host.mjs', 'ShinawaseLoader/ShinawaseLoader.mjs']) {
    assert.doesNotMatch(read(path).replace(/\/\/.*$/gmu, ''), new RegExp(PLAYTEST_APP_ID), `${path} still uses the Playtest AppId`);
  }
});
