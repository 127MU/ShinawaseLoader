/// <reference path="../.echo-sdk/echo-workshop-plugin.d.ts" />
// Background runtime: everything visible lives in panel.html. These commands
// make the page reachable from ECHO's plug-in dock and command search.

echo.commands.register('open', { title: 'Open ShinawaseLoader' }, async () => {
  await echo.ui.openPanel('main');
  return null;
});

echo.commands.register('restart-with-mods', { title: 'Restart ECHO with Mods' }, async () => {
  try {
    const state = await echo.trusted.invoke('status');
    if (state.modded) {
      await echo.ui.notify('ECHO is already running with ShinawaseLoader.');
      return state;
    }
    return await echo.trusted.invoke('restart', { force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The SDK's offline mock host verifies the bridge but never runs trusted.mjs.
    if (message.includes('mock host does not execute full-trust code')) {
      await echo.ui.notify('Manifest and bridge verified. Run this command inside ECHO to restart with Mods.');
      return { mockOnly: true };
    }
    await echo.ui.notify(`ShinawaseLoader: ${message}`);
    throw error;
  }
});
