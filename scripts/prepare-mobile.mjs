import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { computeMobileCompat } from './build-hot-update.mjs';

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

  // 1. Patch AndroidManifest.xml with minimal safe permissions and strict network_security_config
  // 仅保留最基础的网络权限，移除 RECORD_AUDIO 与高风险的 REQUEST_INSTALL_PACKAGES，降低安全软件误报。
  const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  let manifest = await readFile(manifestPath, 'utf8');
  manifest = manifest.replace(/\s*android:usesCleartextTraffic="true"/g, '');
  if (!manifest.includes('android:networkSecurityConfig')) {
    manifest = manifest.replace('<application', '<application\n        android:networkSecurityConfig="@xml/network_security_config"');
  }
  const permissions = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
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

  // 4.5. Write strict network_security_config.xml: HTTPS-only for external hosts, cleartext only for localhost/127.0.0.1
  const xmlDir = path.join(resDir, 'xml');
  await mkdir(xmlDir, { recursive: true });
  const networkSecurityXml = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
    </domain-config>
</network-security-config>
`;
  await writeFile(path.join(xmlDir, 'network_security_config.xml'), networkSecurityXml, 'utf8');

  // 5. Inject AppUpdater plugin (supports safe in-app frontend hot-update via Capacitor setServerBasePath + SHA-256 verification; never uses REQUEST_INSTALL_PACKAGES)
  const { mobileCompat } = await computeMobileCompat(webRoot);
  const javaPkgDir = path.join(androidDir, 'app', 'src', 'main', 'java', 'app', 'zhouyou', 'map');
  await mkdir(javaPkgDir, { recursive: true });

  const mainActivityJava = `package app.zhouyou.map;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(NativeAiBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`;
  await writeFile(path.join(javaPkgDir, 'MainActivity.java'), mainActivityJava, 'utf8');

  const appUpdaterJava = `package app.zhouyou.map;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String PREFS_NAME = "zhouyou_hot_update";
    private static final String KEY_ACTIVE_DIR = "active_dir";
    private static final String KEY_ACTIVE_VERSION = "active_version";
    private static final String KEY_ACTIVE_COMPAT = "active_compat";
    private static final String MOBILE_COMPAT = "${mobileCompat}";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private volatile HttpURLConnection activeConn = null;

    @Override
    public void load() {
        super.load();
        String activeDir = resolveValidHotUpdateDir();
        if (activeDir != null && getBridge() != null) {
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    if (getBridge() != null) {
                        getBridge().setServerBasePath(activeDir);
                    }
                } catch (Exception ignored) {
                    clearHotUpdatePrefs();
                }
            });
        }
    }

    private String getApkVersionName() {
        try {
            Context context = getContext();
            PackageManager pm = context.getPackageManager();
            PackageInfo info = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? pm.getPackageInfo(context.getPackageName(), PackageManager.PackageInfoFlags.of(0))
                : pm.getPackageInfo(context.getPackageName(), 0);
            return info.versionName != null ? info.versionName : "1.0.0";
        } catch (Exception e) {
            return "1.0.0";
        }
    }

    private long getApkVersionCode() {
        try {
            Context context = getContext();
            PackageManager pm = context.getPackageManager();
            PackageInfo info = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? pm.getPackageInfo(context.getPackageName(), PackageManager.PackageInfoFlags.of(0))
                : pm.getPackageInfo(context.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        } catch (Exception e) {
            return 1;
        }
    }

    private SharedPreferences getPrefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private void clearHotUpdatePrefs() {
        getPrefs().edit().clear().apply();
    }

    private static int compareSemver(String a, String b) {
        int[] pa = parseVersionParts(a);
        int[] pb = parseVersionParts(b);
        for (int i = 0; i < 3; i++) {
            if (pa[i] != pb[i]) return pa[i] > pb[i] ? 1 : -1;
        }
        return 0;
    }

    private static int[] parseVersionParts(String raw) {
        int[] out = new int[] { 0, 0, 0 };
        if (raw == null) return out;
        String clean = raw.trim().replaceFirst("^(?i)(?:mobile|desktop)-v?", "").replaceFirst("^(?i)v", "");
        int dash = clean.indexOf('-');
        if (dash >= 0) clean = clean.substring(0, dash);
        String[] parts = clean.split("\\\\.");
        for (int i = 0; i < Math.min(3, parts.length); i++) {
            try {
                out[i] = Integer.parseInt(parts[i].replaceAll("[^0-9]", ""));
            } catch (Exception ignored) {
                out[i] = 0;
            }
        }
        return out;
    }

    private String resolveValidHotUpdateDir() {
        SharedPreferences prefs = getPrefs();
        String dirPath = prefs.getString(KEY_ACTIVE_DIR, "");
        String ver = prefs.getString(KEY_ACTIVE_VERSION, "");
        String compat = prefs.getString(KEY_ACTIVE_COMPAT, "");
        if (dirPath == null || dirPath.isEmpty() || ver == null || ver.isEmpty()) return null;
        if (!MOBILE_COMPAT.equals(compat)) {
            clearHotUpdatePrefs();
            return null;
        }
        if (compareSemver(ver, getApkVersionName()) <= 0) {
            clearHotUpdatePrefs();
            return null;
        }
        File indexFile = new File(dirPath, "index.html");
        if (!indexFile.isFile()) {
            clearHotUpdatePrefs();
            return null;
        }
        return dirPath;
    }

    private static boolean isTrustedUrl(String rawUrl) {
        try {
            URI uri = new URI(rawUrl);
            if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.US);
            if ("github.com".equals(host)) {
                String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase(Locale.US);
                return path.startsWith("/eldonwyd/zhouyou-app/");
            }
            return "zhouyou.online".equals(host)
                || "www.zhouyou.online".equals(host)
                || "objects.githubusercontent.com".equals(host)
                || "release-assets.githubusercontent.com".equals(host)
                || "github-releases.githubusercontent.com".equals(host);
        } catch (Exception e) {
            return false;
        }
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b));
        }
        return sb.toString();
    }

    private static void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursive(child);
            }
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private void emitProgress(String state, int percent, long received, long total) {
        JSObject payload = new JSObject();
        payload.put("state", state);
        payload.put("percent", percent);
        payload.put("receivedBytes", received);
        payload.put("totalBytes", total);
        notifyListeners("updateProgress", payload);
    }

    @PluginMethod
    public void getVersionInfo(PluginCall call) {
        try {
            String apkVer = getApkVersionName();
            String validDir = resolveValidHotUpdateDir();
            String hotVer = validDir != null ? getPrefs().getString(KEY_ACTIVE_VERSION, "") : "";
            JSObject result = new JSObject();
            result.put("versionName", (hotVer != null && !hotVer.isEmpty()) ? hotVer : apkVer);
            result.put("versionCode", getApkVersionCode());
            result.put("shellVersion", apkVer);
            result.put("mobileCompat", MOBILE_COMPAT);
            result.put("hotUpdateVersion", hotVer != null ? hotVer : "");
            call.resolve(result);
        } catch (Exception e) {
            call.reject("无法读取应用版本信息", e);
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelled.set(true);
        HttpURLConnection conn = activeConn;
        if (conn != null) {
            try { conn.disconnect(); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    @PluginMethod
    public void applyHotUpdate(PluginCall call) {
        String primaryUrl = call.getString("url", "");
        String version = call.getString("version", "");
        String targetCompat = call.getString("mobileCompat", "");
        String expectedSha = call.getString("sha256", "");
        if (expectedSha != null) expectedSha = expectedSha.trim().toLowerCase(Locale.US);

        if (!MOBILE_COMPAT.equals(targetCompat)) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("error", "本次包含原生底层升级，请下载新版 APK 安装");
            call.resolve(res);
            return;
        }
        if (expectedSha == null || !expectedSha.matches("^[0-9a-f]{64}$")) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("error", "热更新校验指纹无效，已取消应用");
            call.resolve(res);
            return;
        }

        List<String> urls = new ArrayList<>();
        if (primaryUrl != null && isTrustedUrl(primaryUrl)) urls.add(primaryUrl);
        JSArray fallbackArr = call.getArray("fallbackUrls");
        if (fallbackArr != null) {
            for (int i = 0; i < fallbackArr.length(); i++) {
                String u = fallbackArr.optString(i, "");
                if (u != null && isTrustedUrl(u) && !urls.contains(u)) urls.add(u);
            }
        }
        if (urls.isEmpty()) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("error", "无效的热更新包下载地址");
            call.resolve(res);
            return;
        }

        final String finalExpectedSha = expectedSha;
        final String cleanVersion = version != null ? version.trim() : "";
        cancelled.set(false);

        executor.execute(() -> {
            File hotRoot = new File(getContext().getFilesDir(), "hot-updates");
            File tmpZip = new File(hotRoot, "tmp-" + System.currentTimeMillis() + ".zip");
            File targetDir = new File(hotRoot, "v" + cleanVersion + "-" + System.currentTimeMillis());
            try {
                if (!hotRoot.exists()) hotRoot.mkdirs();

                String actualSha = null;
                long downloadedBytes = 0;
                long totalBytes = 0;
                Exception lastErr = null;

                for (String candidateUrl : urls) {
                    if (cancelled.get()) break;
                    try {
                        HttpURLConnection conn = (HttpURLConnection) new URL(candidateUrl).openConnection();
                        conn.setInstanceFollowRedirects(true);
                        conn.setConnectTimeout(15000);
                        conn.setReadTimeout(30000);
                        conn.setRequestProperty("User-Agent", "ZhouyouMapAndroidUpdater/1.0");
                        activeConn = conn;

                        int code = conn.getResponseCode();
                        if (code < 200 || code >= 300) {
                            throw new Exception("HTTP " + code);
                        }
                        totalBytes = conn.getContentLengthLong();
                        downloadedBytes = 0;
                        MessageDigest md = MessageDigest.getInstance("SHA-256");
                        long lastEmit = 0;

                        try (InputStream in = new BufferedInputStream(conn.getInputStream());
                             FileOutputStream out = new FileOutputStream(tmpZip)) {
                            byte[] buf = new byte[16384];
                            int len;
                            while ((len = in.read(buf)) != -1) {
                                if (cancelled.get()) {
                                    throw new InterruptedException("cancelled");
                                }
                                out.write(buf, 0, len);
                                md.update(buf, 0, len);
                                downloadedBytes += len;
                                long now = System.currentTimeMillis();
                                if (now - lastEmit >= 150) {
                                    lastEmit = now;
                                    int pct = totalBytes > 0 ? (int) Math.min(99, (downloadedBytes * 100L) / totalBytes) : 0;
                                    emitProgress("downloading", pct, downloadedBytes, Math.max(0, totalBytes));
                                }
                            }
                        } finally {
                            conn.disconnect();
                            activeConn = null;
                        }
                        actualSha = bytesToHex(md.digest());
                        lastErr = null;
                        break;
                    } catch (Exception e) {
                        if (cancelled.get()) {
                            lastErr = e;
                            break;
                        }
                        lastErr = e;
                    }
                }

                if (cancelled.get()) {
                    deleteRecursive(tmpZip);
                    JSObject res = new JSObject();
                    res.put("ok", false);
                    res.put("cancelled", true);
                    call.resolve(res);
                    return;
                }
                if (actualSha == null) {
                    throw lastErr != null ? lastErr : new Exception("下载热更新包失败");
                }
                if (!finalExpectedSha.equals(actualSha)) {
                    throw new Exception("热更新包 SHA-256 校验未通过，已中止应用");
                }

                emitProgress("installing", 100, downloadedBytes, totalBytes > 0 ? totalBytes : downloadedBytes);

                if (!targetDir.exists()) targetDir.mkdirs();
                String destCanonical = targetDir.getCanonicalPath();
                try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(tmpZip)))) {
                    ZipEntry entry;
                    byte[] buf = new byte[16384];
                    while ((entry = zis.getNextEntry()) != null) {
                        String name = entry.getName().replace('\\\\', '/');
                        if (name.startsWith("/") || name.contains("..")) {
                            throw new Exception("热更新包包含非法路径");
                        }
                        File outFile = new File(targetDir, name);
                        String outCanonical = outFile.getCanonicalPath();
                        if (!outCanonical.equals(destCanonical) && !outCanonical.startsWith(destCanonical + File.separator)) {
                            throw new Exception("热更新包检测到越权路径");
                        }
                        if (entry.isDirectory() || name.endsWith("/")) {
                            outFile.mkdirs();
                        } else {
                            File parent = outFile.getParentFile();
                            if (parent != null && !parent.exists()) parent.mkdirs();
                            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                                int len;
                                while ((len = zis.read(buf)) != -1) {
                                    fos.write(buf, 0, len);
                                }
                            }
                        }
                        zis.closeEntry();
                    }
                }

                File indexFile = new File(targetDir, "index.html");
                if (!indexFile.isFile()) {
                    throw new Exception("热更新包缺少 index.html，已中止应用");
                }

                getPrefs().edit()
                    .putString(KEY_ACTIVE_DIR, targetDir.getAbsolutePath())
                    .putString(KEY_ACTIVE_VERSION, cleanVersion)
                    .putString(KEY_ACTIVE_COMPAT, MOBILE_COMPAT)
                    .apply();

                // 清理旧版本热更新目录
                File[] existing = hotRoot.listFiles();
                if (existing != null) {
                    for (File child : existing) {
                        if (child.isDirectory() && !child.getAbsolutePath().equals(targetDir.getAbsolutePath())) {
                            deleteRecursive(child);
                        }
                    }
                }

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("mode", "hot");
                res.put("version", cleanVersion);
                call.resolve(res);

                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (getBridge() != null) {
                        getBridge().setServerBasePath(targetDir.getAbsolutePath());
                    }
                }, 250);
            } catch (Exception e) {
                deleteRecursive(targetDir);
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("error", e.getMessage() != null ? e.getMessage() : "热更新失败");
                call.resolve(res);
            } finally {
                deleteRecursive(tmpZip);
            }
        });
    }
}
`;
  await writeFile(path.join(javaPkgDir, 'AppUpdaterPlugin.java'), appUpdaterJava, 'utf8');

  const nativeAiBridgeJava = `package app.zhouyou.map;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeAiBridge")
