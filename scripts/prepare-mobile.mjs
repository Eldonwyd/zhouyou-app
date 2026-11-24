import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceSvgPath = path.join(webRoot, 'electron', 'resources', 'icon.svg');
const platform = process.argv[2] || 'all';

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** 从源 SVG 拆出满幅背景、纯前景图案与满幅合图，避免 Android/iOS 自适应遮罩露出白边。 */
async function loadIconVariants() {
  const raw = await readFile(sourceSvgPath, 'utf8');
  const fullBleedCombined = raw
    .replace('<g clip-path="url(#iconClip)">', '<g>')
    .replace('<rect x="44" y="44" width="936" height="936" rx="224" fill="url(#bg)"/>', '<rect x="0" y="0" width="1024" height="1024" fill="url(#bg)"/>');
  const mapMarker = '  <!-- Folded Paper Map Card -->';
  const mapIndex = fullBleedCombined.indexOf(mapMarker);
  if (mapIndex === -1) throw new Error('icon.svg structure changed: missing map marker');
  const fullBleedBackground = `${fullBleedCombined.slice(0, mapIndex)}</svg>`;
  const bgStart = raw.indexOf('  <!-- Rounded App Icon Background -->');
  const foregroundOnly = bgStart !== -1 && mapIndex !== -1
    ? `${raw.slice(0, bgStart)}${raw.slice(raw.indexOf(mapMarker))}`
    : raw;
  return {
    fullBleedCombined: Buffer.from(fullBleedCombined, 'utf8'),
    fullBleedBackground: Buffer.from(fullBleedBackground, 'utf8'),
    foregroundOnly: Buffer.from(foregroundOnly, 'utf8'),
  };
}

