package main

import (
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

var lastRequest atomic.Int64

//go:embed all:www
var content embed.FS

// The on-device llama.cpp runtime ships next to the web assets inside the exe.
// Staging is done by build-windows.sh; when the folder only holds its README the
// assistant falls back to smart search and no runtime is advertised.
//
//go:embed all:llama
var llamaRuntime embed.FS

const (
	appName       = "Drugcopeia AI"
	appVersion    = "1.7.8"
	preferredPort = 47124
	llamaVersion  = "b11985"
)

var (
	flagNoBrowser = flag.Bool("no-browser", false, "run the local server without opening a window")
	flagPort      = flag.Int("port", 0, "preferred local port (0 = automatic)")
	flagDebug     = flag.Bool("debug", false, "write a diagnostic log next to the app data")
)

var logger = log.New(io.Discard, "", 0)

// Dawaya's Windows build limits its network use to three things, all of them
// recorded in Source/privacy.config.json:
//
//   - `net/http` serves the bundled app over loopback (127.0.0.1) and probes the
//     local health endpoint to detect an already-running instance.
//   - llm.go downloads the on-device assistant model, and only after the reader
//     turns Offline mode off and presses Download. It follows the pinned model URL
//     through huggingface.co and its .hf.co CDN, refuses every other host before a
//     socket is opened, and sends no cookie, referrer or identifier. The answers
//     themselves are produced by the bundled llama-server over loopback.
//   - The news hosts (www.who.int, api.fda.gov, eutils.ncbi.nlm.nih.gov) and the
//     medicine-page photo search (commons.wikimedia.org plus thumb/upload.wikimedia.org
//     for the image bytes) are contacted by the web layer, never from this binary.
//
// For links, this launcher starts a second window of the same browser process: the
// browser fetches, not this binary, so the medicine page stays open underneath. No
// page loads inside the Dawaya window.
//
// Logging is OFF unless --debug is passed; even then it never interpolates a
// request URL or query string (Go's http.Server writes no access log), and no
// machine identifier or user-entered text is ever recorded.
type app struct {
	dataDir string
	url     string
	llm     *llmService
}

// assertLoopback refuses any listen address that is not IP loopback, so the
// local server can never be reachable from another device on the network.
func assertLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("invalid listen address %q", addr)
	}
	if ip := net.ParseIP(host); host != "127.0.0.1" && host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("refusing to bind to non-loopback address %q", addr)
	}
	return nil
}

