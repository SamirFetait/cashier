"use strict";

const path = require("path");
const fs = require("fs");
const rcedit = require("rcedit");

/**
 * Stamp the Windows app exe with the icon and version details.
 *
 * electron-builder's built-in exe editing (win.signAndEditExecutable) goes
 * through its winCodeSign toolchain, whose archive holds macOS symlinks that
 * fail to unpack on Windows without admin rights ("A required privilege is not
 * held by the client"). The app is unsigned, so that option stays off and the
 * icon and metadata are applied here with rcedit, which needs neither.
 *
 * Runs after the app is packed into win-unpacked and before the installer is
 * assembled, so the installer, shortcuts, taskbar and Task Manager all show
 * the app's own name and icon instead of Electron's.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const appInfo = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  if (!fs.existsSync(exePath)) {
    throw new Error(`afterPack: app exe not found for icon stamping: ${exePath}`);
  }

  const iconPath = path.join(context.packager.projectDir, "build", "icon.ico");
  const version = appInfo.version;
  const company = appInfo.companyName || "Samir Fetait";

  await rcedit(exePath, {
    icon: iconPath,
    "file-version": version,
    "product-version": version,
    "version-string": {
      ProductName: appInfo.productName,
      FileDescription: appInfo.productName,
      CompanyName: company,
      LegalCopyright: `Copyright © ${new Date().getFullYear()} ${company}`,
      OriginalFilename: `${appInfo.productFilename}.exe`,
      InternalName: appInfo.productFilename,
    },
  });

  console.log(`[afterPack] stamped icon + metadata on ${exePath}`);
};
