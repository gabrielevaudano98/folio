// Electron fuses, per platform (electron-builder's own `electronFuses` option cannot differ by platform).
// RunAsNode is off everywhere except Windows: a GUI-subsystem Electron exe does not receive stdin from its
// parent, so the MCP stdio bridge cannot run inside it there and still needs ELECTRON_RUN_AS_NODE.
exports.default = async function afterPack(context) {
  const { FuseVersion, FuseV1Options } = await import('@electron/fuses');
  await context.packager.addElectronFuses(context, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: context.electronPlatformName === 'win32',
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