func main() {
	flag.Parse()
	a := &app{dataDir: resolveDataDir()}
	a.llm = newLLMService(loadAIConfig(), a.dataDir, ensureLLMRuntime(a.dataDir))
	defer a.llm.unload()
	if *flagDebug {
		// Opt-in only. The log lives in the local data dir and holds lifecycle
		// lines only — never a query string, request URL, or user-entered text.
		if f, err := os.OpenFile(filepath.Join(a.dataDir, "dawaya.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644); err == nil {
			logger.SetOutput(f)
			logger.SetFlags(log.LstdFlags)
			defer f.Close()
		}
	}

	wantPort := *flagPort
	if wantPort == 0 {
		wantPort = preferredPort
	}

	addr := "127.0.0.1:" + strconv.Itoa(wantPort)
	// Belt-and-suspenders: the address is hardcoded to loopback above, but assert
	// it so a future refactor cannot accidentally bind a routable interface.
	if err := assertLoopback(addr); err != nil {
		showError("يجب أن يعمل خادم Dawaya على جهازك فقط.\n\n" + err.Error())
		os.Exit(1)
	}
	listener, listenErr := net.Listen("tcp", addr)
	reused := false

	if listenErr != nil {
		if isDawayaRunning(wantPort) {
			reused = true
			a.url = "http://" + addr + "/"
			logger.Printf("an instance is already serving loopback port %d", wantPort)
		} else {
			listener, listenErr = net.Listen("tcp", "127.0.0.1:0")
			if listenErr != nil {
				showError("تعذر تشغيل خادم Dawaya المحلي.\n\n" + listenErr.Error())
				os.Exit(1)
			}
		}
	}

	if !reused {
		a.url = "http://" + listener.Addr().String() + "/"
		go a.serve(listener)
		logger.Printf("serving %s %s from embedded assets", appName, appVersion)
	}

	if *flagNoBrowser {
		logger.Printf("server-only mode; press Ctrl+C to stop")
		select {}
	}

	// Preferred: a real desktop window in this process (WebView2). Closing it
	// ends the program. Falls back to an Edge/Chrome app window when the
	// WebView2 runtime is not installed.
	if err := runNativeWindow(a.url, a.dataDir); err == nil {
		logger.Printf("native window closed; shutting down")
		return
	} else {
		logger.Printf("native window unavailable, using browser app window: %v", err)
	}

	if reused {
		if _, err := a.openWindow(); err != nil {
			logger.Printf("could not open an app window: %v", err)
			_ = openExternal(a.url)
		}
		return
	}

	cmd, err := a.openWindow()
	if err != nil {
		logger.Printf("could not open an app window: %v", err)
		showError("لم يتم العثور على Microsoft Edge لتشغيل واجهة Dawaya.\n\n" +
			"ثبّت Microsoft Edge (مثبت افتراضيًا مع Windows 10/11) ثم أعد تشغيل البرنامج.\n\n" +
			a.url)
		os.Exit(1)
	}

	started := time.Now()
	if err := cmd.Wait(); err != nil {
		logger.Printf("app window finished: %v", err)
	}
	if time.Since(started) < 15*time.Second {
		// The browser handed the window to another process and exited at once.
		// Keep the local server alive while the window is still in use.
		for {
			time.Sleep(5 * time.Second)
			if time.Since(time.Unix(0, lastRequest.Load())) > 2*time.Minute {
				break
			}
		}
	}
	logger.Printf("window closed; shutting down")
}

// resolveDataDir picks a local-only directory for the app window profile and the
// opt-in debug log. It reads the LOCALAPPDATA env var (which contains the login
// username in its path) — that is fine because the value is only used to build a
// local filesystem path and is never sent anywhere or written to a request. The
// binary reads NO machine identifier (no hostname, no os/user, no MAC address,
// no volume serial); see the zero-outbound note near the top of this file.
func resolveDataDir() string {
	if base := os.Getenv("LOCALAPPDATA"); base != "" {
		return filepath.Join(base, appName)
	}
	if base, err := os.UserConfigDir(); err == nil {
		return filepath.Join(base, appName)
	}
	return filepath.Join(os.TempDir(), strings.ToLower(appName))
}

func (a *app) serve(ln net.Listener) {
	sub, err := fs.Sub(content, "www")
	if err != nil {
		logger.Printf("embedded assets unavailable: %v", err)
		return
	}

	mux := http.NewServeMux()
	// /__dawaya/health exists only so a second launch can detect an instance
	// already running on the preferred loopback port. It is reached over 127.0.0.1
	// by isDawayaRunning and never leaves the device.
	mux.HandleFunc("/__dawaya/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		fmt.Fprintf(w, "dawaya %s", appVersion)
	})
	// On-device assistant: model storage, downloads and generation all stay on
	// loopback; see llm.go for the outbound-host allowlist.
	llmMux := http.NewServeMux()
	a.llm.routes(llmMux)
	mux.Handle("/__dawaya/llm/", localOnly(a.url, llmMux))
	// Every link the reader taps: news, a reference, a source citation, a pack photograph.
	// The offline database holds no picture of a pack and the app page holds no remote
	// content, so the real pages only exist on the open web. The page asks this launcher —
	// over loopback, on the tap that asked for it — to open a second browser window;
	// nothing is ever loaded inside the Dawaya window itself.
	mux.Handle("/__dawaya/browser", localOnly(a.url, http.HandlerFunc(a.handleBrowserWindow)))
	// Static-only file server. The former /__dawaya/images Bing proxy is gone: the
	// binary performs no outbound requests.
	mux.Handle("/", withHeaders(spaHandler(sub)))

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Printf("local server stopped: %v", err)
	}
}

func withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastRequest.Store(time.Now().UnixNano())
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		// Same policy as the <meta> tag in webapp/index.html: self plus the
		// allowlisted news and Wikimedia Commons hosts, no frames, no objects,
		// no form posts. No inline scripts or style blocks (only style attributes).
		// The model hosts are reachable only
		// through DawayaNet.modelDownload (the one-time model download), and the
		// wasm + blob-worker allowances are for the vendored wllama runtime, the
		// web fallback when the loopback helper is absent.
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; "+
				"form-action 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; style-src-attr 'unsafe-inline'; "+
				"img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; "+
				"connect-src 'self' https://www.who.int https://api.fda.gov https://eutils.ncbi.nlm.nih.gov "+
				"https://commons.wikimedia.org https://thumb.wikimedia.org https://upload.wikimedia.org "+
				"https://huggingface.co https://*.hf.co https://github.com https://release-assets.githubusercontent.com https://objects.githubusercontent.com; worker-src 'self' blob:; manifest-src 'self'; "+
				"frame-ancestors 'none'")
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			w.Header().Set("Cache-Control", "no-cache")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=86400")
		}
		next.ServeHTTP(w, r)
	})
}

func spaHandler(root fs.FS) http.Handler {
	files := http.FileServer(http.FS(root))
	index, err := fs.ReadFile(root, "index.html")
	if err == nil {
		/* The launcher, not the page, knows whether the embedded runtime is present:
		   announce the loopback transport before any app script runs. The same tag
		   hands the page the one native call the Windows shell can make. */
		index = []byte(strings.Replace(string(index), "<head>",
			"<head>\n  <script>window.DawayaLLMTransport = 'windows';</script>\n"+windowsBridgeScript, 1))
	}
	serveIndex := func(w http.ResponseWriter, r *http.Request) {
		if index == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(index)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		}
		info, err := fs.Stat(root, name)
		if info != nil && info.IsDir() {
			if _, indexErr := fs.Stat(root, path.Join(name, "index.html")); indexErr != nil {
				http.NotFound(w, r)
				return
			}
		} else if err != nil {
			if strings.Contains(r.Header.Get("Accept"), "text/html") {
				serveIndex(w, r)
			} else {
				http.NotFound(w, r)
			}
			return
		}
		if name == "index.html" {
			serveIndex(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
}

/* The Windows shell is a browser in app-window mode, so the page and the launcher
   are separate processes with one channel between them: loopback. The script below
   is the entire native surface of the Windows build — the browser view that every
   link opens. Offline mode is read in the page, from the same gate every other
   platform consults, and a refusal there is final: the app never retries a blocked
   address through the ordinary browser. */
const windowsBridgeScript = `<script>
window.DawayaNative = Object.freeze({
  openInAppBrowser: function (url) {
    var href = String(url || '');
    var gate = window.DawayaNet;
    var offline = gate && typeof gate.isOffline === 'function' && gate.isOffline();
    if (!/^https?:\/\//i.test(href) || offline) {
      return Promise.resolve({ presented: false, target: 'blocked' });
    }
    return fetch('/__dawaya/browser?url=' + encodeURIComponent(href), { credentials: 'omit' })
      .then(function (response) {
        return response.ok
          ? { presented: true, target: 'in-app' }
          : { presented: false, target: 'unavailable' };
      })
      .catch(function () { return { presented: false, target: 'unavailable' }; });
  }
});
</script>`

func (a *app) handleBrowserWindow(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Only the app page may ask for a window. A foreign page that guesses the
	// loopback port is refused before any browser process starts.
	if origin := r.Header.Get("Origin"); origin != "" && origin != strings.TrimSuffix(a.url, "/") {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	target, err := browserTarget(r.URL.Query().Get("url"))
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := a.openBrowserWindow(target); err != nil {
		// The log line names the failure, never the address being opened.
		logger.Printf("browser window refused: %v", err)
		http.Error(w, "no window", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, "ok")
}

// browserTarget accepts an absolute http(s) address carrying no credentials, and
// nothing else. A file:, jar: or javascript: value never reaches a browser switch,
// and an address that begins with a dash cannot be read as one.
func browserTarget(raw string) (string, error) {
	if len(raw) > 2048 {
		return "", errors.New("address too long")
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", errors.New("unparseable address")
	}
	if scheme := strings.ToLower(parsed.Scheme); scheme != "http" && scheme != "https" {
		return "", errors.New("unsupported scheme")
	}
	if parsed.Host == "" || parsed.User != nil {
		return "", errors.New("unsupported address")
	}
	return parsed.String(), nil
}

// profileDir is the throwaway browser profile the app window lives in. The
// browser view opens on that same profile, so the reader's own browser history,
// cookies and signed-in profiles stay out of it.
func (a *app) profileDir() string { return filepath.Join(a.dataDir, "window") }

// openBrowserWindow shows one page in its own window of the browser process that
// already hosts the app. Reusing browserSwitches means the telemetry, sync and
// crash-upload switches put in place for the app window keep holding here.
func (a *app) openBrowserWindow(target string) error {
	exe := findBrowser()
	if exe == "" {
		return errors.New("no supported browser found")
	}
	if err := exec.Command(exe, browserWindowSwitches(a.profileDir(), target, "1180,880")...).Start(); err != nil {
		return err
	}
	logger.Printf("opened a browser window with %s", exe)
	return nil
}

// browserWindowSwitches starts the same locked-down profile as the app window but with
// the browser's own toolbar instead of the chromeless --app= frame. That is deliberate
// for a page reached through a link: the address bar and the browser menu are the
// visible way to take the page elsewhere, which is what the other platforms ship as a
// button on their browser view. The window still belongs to Dawaya's throwaway profile,
// so nothing lands in the reader's real browser.
func browserWindowSwitches(profile, target, size string) []string {
	args := browserSwitches(profile, target, size)
	for i, arg := range args {
		if strings.HasPrefix(arg, "--app=") {
			args[i] = "--new-window"
			break
		}
	}
	return append(args, target)
}

// isDawayaRunning probes the loopback health endpoint to detect a Dawaya
// instance already serving on the preferred port. It dials 127.0.0.1 with a raw
// HTTP/1.1 request (no net/http client at all) so this remains a pure loopback
// check that never leaves the device. A foreign service on the same port will
// not answer with the "dawaya " body, so it is never mistaken for our app.
func isDawayaRunning(port int) bool {
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(port), 900*time.Millisecond)
	if err != nil {
		return false
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(900 * time.Millisecond))
	req := "GET /__dawaya/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		return false
	}
	buf := make([]byte, 256)
	n, _ := conn.Read(buf)
	if n <= 0 {
		return false
	}
	return strings.Contains(string(buf[:n]), "dawaya ")
}

func (a *app) openWindow() (*exec.Cmd, error) {
	exe := findBrowser()
	if exe == "" {
		return nil, errors.New("no supported browser found")
	}
	profile := a.profileDir()
	if err := os.MkdirAll(profile, 0o755); err != nil {
		logger.Printf("could not prepare profile directory: %v", err)
	}
	args := browserSwitches(profile, a.url, "1280,900")
	cmd := exec.Command(exe, args...)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	logger.Printf("opened %s with %s", a.url, exe)
	return cmd, nil
}

// browserSwitches is the single list of Chromium switches both windows are
// started with. The app runs in a throwaway browser profile with its own data
// directory; the switches turn off the browser's own telemetry, crash upload and
// background networking. Permission prompts are left to the OS: the camera and
// microphone are requested only when the reader presses Scan code or Voice search,
// and the browser's own prompt is the consent step.
func browserSwitches(profile, appURL, size string) []string {
	return []string{
		"--app=" + appURL,
		"--user-data-dir=" + profile,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-sync",
		"--disable-background-mode",
		"--disable-background-networking",
		"--disable-component-update",
		"--disable-breakpad",
		"--disable-domain-reliability",
		"--disable-client-side-phishing-detection",
		"--disable-default-apps",
		"--disable-dev-tools",
		"--no-pings",
		"--disable-search-engine-choice-screen",
		"--window-size=" + size,
		"--disable-features=Translate,msEdgeTranslate,msEdgeCollections,OptimizationHints,MediaRouter,AutofillServerCommunication",
	}
}

func findBrowser() string {
	if base := os.Getenv("ProgramFiles(x86)"); base != "" {
		if found := probeBrowser(base); found != "" {
			return found
		}
	}
	if base := os.Getenv("ProgramFiles"); base != "" {
		if found := probeBrowser(base); found != "" {
			return found
		}
	}
	if base := os.Getenv("LOCALAPPDATA"); base != "" {
		if found := probeBrowser(base); found != "" {
			return found
		}
	}
	return ""
}

func probeBrowser(base string) string {
	candidates := []string{
		filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"),
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func init() {
	mime.AddExtensionType(".webmanifest", "application/manifest+json")
	mime.AddExtensionType(".woff2", "font/woff2")
	mime.AddExtensionType(".woff", "font/woff")
	mime.AddExtensionType(".json", "application/json")
	mime.AddExtensionType(".svg", "image/svg+xml")
	mime.AddExtensionType(".js", "text/javascript")
}