public class NativeAiBridgePlugin extends Plugin {
    private final ExecutorService httpPool = Executors.newCachedThreadPool();
    private final Object oauthLock = new Object();
    private ServerSocket oauthServer = null;

    @PluginMethod
    public void openExternalUrl(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String fallbackUrl = call.getString("fallbackUrl", "");
        boolean allowed = rawUrl != null && (
            rawUrl.startsWith("https://")
            || rawUrl.startsWith("http://")
            || rawUrl.startsWith("xhsdiscover://")
            || rawUrl.startsWith("androidamap://")
            || rawUrl.startsWith("amapuri://")
            || rawUrl.startsWith("baidumap://")
            || rawUrl.startsWith("comgooglemaps://")
            || rawUrl.startsWith("geo:")
        );
        if (!allowed) {
            call.reject("无效的网址");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(rawUrl));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject res = new JSObject();
            res.put("ok", true);
            call.resolve(res);
        } catch (Exception e) {
            if (fallbackUrl != null && (fallbackUrl.startsWith("https://") || fallbackUrl.startsWith("http://"))) {
                try {
                    Intent fallbackIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(fallbackUrl));
                    fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(fallbackIntent);
                    JSObject res = new JSObject();
                    res.put("ok", true);
                    res.put("fallback", true);
                    call.resolve(res);
                    return;
                } catch (Exception ignored) {
                    // fall through to reject
                }
            }
            call.reject("无法打开应用或浏览器：" + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void httpRequest(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String method = call.getString("method", "GET");
        JSObject headersObj = call.getObject("headers", new JSObject());
        String body = call.getString("body", null);
        int timeoutMs = call.getInt("timeoutMs", 90000);

        if (rawUrl == null || (!rawUrl.startsWith("https://") && !rawUrl.startsWith("http://"))) {
            call.reject("无效的请求地址");
            return;
        }

        httpPool.execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(rawUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod(method != null ? method.toUpperCase() : "GET");
                conn.setConnectTimeout(Math.min(30000, timeoutMs));
                conn.setReadTimeout(timeoutMs);
                conn.setInstanceFollowRedirects(true);

                if (headersObj != null) {
                    Iterator<String> keys = headersObj.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        String val = headersObj.getString(key);
                        if (val != null) conn.setRequestProperty(key, val);
                    }
                }

                if (body != null && !method.equalsIgnoreCase("GET") && !method.equalsIgnoreCase("HEAD")) {
                    byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                    conn.setDoOutput(true);
                    conn.setFixedLengthStreamingMode(payload.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payload);
                        os.flush();
                    }
                }

                int status = conn.getResponseCode();
                InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String responseBody = "";
                if (stream != null) {
                    try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                        responseBody = new String(out.toByteArray(), StandardCharsets.UTF_8);
                    }
                }