async function renderSvgIcon(svgBuffer, size, targetPath, { flatten = false, roundMask = false } = {}) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  let pipeline = sharp(svgBuffer, { density: 300 }).resize(size, size, { fit: 'cover' });
  if (flatten) pipeline = pipeline.flatten({ background: { r: 242, g: 107, b: 91 } });
  if (roundMask) {
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
    );
    pipeline = pipeline.composite([{ input: mask, blend: 'dest-in' }]);
  }
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
    'android.permission.REQUEST_INSTALL_PACKAGES',
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

  // 4. Generate borderless full-bleed adaptive & legacy launcher icons across all Android densities
  const icons = await loadIconVariants();
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
    await renderSvgIcon(icons.fullBleedCombined, legacySize, path.join(dir, 'ic_launcher.png'), { flatten: true });
    await renderSvgIcon(icons.fullBleedCombined, legacySize, path.join(dir, 'ic_launcher_round.png'), { roundMask: true });
    await renderSvgIcon(icons.fullBleedBackground, fgSize, path.join(dir, 'ic_launcher_background.png'), { flatten: true });
    // 自适应图标可视区域约占 72/108，安全区约 66/108；纯前景图层按 70% 居中，既饱满又不被圆形/圆角裁切。
    const inner = Math.round(fgSize * 0.7);
    const pad = Math.floor((fgSize - inner) / 2);
    const innerBuf = await sharp(icons.foregroundOnly, { density: 300 })
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    await sharp({
      create: { width: fgSize, height: fgSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: innerBuf, left: pad, top: pad }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }

  // 将自适应图标背景指向满幅渐变图层，并把兜底背景色从纯白改为品牌暖珊瑚色，彻底杜绝白边。
  const anydpiDir = path.join(resDir, 'mipmap-anydpi-v26');
  await mkdir(anydpiDir, { recursive: true });
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`;
  await writeFile(path.join(anydpiDir, 'ic_launcher.xml'), adaptiveXml, 'utf8');
  await writeFile(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptiveXml, 'utf8');

  const bgColorXmlPath = path.join(resDir, 'values', 'ic_launcher_background.xml');
  await mkdir(path.dirname(bgColorXmlPath), { recursive: true });
  await writeFile(
    bgColorXmlPath,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#F26B5B</color>\n</resources>\n`,
    'utf8',
  );

  // 5. Inject native AppUpdater Capacitor plugin (in-app APK download with progress + FileProvider install)
  const javaPkgDir = path.join(androidDir, 'app', 'src', 'main', 'java', 'app', 'zhouyou', 'map');
  await mkdir(javaPkgDir, { recursive: true });

  const mainActivityJava = `package app.zhouyou.map;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`;
  await writeFile(path.join(javaPkgDir, 'MainActivity.java'), mainActivityJava, 'utf8');

  const appUpdaterJava = `package app.zhouyou.map;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String APK_FILE_NAME = "zhouyou-update.apk";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private final AtomicBoolean downloading = new AtomicBoolean(false);

    private boolean isTrustedUpdateUrl(String rawUrl) {
        try {
            URL url = new URL(rawUrl);
            if (!"https".equalsIgnoreCase(url.getProtocol())) return false;
            String host = url.getHost().toLowerCase(Locale.US);
            if ("github.com".equals(host)) {
                return url.getPath().toLowerCase(Locale.US).startsWith("/eldonwyd/zhouyou-app/");
            }
            return "objects.githubusercontent.com".equals(host)
                || "release-assets.githubusercontent.com".equals(host)
                || "github-releases.githubusercontent.com".equals(host);
        } catch (Exception e) {
            return false;
        }
    }

    private void emitProgress(String state, int percent, long received, long total, String error) {
        JSObject data = new JSObject();
        data.put("state", state);
        data.put("percent", percent);
        data.put("receivedBytes", received);
        data.put("totalBytes", total);
        if (error != null && !error.isEmpty()) data.put("error", error);
        notifyListeners("updateProgress", data);
    }

    private void launchApkInstaller(File apkFile) {
        Context context = getContext();
        Uri apkUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apkFile);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        context.startActivity(intent);
    }

    @PluginMethod
    public void getVersionInfo(PluginCall call) {
        try {
            Context context = getContext();
            PackageManager pm = context.getPackageManager();
            PackageInfo info = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? pm.getPackageInfo(context.getPackageName(), PackageManager.PackageInfoFlags.of(0))
                : pm.getPackageInfo(context.getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionName", info.versionName != null ? info.versionName : "1.0.0");
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            result.put("versionCode", code);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("无法读取应用版本信息", e);
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelled.set(true);
        call.resolve();
    }

    @PluginMethod
    public void openDownloadedApk(PluginCall call) {
        try {
            File apkFile = new File(getContext().getCacheDir(), APK_FILE_NAME);
            if (!apkFile.exists() || apkFile.length() == 0) {
                call.reject("未找到已下载的安装包，请重新下载");
                return;
            }
            launchApkInstaller(apkFile);
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("无法打开系统安装器：" + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url", "");
        if (rawUrl == null || !isTrustedUpdateUrl(rawUrl)) {
            call.reject("无效的更新包下载地址");
            return;
        }
        if (!downloading.compareAndSet(false, true)) {
            call.reject("正在下载更新中，请稍候");
            return;
        }
        cancelled.set(false);

        executor.execute(() -> {
            File apkFile = new File(getContext().getCacheDir(), APK_FILE_NAME);
            File tempFile = new File(getContext().getCacheDir(), APK_FILE_NAME + ".part");
            HttpURLConnection conn = null;
            try {
                emitProgress("downloading", 0, 0, 0, null);
                String currentUrl = rawUrl;
                int status = 0;
                for (int hop = 0; hop < 6; hop++) {
                    if (cancelled.get()) break;
                    URL target = new URL(currentUrl);
                    conn = (HttpURLConnection) target.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(25000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("User-Agent", "Zhouyou-Map-Android");
                    status = conn.getResponseCode();
                    if (status == HttpURLConnection.HTTP_MOVED_PERM
                        || status == HttpURLConnection.HTTP_MOVED_TEMP
                        || status == HttpURLConnection.HTTP_SEE_OTHER
                        || status == 307
                        || status == 308) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        conn = null;
                        if (loc == null || loc.isEmpty()) {
                            throw new Exception("重定向缺少目标地址");
                        }
                        currentUrl = new URL(target, loc).toString();
                        continue;
                    }
                    break;
                }

                if (cancelled.get()) {
                    emitProgress("cancelled", 0, 0, 0, null);
                    JSObject res = new JSObject();
                    res.put("ok", false);
                    res.put("cancelled", true);
                    call.resolve(res);
                    return;
                }

                if (conn == null || status < 200 || status >= 300) {
                    throw new Exception("下载失败（HTTP " + status + "）");
                }

                long totalBytes = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
                    ? conn.getContentLengthLong()
                    : conn.getContentLength();
                long receivedBytes = 0;
                long lastEmit = 0;

                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(tempFile)) {
                    byte[] buffer = new byte[16384];
                    int len;
                    while ((len = in.read(buffer)) != -1) {
                        if (cancelled.get()) {
                            break;
                        }
                        out.write(buffer, 0, len);
                        receivedBytes += len;
                        long now = System.currentTimeMillis();
                        if (now - lastEmit >= 150 || (totalBytes > 0 && receivedBytes >= totalBytes)) {
                            lastEmit = now;
                            int pct = totalBytes > 0 ? (int) Math.min(99, (receivedBytes * 100L) / totalBytes) : 0;
                            emitProgress("downloading", pct, receivedBytes, totalBytes, null);
                        }
                    }
                    out.flush();
                }

                if (cancelled.get()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempFile.delete();
                    emitProgress("cancelled", 0, 0, 0, null);
                    JSObject res = new JSObject();
                    res.put("ok", false);
                    res.put("cancelled", true);
                    call.resolve(res);
                    return;
                }

                if (apkFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    apkFile.delete();
                }
                if (!tempFile.renameTo(apkFile)) {
                    throw new Exception("保存安装包失败");
                }

                emitProgress("installing", 100, receivedBytes, totalBytes > 0 ? totalBytes : receivedBytes, null);
                launchApkInstaller(apkFile);

                JSObject res = new JSObject();
                res.put("ok", true);
                call.resolve(res);
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();
                String msg = e.getMessage() != null ? e.getMessage() : "下载更新失败";
                emitProgress("error", 0, 0, 0, msg);
                call.reject(msg, e);
            } finally {
                if (conn != null) conn.disconnect();
                downloading.set(false);
            }
        });
    }
}
`;
  await writeFile(path.join(javaPkgDir, 'AppUpdaterPlugin.java'), appUpdaterJava, 'utf8');

  process.stdout.write('Patched Android project (Manifest, borderless adaptive icons, AppUpdater plugin, version) successfully.\n');
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

  // 2. Write 1024x1024 full-bleed opaque AppIcon PNG required by iOS
  const iconSetDir = path.join(iosDir, 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
  if (await exists(iconSetDir)) {
    const icons = await loadIconVariants();
    await renderSvgIcon(icons.fullBleedCombined, 1024, path.join(iconSetDir, 'AppIcon-512@2x.png'), { flatten: true });
  }

  process.stdout.write('Patched iOS project (Info.plist, AppIcon, version) successfully.\n');
}

if (platform === 'android' || platform === 'all') await patchAndroid();
if (platform === 'ios' || platform === 'all') await patchIos();
