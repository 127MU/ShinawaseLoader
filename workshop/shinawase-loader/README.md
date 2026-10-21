# ShinawaseLoader — ECHO Workshop item

This directory is the ECHO Workshop project that distributes ShinawaseLoader
through ECHO's Steam Workshop as a `plugin-package` with a full-trust
(`system:full`) module. The Workshop cannot inject Mods itself: ECHO's sandbox
has no DOM access and the trusted module runs in a separate utility process.
The item is therefore a bootstrapper for the regular Loader:

1. The subscriber enables the item and approves full system access.
2. `src/trusted.mjs` installs `content/assets/loader` into
   `<ECHO_ROOT>/ShinawaseLoader` with `ShinawaseLoader/workshop-bootstrap.mjs`,
   imports the bundled packages, records `nodeRuntime: "echo"` and builds the
   isolated runtime. It never replaces a newer Loader, the user's config,
   state, logs or isolated runtime, and never downgrades an installed Mod.
3. The page (`src/panel.*`, placement `page`) restarts ECHO into the isolated
   runtime through `ShinawaseLoader/echo-modded-host.mjs --wait-pid`, either
   right away or after the user quits ECHO. An opt-in toggle switches on every
   stock start and pauses itself after a switch that did not arrive.

The Loader runs on ECHO's own executable in Node mode (Electron's RunAsNode
fuse), so the item ships no `node.exe`. ECHO's Workshop validation rejects
`.exe`, `.dll`, `.node`, `.ps1`, `.cmd` and similar files; the build leaves
them out instead of repackaging them, so the Workshop edition has no
`ECHO.modded.exe` launcher, no native host addon and no Windows Manager. Run
the regular installer when those are needed; it adopts the same folder.

## Build

From the repository root, with dependencies installed (`npm --prefix ./ShinawaseLoader ci`):

```powershell
node ./scripts/build-workshop-item.mjs --sdk "<ECHO_ROOT>/resources/workshop-sdk"
```

`--sdk` runs the official SDK's `validate` on the result. `--without-streaming`
drops the streaming bridge, its npm dependencies and the Streaming package.
The output in `content/` is git-ignored. Open this folder in ECHO's Workshop
Authoring Studio to publish; nothing here uploads to Steam. `publishedFileId`
stays `0` until the first upload and `visibility` starts `private`.

The same build writes `dist/shinawase-workshop.zip` (the content files at the
zip root), the second edition of every release beside the external-injection
`ShinawaseLoader-<version>.zip`. Third-party npm packages are packed into
`assets/loader/node_modules.zip` because ECHO re-hashes every listed file each
time the trusted module is called; the bootstrap unpacks it into
`ShinawaseLoader/node_modules`.

## Installing it from setup

The Shinawase Manager (install option "Workshop") and
`setup-modloader.ps1 -Edition workshop` install this edition with
`ShinawaseLoader/workshop-setup.mjs`: they start the stock ECHO with a
temporary loopback debugging port, drop `shinawase-workshop.zip` on ECHO's own
Workshop page so ECHO verifies it and shows its own `system:full` prompt, wait
for the trusted module to install the Loader, and reopen ECHO in the Mods
runtime. Updates fetch the newest zip (signed mirror, then the GitHub release
asset) and repeat the import; ECHO asks for the approval again for each new
revision. Nothing in setup answers ECHO's prompt.
