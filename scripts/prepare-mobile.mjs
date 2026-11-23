import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceIcon = path.join(webRoot, 'electron', 'resources', 'icon.png');
const platform = process.argv[2] || 'all';

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function renderIcon(size, targetPath, { flatten = false } = {}) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  let pipeline = sharp(sourceIcon).resize(size, size, { fit: 'cover' });
  if (flatten) pipeline = pipeline.flatten({ background: { r: 242, g: 107, b: 91 } });
  await pipeline.png({ compressionLevel: 9 }).toFile(targetPath);
}

async function patchAndroid() {
  const androidDir = path.join(webRoot, 'android');
  if (!(await exists(androidDir))) {
    process.stdout.write('Android project directory not found, skipping Android patch.\n');
    return;
  }

  // 1. Patch AndroidManifest.xml for LAN AI server cleartext HTTP + microphone recording
  const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  let manifest = await readFile(manifestPath, 'utf8');
  if (!manifest.includes('android:usesCleartextTraffic')) {
    manifest = manifest.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
  }
  const permissions = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.RECORD_AUDIO',
  ];
  for (const perm of permissions) {
    if (!manifest.includes(perm)) {
      manifest = manifest.replace('</manifest>', `    <uses-permission android:name="${perm}" />\n</manifest>`);
    }
  }
  await writeFile(manifestPath, manifest, 'utf8');

  // 2. Patch strings.xml display name to 周游地图
  const stringsPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  if (await exists(stringsPath)) {
    let strings = await readFile(stringsPath, 'utf8');
    strings = strings.replace(/<string name="app_name">.*?<\/string>/, '<string name="app_name">周游地图</string>');
    strings = strings.replace(/<string name="title_activity_main">.*?<\/string>/, '<string name="title_activity_main">周游地图</string>');
    await writeFile(stringsPath, strings, 'utf8');
  }

  // 3. Patch build.gradle versionName / versionCode from package.json
  const pkg = JSON.parse(await readFile(path.join(webRoot, 'package.json'), 'utf8'));
  const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
  if (await exists(appGradlePath)) {
    let gradle = await readFile(appGradlePath, 'utf8');
    const [major = 1, minor = 0, patch = 0] = String(pkg.version || '1.0.0').split('.').map((n) => Number.parseInt(n, 10) || 0);
    const versionCode = major * 10000 + minor * 100 + patch;
    gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
    gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${pkg.version || '1.0.0'}"`);
    await writeFile(appGradlePath, gradle, 'utf8');
  }

  // 4. Generate launcher icons across all Android mipmap densities
  const resDir = path.join(androidDir, 'app', 'src', 'main', 'res');
  const densities = [
    ['mipmap-mdpi', 48, 108],
    ['mipmap-hdpi', 72, 162],
    ['mipmap-xhdpi', 96, 216],
    ['mipmap-xxhdpi', 144, 324],
    ['mipmap-xxxhdpi', 192, 432],
  ];
  for (const [folder, legacySize, fgSize] of densities) {
    const dir = path.join(resDir, folder);
    await renderIcon(legacySize, path.join(dir, 'ic_launcher.png'));
    await renderIcon(legacySize, path.join(dir, 'ic_launcher_round.png'));
    const inner = Math.round(fgSize * 0.66);
    const pad = Math.floor((fgSize - inner) / 2);
    const innerBuf = await sharp(sourceIcon).resize(inner, inner).png().toBuffer();
    await sharp({
      create: { width: fgSize, height: fgSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: innerBuf, left: pad, top: pad }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }

  process.stdout.write('Patched Android project (Manifest, icons, version) successfully.\n');
}

async function patchIos() {
  const iosDir = path.join(webRoot, 'ios');
  if (!(await exists(iosDir))) {
    process.stdout.write('iOS project directory not found, skipping iOS patch.\n');
    return;
  }

  // 1. Patch Info.plist for microphone, photo library, and local LAN networking
  const plistPath = path.join(iosDir, 'App', 'App', 'Info.plist');
  if (await exists(plistPath)) {
    let plist = await readFile(plistPath, 'utf8');
    const pkg = JSON.parse(await readFile(path.join(webRoot, 'package.json'), 'utf8'));
    plist = plist.replace(
      /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/,
      `$1${pkg.version || '1.0.0'}$2`,
    );
    const additions = [
      ['NSMicrophoneUsageDescription', '用于在旅行手账中录制旅途语音备忘。'],
      ['NSPhotoLibraryUsageDescription', '用于在旅行手账和行程导入中选择旅行照片与票据截图。'],
      ['NSPhotoLibraryAddUsageDescription', '用于将旅行成就海报与照片保存到系统相册。'],
    ];
    for (const [key, value] of additions) {
      if (!plist.includes(`<key>${key}</key>`)) {
        plist = plist.replace(
          '</dict>\n</plist>',
          `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>\n</plist>`,
        );
      }
    }
    if (!plist.includes('<key>NSAppTransportSecurity</key>')) {
      const ats = `\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsLocalNetworking</key>\n\t\t<true/>\n\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>\n\t</dict>\n`;
      plist = plist.replace('</dict>\n</plist>', `${ats}</dict>\n</plist>`);
    }
    await writeFile(plistPath, plist, 'utf8');
  }

  // 2. Write 1024x1024 opaque AppIcon PNG required by iOS
  const iconSetDir = path.join(iosDir, 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
  if (await exists(iconSetDir)) {
    await renderIcon(1024, path.join(iconSetDir, 'AppIcon-512@2x.png'), { flatten: true });
  }

  process.stdout.write('Patched iOS project (Info.plist, AppIcon, version) successfully.\n');
}

if (platform === 'android' || platform === 'all') await patchAndroid();
if (platform === 'ios' || platform === 'all') await patchIos();
