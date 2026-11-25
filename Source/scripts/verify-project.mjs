#!/usr/bin/env node
/**
 * Static release check for the Dawaya iOS wrapper.
 *
 * It validates the Xcode project wiring, bundled web app, native privacy
 * strings, app icons, and Capacitor configuration without needing macOS.
 * Run with: npm run verify
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'ios', 'App', 'App');
const projectFile = path.join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const publicDir = path.join(appDir, 'public');

let failures = 0;
let checks = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(label, task) {
  checks += 1;
  try {
    await task();
    console.log(`  \u2713 ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  \u2717 ${label}\n      ${error.message}`);
  }
}

async function read(relative, base = root) {
  return readFile(path.join(base, relative));
}

async function exists(relative, base = root) {
  try {
    await stat(path.join(base, relative));
    return true;
  } catch {
    return false;
  }
}

async function requireFile(relative) {
  assert(await exists(relative), `missing ${relative}`);
  const info = await stat(path.join(root, relative));
  assert(info.isFile() && info.size > 0, `${relative} is empty`);
}

async function sha256(relative) {
  return createHash('sha256').update(await read(relative)).digest('hex');
}

function pngDimensions(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  assert(signature === '89504e470d0a1a0a', 'not a PNG file');
  assert(buffer.subarray(12, 16).toString('ascii') === 'IHDR', 'missing IHDR chunk');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25]
  };
}

async function main() {
  console.log('Dawaya iOS project verification\n');

  await check('project source files are present', async () => {
    const required = [
      'package.json',
      'package-lock.json',
      'capacitor.config.json',
      'native/ios-shell.js',
      'scripts/sync-web.mjs',
      'scripts/verify-project.mjs',
      'ExportOptions.plist',
      'ios/App/App.xcodeproj/project.pbxproj',
      'ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme',
      'ios/App/App/Info.plist',
      'ios/App/App/PrivacyInfo.xcprivacy',
      'ios/App/App/Base.lproj/LaunchScreen.storyboard',
      'ios/App/App/en.lproj/InfoPlist.strings',
      'ios/App/App/ar.lproj/InfoPlist.strings',
      'ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json',
      'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
      'ios/App/App/Assets.xcassets/DawayaLogo.imageset/dawaya-logo.png',
      'ios/App/App/Assets.xcassets/LaunchBackground.colorset/Contents.json'
    ];
    for (const file of required) await requireFile(file);
    const web = [
      'index.html', 'styles.css', 'core.js', 'lab-tests.js', 'clinical-tools.js',
      'app.js', 'manifest.webmanifest', 'service-worker.js',
      'assets/red-crescent-rx-96.png', 'assets/lab-tests-content.json'
    ];
    for (const file of web) await requireFile(path.join('webapp', file));
  });

  await check('package.json pins Capacitor 8.5.3 and exposes npm scripts', async () => {
    const pkg = JSON.parse(await read('package.json'));
    assert(pkg.dependencies?.['@capacitor/core'] === '8.5.3', 'unexpected @capacitor/core version');
    assert(pkg.dependencies?.['@capacitor/ios'] === '8.5.3', 'unexpected @capacitor/ios version');
    assert(pkg.devDependencies?.['@capacitor/cli'] === '8.5.3', 'unexpected @capacitor/cli version');
    for (const script of ['sync:web', 'sync:ios', 'open:ios', 'verify']) {
      assert(Boolean(pkg.scripts?.[script]), `missing npm script "${script}"`);
    }
  });

  await check('Capacitor configs are valid and match', async () => {
    const source = JSON.parse(await read('capacitor.config.json'));
    assert(/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/i.test(source.appId), 'appId is not a reverse-DNS identifier');
    assert(source.appId === 'app.drugcopeia.ai', 'unexpected appId');
    assert(source.appName === 'Drugcopeia AI', 'unexpected appName');
    assert(source.webDir === 'www', 'webDir must be www');
    assert(!source.server?.url, 'a remote server URL is configured');
    assert(source.ios?.contentInset === 'never', 'contentInset must be "never"');
    assert(source.ios?.scrollEnabled === true, 'scrollEnabled must be true');
    const synced = JSON.parse(await read('ios/App/App/capacitor.config.json'));
    for (const key of Object.keys(source)) {
      assert(JSON.stringify(synced[key]) === JSON.stringify(source[key]), `synced config differs for ${key}`);
    }
  });

  await check('web bridge syntax and injection order', async () => {
    const bridge = await read('native/ios-shell.js', root);
    new vm.Script(bridge.toString(), { filename: 'ios-shell.js' });
    for (const relative of ['www/index.html', 'ios/App/App/public/index.html']) {
      const html = (await read(relative)).toString('utf8');
      const shell = html.search(/<script src="ios-shell\.js(\?v=\d+)?"><\/script>/);
      const core = html.indexOf('<script src="core.js');
      assert(shell >= 0, `${relative} is missing ios-shell.js`);
      assert(core >= 0, `${relative} is missing core.js`);
      assert(shell < core, `${relative} loads core.js before ios-shell.js`);
      assert(html.includes('sw-register.js'), `${relative} does not load sw-register.js`);
      assert(!/<script[^>]+src=["']https?:/i.test(html), `${relative} loads a remote script`);
    }
  });

  await check('every lab test carries its full MedlinePlus guide', async () => {
    const catalog = (await read(path.join('webapp', 'lab-tests.js'))).toString('utf8');
    const ids = [...catalog.matchAll(/\['([a-z0-9-]+)','[a-z-]+','[a-z-]+'.*?,'([^']+)'\]/g)].map(match => match[1]);
    assert(ids.length >= 27, `expected at least 27 lab tests, found ${ids.length}`);
    const guide = JSON.parse(await read(path.join('webapp', 'assets', 'lab-tests-content.json'))).tests || {};
    let complete = 0;
    const incomplete = [];
    for (const id of ids) {
      const sections = guide[id]?.en?.sections;
      if (!(Array.isArray(sections) && sections.length >= 6)) { incomplete.push(id); continue; }
      complete += 1;
      assert(guide[id].url?.startsWith('https://medlineplus.gov/'), `${id} has no MedlinePlus source URL`);
      assert(sections.every(section => section.heading && section.blocks?.length), `${id} has an empty section`);
    }
    console.log(`      ${complete} of ${ids.length} tests have the full guide; without it: ${incomplete.join(', ') || 'none'}`);
    assert(complete >= 27, `only ${complete} lab tests carry the full guide`);
  });

  await check('bundled public web app matches webapp sources', async () => {
    const files = [
      'styles.css', 'core.js', 'lab-tests.js', 'clinical-tools.js',
      'app.js', 'manifest.webmanifest', 'service-worker.js', 'ios-shell.js',
      'assets/red-crescent-rx-96.png', 'assets/lab-tests-content.json'
    ];
    for (const file of files) {
      const source = file === 'ios-shell.js'
        ? 'native/ios-shell.js'
        : path.join('webapp', file);
      const built = path.join('ios/App/App/public', file);
      assert(await exists(built), `missing ${built}`);
      assert(await sha256(source) === await sha256(built), `${file} is stale; run npm run sync:ios`);
    }
  });

  await check('Info.plist contains release-ready privacy and app settings', async () => {
    const plist = (await read('ios/App/App/Info.plist')).toString('utf8');
    const required = [
      'NSCameraUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSSpeechRecognitionUsageDescription',
      'UILaunchStoryboardName',
      'UIApplicationSceneManifest',
      'UIViewControllerBasedStatusBarAppearance',
      'NSAppTransportSecurity',
      'CFBundleLocalizations'
    ];
    for (const key of required) assert(plist.includes(`<key>${key}</key>`), `missing ${key}`);
    assert(/<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/.test(plist), 'ATS must not allow arbitrary loads');
    assert(/<key>UILaunchStoryboardName<\/key>\s*<string>LaunchScreen<\/string>/.test(plist), 'launch storyboard is not named LaunchScreen');
    assert(!/YOUR_|TODO|example\.com/i.test(plist), 'Info.plist still contains a placeholder');
    const strings = plist.match(/<string>[^<]*(?:camera|microphone|speech|photo)[^<]*<\/string>/gi) || [];
    assert(strings.length >= 3, 'privacy descriptions look incomplete');
    assert(!plist.includes('<key>NSPhotoLibraryUsageDescription</key>'), 'the privacy gate forbids a photo library description: photos arrive through the system picker');
  });

  await check('English and Arabic privacy strings are complete', async () => {
    const keys = [
      'CFBundleDisplayName',
      'NSCameraUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSSpeechRecognitionUsageDescription'
    ];
    for (const language of ['en', 'ar']) {
      const strings = (await read(`ios/App/App/${language}.lproj/InfoPlist.strings`)).toString('utf8');
      for (const key of keys) assert(strings.includes(`"${key}"`), `${language}.lproj is missing ${key}`);
      assert(/\p{Script=Arabic}/u.test(strings) || language === 'en', `${language} strings are not localized`);
    }
  });

  await check('privacy manifest is conservative and valid', async () => {
    const manifest = (await read('ios/App/App/PrivacyInfo.xcprivacy')).toString('utf8');
    assert(/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(manifest), 'tracking must be false');
    assert(manifest.includes('NSPrivacyAccessedAPICategoryUserDefaults'), 'missing UserDefaults declaration');
    assert(manifest.includes('CA92.1'), 'missing approved UserDefaults reason');
    assert(/<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/.test(manifest), 'collected data types must be empty');
  });

  await check('Xcode target compiles every Swift file into the app', async () => {
    const pbx = (await read('ios/App/App.xcodeproj/project.pbxproj')).toString('utf8');
    const swiftFiles = (await readdir(appDir)).filter(name => name.endsWith('.swift')).sort();
    assert(swiftFiles.length >= 15, `expected at least 15 Swift files, found ${swiftFiles.length}`);
    for (const file of swiftFiles) {
      const occurrences = pbx.split(file).length - 1;
      assert(occurrences >= 2, `${file} is missing from the project group or Sources phase`);
      assert(new RegExp(`\\/\\* ${file.replace('.', '\\.')} in Sources \\*\\/`).test(pbx), `${file} is not in the Sources phase`);
    }
  });

  await check('Xcode resources, localization, and launch screen are wired', async () => {
    const pbx = (await read('ios/App/App.xcodeproj/project.pbxproj')).toString('utf8');
    assert(!pbx.includes('Main.storyboard'), 'project still references the removed Main.storyboard');
    for (const resource of [
      'LaunchScreen.storyboard', 'Assets.xcassets', 'PrivacyInfo.xcprivacy',
      'InfoPlist.strings', 'capacitor.config.json', 'config.xml'
    ]) {
      assert(new RegExp(`\\/\\* ${resource} in Resources \\*\\/`).test(pbx), `${resource} is not in Resources`);
    }
    assert(/knownRegions = \(\s*en,\s*ar,\s*Base,?\s*\);/.test(pbx.replace(/\r/g, '')), 'knownRegions must include en, ar, and Base');
    assert(/DAE000000000000000000001[\s\S]{0,900}DAF000000000000000000018[\s\S]{0,300}DAF000000000000000000019/.test(pbx), 'InfoPlist.strings variant group is incomplete');
    const launch = (await read('ios/App/App/Base.lproj/LaunchScreen.storyboard')).toString('utf8');
    assert(launch.includes('image="DawayaLogo"'), 'launch screen is missing the Dawaya logo');
    assert(launch.includes('name="LaunchBackground"'), 'launch screen is missing the launch background');
  });

  await check('shared Xcode scheme points at the app target', async () => {
    const pbx = (await read('ios/App/App.xcodeproj/project.pbxproj')).toString('utf8');
    const scheme = (await read('ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme')).toString('utf8');
    const target = pbx.match(/\/\* Begin PBXNativeTarget section \*\/[\s\S]*?([A-F0-9]{24}) \/\* App \*\/ = \{/);
    assert(target, 'cannot find the App target');
    assert(scheme.includes(`BlueprintIdentifier = "${target[1]}"`), 'scheme BlueprintIdentifier does not match the target');
    assert(scheme.includes('BlueprintName = "App"'), 'scheme does not reference the App target by name');
    assert(scheme.includes('buildConfiguration = "Release"') && scheme.includes('<ArchiveAction'), 'scheme has no Release archive action');
  });

  await check('app icon and logo have correct dimensions', async () => {
    const icon = pngDimensions(await read('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'));
    assert(icon.width === 1024 && icon.height === 1024, `app icon is ${icon.width}x${icon.height}`);
    assert(icon.colorType === 2, 'App Store icon must be RGB without an alpha channel');
    const logo = pngDimensions(await read('ios/App/App/Assets.xcassets/DawayaLogo.imageset/dawaya-logo.png'));
    assert(logo.width === 512 && logo.height === 512, `logo is ${logo.width}x${logo.height}`);
    const colors = JSON.parse(await read('ios/App/App/Assets.xcassets/LaunchBackground.colorset/Contents.json'));
    assert(colors.colors?.length >= 2, 'launch background must define light and dark variants');
  });

  await check('native plugins and notification delegate are registered', async () => {
    const bridge = (await read('ios/App/App/DawayaBridgeViewController.swift')).toString('utf8');
    const plugin = (await read('ios/App/App/DawayaShellPlugin.swift')).toString('utf8');
    const appDelegate = (await read('ios/App/App/AppDelegate.swift')).toString('utf8');
    assert(bridge.includes('registerPluginInstance(plugin)'), 'DawayaShellPlugin is not registered before loading the web view');
    assert(bridge.includes('.default()'), 'WebView is not using the persistent data store');
    for (const method of ['ready', 'setAppearance', 'speak', 'stopSpeaking', 'share', 'startVoiceSearch', 'scanCode', 'readPhoto', 'syncReminders', 'saveFile']) {
      assert(plugin.includes(`name: "${method}"`), `plugin method ${method} is not exported`);
    }
    assert(appDelegate.includes('UNUserNotificationCenter.current().delegate = self'), 'notification delegate is not installed');
  });

  await check('release export options are configured for App Store Connect', async () => {
    const options = (await read('ExportOptions.plist')).toString('utf8');
    assert(/<key>method<\/key>\s*<string>app-store-connect<\/string>/.test(options), 'export method must be app-store-connect');
    assert(/<key>signingStyle<\/key>\s*<string>automatic<\/string>/.test(options), 'export should use automatic signing');
    assert(options.includes('YOUR_TEAM_ID'), 'ExportOptions.plist must be edited with your Team ID');
  });

  if (failures) {
    console.error(`\n${failures} of ${checks} checks failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${checks} checks passed. Open ios/App/App.xcodeproj to build.`);
}

main().catch(error => {
  console.error(`\nVerification crashed: ${error.stack || error.message}`);
  process.exit(1);
});
