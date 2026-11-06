// The compose project's Docker API proxy (the docker-api service): the only way to Docker, for the paper
// daemon and the commands it runs. It allows exactly the calls they make, and of the containers only the
// kind runtime/container.py builds (check.go). Everything else gets 403 and a line in its log.
//
// A reconcile replay attaches for up to 3600 s (paper/serve.py), so nothing here times out a request once
// its headers have arrived.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"strings"
	"time"
)

type proxy struct {
	rules  rules
	engine *httputil.ReverseProxy
	client *http.Client // the proxy's own reads of the engine
}

func newProxy(socket string, found rules) *proxy {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		},
		DisableCompression: true,
	}
	return &proxy{
		rules: found,
		engine: &httputil.ReverseProxy{
			Transport: transport,
			// `docker wait` waits for its response headers and `docker logs` for its lines: pass each write on.
			FlushInterval: -1,
			Rewrite: func(r *httputil.ProxyRequest) {
				r.Out.URL.Scheme, r.Out.URL.Host, r.Out.Host = "http", "docker", "docker"
			},
		},
		client: &http.Client{Transport: transport, Timeout: 30 * time.Second},
	}
}

func (p *proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := p.admit(r); err != nil {
		log.Printf("refused %s %s: %v", r.Method, r.URL.Path, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "DOCKER_API_REFUSED: " + err.Error()})
		return
	}
	p.engine.ServeHTTP(w, r)
}

// starting answers whether a container's bind mounts still hold when it starts: mount(2) follows symlinks
// when the engine starts the container, not when it is created, and the daemon can write under the roots.
// This stops a swap made before the start; one made between this check and the mount still wins
// (measured, docs/plans/paper-compose-deployment.zh.md §4.2).
func (p *proxy) starting(name string) error {
	response, err := p.client.Get("http://docker/containers/" + name + "/json")
	if err != nil {
		return fmt.Errorf("cannot inspect %s: %w", name, err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil // the engine gives its own answer
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("cannot inspect %s: %s", name, response.Status)
	}
	var found struct {
		Mounts []struct {
			Type, Source, Destination string
			RW                        bool
		}
	}
	if err := json.NewDecoder(response.Body).Decode(&found); err != nil {
		return fmt.Errorf("cannot read the inspection of %s: %w", name, err)
	}
	for _, mount := range found.Mounts {
		if err := p.rules.mount(mount.Type, mount.Source, mount.Destination, !mount.RW); err != nil {
			return err
		}
	}
	return nil
}

type list []string

func (l *list) String() string     { return strings.Join(*l, ",") }
func (l *list) Set(v string) error { *l = append(*l, v); return nil }

func main() {
	var roots list
	listen := flag.String("listen", ":2375", "the address to serve")
	socket := flag.String("socket", "/var/run/docker.sock", "the engine's socket")
	repository := flag.String("image", "", "the one image repository a container may run, pinned by digest")
	user := flag.String("user", "", "the numeric uid:gid every container runs as")
	flag.Var(&roots, "mount-root", "a directory bind mounts may lie under (repeatable), visible here at its own path")
	flag.Parse()
	found, err := newRules(*repository, *user, roots)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: *listen, Handler: newProxy(*socket, found), ReadHeaderTimeout: 30 * time.Second}
	log.Fatal(server.ListenAndServe())
}