                JSObject respHeaders = new JSObject();
                Map<String, List<String>> headerFields = conn.getHeaderFields();
                if (headerFields != null) {
                    for (Map.Entry<String, List<String>> entry : headerFields.entrySet()) {
                        if (entry.getKey() != null && entry.getValue() != null && !entry.getValue().isEmpty()) {
                            respHeaders.put(entry.getKey().toLowerCase(), entry.getValue().get(0));
                        }
                    }
                }

                JSObject result = new JSObject();
                result.put("status", status);
                result.put("body", responseBody);
                result.put("headers", respHeaders);
                call.resolve(result);
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "网络请求失败";
                call.reject(msg, e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private void closeOAuthServerLocked() {
        if (oauthServer != null) {
            try { oauthServer.close(); } catch (Exception ignored) {}
            oauthServer = null;
        }
    }

    @PluginMethod
    public void stopOAuthCallbackServer(PluginCall call) {
        synchronized (oauthLock) {
            closeOAuthServerLocked();
        }
        call.resolve();
    }

    @PluginMethod
    public void startOAuthCallbackServer(PluginCall call) {
        int port = call.getInt("port", 1455);
        String expectedPath = call.getString("callbackPath", "/auth/callback");

        httpPool.execute(() -> {
            ServerSocket server;
            synchronized (oauthLock) {
                closeOAuthServerLocked();
                try {
                    server = new ServerSocket(port, 4, InetAddress.getByName("127.0.0.1"));
                    server.setSoTimeout(300000);
                    oauthServer = server;
                } catch (Exception e) {
                    call.reject("本地回调端口 " + port + " 监听失败：" + e.getMessage(), e);
                    return;
                }
            }

            JSObject started = new JSObject();
            started.put("ok", true);
            started.put("port", port);
            call.resolve(started);

            try {
                while (!server.isClosed()) {
                    Socket socket = server.accept();
                    try {
                        socket.setSoTimeout(5000);
                        BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                        String requestLine = reader.readLine();
                        if (requestLine == null) {
                            socket.close();
                            continue;
                        }
                        String[] parts = requestLine.split(" ");
                        String rawTarget = parts.length >= 2 ? parts[1] : "/";
                        String reqPath = rawTarget;
                        String query = "";
                        int qIdx = rawTarget.indexOf('?');
                        if (qIdx >= 0) {
                            reqPath = rawTarget.substring(0, qIdx);
                            query = rawTarget.substring(qIdx + 1);
                        }

                        if (!reqPath.equals(expectedPath)) {
                            String notFound = "HTTP/1.1 404 Not Found\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n";
                            socket.getOutputStream().write(notFound.getBytes(StandardCharsets.UTF_8));
                            socket.close();
                            continue;
                        }

                        JSObject params = new JSObject();
                        params.put("url", "http://localhost:" + port + rawTarget);
                        if (!query.isEmpty()) {
                            for (String pair : query.split("&")) {
                                int eq = pair.indexOf('=');
                                if (eq > 0) {
                                    String k = URLDecoder.decode(pair.substring(0, eq), "UTF-8");
                                    String v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                                    params.put(k, v);
                                }
                            }
                        }

                        String html = "<!doctype html><html><head><meta charset=\\"utf-8\\"><meta name=\\"viewport\\" content=\\"width=device-width,initial-scale=1\\"><title>周游地图 · 登录成功</title></head><body style=\\"font-family:sans-serif;text-align:center;padding:48px 20px;background:#fff8f2;color:#3c2e2a\\"><h2 style=\\"color:#e05a47\\">✓ 授权成功</h2><p>已将登录信息传回「周游地图」，现在可以直接切回 App 使用。</p></body></html>";
                        byte[] htmlBytes = html.getBytes(StandardCharsets.UTF_8);
                        String resp = "HTTP/1.1 200 OK\\r\\nContent-Type: text/html; charset=utf-8\\r\\nContent-Length: " + htmlBytes.length + "\\r\\nConnection: close\\r\\n\\r\\n";
                        OutputStream out = socket.getOutputStream();
                        out.write(resp.getBytes(StandardCharsets.UTF_8));
                        out.write(htmlBytes);
                        out.flush();
                        socket.close();

                        notifyListeners("oauthCallback", params);
                        break;
                    } catch (Exception ignored) {
                        try { socket.close(); } catch (Exception ignored2) {}
                    }
                }
            } catch (Exception ignored) {
                // timeout or closed
            } finally {
                synchronized (oauthLock) {
                    if (oauthServer == server) closeOAuthServerLocked();
                }
            }
        });
    }
}
`;
  await writeFile(path.join(javaPkgDir, 'NativeAiBridgePlugin.java'), nativeAiBridgeJava, 'utf8');

  process.stdout.write('Patched Android project (Manifest, borderless adaptive icons, AppUpdater & NativeAiBridge plugins, version) successfully.\n');
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
