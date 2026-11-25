package main

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

// localOnly protects the helper endpoints (/__dawaya/llm/* and /__dawaya/browser)
// from other web pages that guess the loopback port (CSRF) and from DNS rebinding.
// A request passes only when all of these hold:
//   - the Host header is exactly the app's own loopback address (or localhost on
//     the same port), so a rebound hostname is refused;
//   - Sec-Fetch-Site, when the browser sends it, is "same-origin" or "none";
//   - Origin, when present, equals the app's own origin;
//   - a POST carries at least one of those two proofs of origin.
func localOnly(appURL string, next http.Handler) http.Handler {
	origin := strings.TrimSuffix(appURL, "/")
	u, err := url.Parse(appURL)
	port := ""
	if err == nil {
		port = u.Port()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !originAllowed(r, origin, port) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func originAllowed(r *http.Request, origin, port string) bool {
	host, hostPort, err := net.SplitHostPort(r.Host)
	if err != nil {
		return false
	}
	if hostPort != port || (host != "127.0.0.1" && host != "localhost") {
		return false
	}
	site := r.Header.Get("Sec-Fetch-Site")
	if site != "" && site != "same-origin" && site != "none" {
		return false
	}
	o := r.Header.Get("Origin")
	if o != "" && o != origin && o != "http://localhost:"+port {
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead && o == "" && site == "" {
		return false
	}
	return true
}
