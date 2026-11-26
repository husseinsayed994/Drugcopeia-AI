package main

import (
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

/*
The page CSP allows script-src 'self' only, so an inline bridge never runs and the

	assistant silently falls back to the web runtime ("device not supported") on every
	Windows install. The bridge must reach the page as an external same-origin script.
*/
func TestLocalOnlyBridgeScript(t *testing.T) {
	root := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html><head><title>t</title></head><body></body></html>")},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "http://127.0.0.1:47124/", nil)
	spaHandler(root).ServeHTTP(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, `<script src="/__dawaya/bridge.js"></script>`) {
		t.Fatalf("served index does not load the external bridge: %s", body)
	}
	if strings.Contains(body, "<script>window.DawayaLLMTransport") {
		t.Fatal("the bridge is still injected inline, which the page CSP blocks")
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "http://127.0.0.1:47124/__dawaya/bridge.js", nil)
	serveWindowsBridge(rec, req)
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Fatalf("bridge content type %q", ct)
	}
	js := rec.Body.String()
	if !strings.HasPrefix(js, "window.DawayaLLMTransport = 'windows';") {
		t.Fatal("bridge must announce the windows transport before any app script runs")
	}
	if !strings.Contains(js, "window.DawayaNative") || strings.Contains(js, "<script>") {
		t.Fatal("bridge must be pure JavaScript defining DawayaNative, not markup")
	}
}
