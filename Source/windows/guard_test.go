package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLocalOnly(t *testing.T) {
	h := localOnly("http://127.0.0.1:5000/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	cases := []struct {
		name, method, host string
		hdr                map[string]string
		want               int
	}{
		{"same origin GET", "GET", "127.0.0.1:5000", map[string]string{"Sec-Fetch-Site": "same-origin"}, 200},
		{"plain GET no headers", "GET", "127.0.0.1:5000", nil, 200},
		{"POST same origin", "POST", "127.0.0.1:5000", map[string]string{"Origin": "http://127.0.0.1:5000", "Sec-Fetch-Site": "same-origin"}, 200},
		{"POST without proof", "POST", "127.0.0.1:5000", nil, 403},
		{"cross-site POST", "POST", "127.0.0.1:5000", map[string]string{"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"}, 403},
		{"cross-site GET", "GET", "127.0.0.1:5000", map[string]string{"Sec-Fetch-Site": "cross-site"}, 403},
		{"same-site GET", "GET", "127.0.0.1:5000", map[string]string{"Sec-Fetch-Site": "same-site"}, 403},
		{"foreign origin", "GET", "127.0.0.1:5000", map[string]string{"Origin": "https://evil.example"}, 403},
		{"dns rebinding host", "GET", "evil.example:5000", nil, 403},
		{"wrong port", "GET", "127.0.0.1:6000", nil, 403},
		{"localhost host ok", "GET", "localhost:5000", map[string]string{"Sec-Fetch-Site": "same-origin"}, 200},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, "http://"+c.host+"/__dawaya/llm/status", nil)
		req.Host = c.host
		for k, v := range c.hdr {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s: got %d want %d", c.name, rec.Code, c.want)
		}
	}
}
