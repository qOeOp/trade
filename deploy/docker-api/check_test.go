package main

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const pinned = "ghcr.io/qoeop/trade-runtime@sha256:40dedf763163e20538fefe884ac18d06376db4306de43bd8aabaf9812155bfaa"

// What docker 29.1.3 sends for `docker run` of runtime/container.py's paper_command (recorded).
const recorded = `{"Hostname":"","Domainname":"","User":"501:20","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PYTHONDONTWRITEBYTECODE=1"],"Cmd":["-m","engine.egress","--port","3128"],"Image":"` + pinned + `","Volumes":{},"WorkingDir":"","Entrypoint":["python"],"Labels":{"trade.paper.role":"egress"},"StopTimeout":30,"HostConfig":{"Binds":null,"ContainerIDFile":"","LogConfig":{"Type":"json-file","Config":{"max-file":"3","max-size":"10m"}},"NetworkMode":"trade-paper-probe","PortBindings":{},"RestartPolicy":{"Name":"no","MaximumRetryCount":0},"AutoRemove":false,"VolumeDriver":"","VolumesFrom":null,"ConsoleSize":[0,0],"CapAdd":null,"CapDrop":["ALL"],"CgroupnsMode":"","Dns":null,"DnsOptions":[],"DnsSearch":[],"ExtraHosts":null,"GroupAdd":null,"IpcMode":"","Cgroup":"","Links":null,"OomScoreAdj":0,"PidMode":"","Privileged":false,"PublishAllPorts":false,"ReadonlyRootfs":true,"SecurityOpt":["no-new-privileges"],"Tmpfs":{"/tmp":"rw,nosuid,noexec,size=1073741824"},"UTSMode":"","UsernsMode":"","ShmSize":0,"Isolation":"","CpuShares":0,"Memory":268435456,"NanoCpus":0,"CgroupParent":"","BlkioWeight":0,"BlkioWeightDevice":[],"BlkioDeviceReadBps":[],"BlkioDeviceWriteBps":[],"BlkioDeviceReadIOps":[],"BlkioDeviceWriteIOps":[],"CpuPeriod":0,"CpuQuota":0,"CpuRealtimePeriod":0,"CpuRealtimeRuntime":0,"CpusetCpus":"","CpusetMems":"","Devices":[],"DeviceCgroupRules":null,"DeviceRequests":null,"MemoryReservation":0,"MemorySwap":268435456,"MemorySwappiness":-1,"OomKillDisable":false,"PidsLimit":256,"Ulimits":[],"CpuCount":0,"CpuPercent":0,"IOMaximumIOps":0,"IOMaximumBandwidth":0,"Mounts":MOUNTS,"MaskedPaths":null,"ReadonlyPaths":null},"NetworkingConfig":{"EndpointsConfig":{}}}`

const recordedNetwork = `{"Name":"trade-paper-probe","Driver":"bridge","Scope":"","IPAM":{"Driver":"default","Options":{},"Config":[]},"Internal":true,"Attachable":false,"Ingress":false,"ConfigOnly":false,"ConfigFrom":null,"Options":{},"Labels":{"trade.paper.id":"0"}}`

// engine is a stand-in for the Docker engine on a Unix socket: it records what reaches it.
type engine struct {
	calls   []string
	bodies  []string
	mounts  string // the Mounts of an inspection
	socket  string
	release func()
}

func newEngine(t *testing.T) *engine {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "docker-api-") // a socket path has a short limit
	if err != nil {
		t.Fatal(err)
	}
	found := &engine{socket: filepath.Join(dir, "engine.sock"), mounts: "[]"}
	listener, err := net.Listen("unix", found.socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: found}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); os.RemoveAll(dir) })
	return found
}

func (e *engine) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/attach") {
		e.attach(w, r)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/json") && strings.Contains(r.URL.Path, "/gone/") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/json") && strings.HasPrefix(r.URL.Path, "/containers/") {
		_, _ = io.WriteString(w, `{"Mounts":`+e.mounts+`}`)
		return
	}
	body, _ := io.ReadAll(r.Body)
	e.calls = append(e.calls, r.Method+" "+r.URL.Path)
	e.bodies = append(e.bodies, string(body))
}

// attach answers as the engine does: 101, then a raw stream both ways.
func (e *engine) attach(w http.ResponseWriter, r *http.Request) {
	conn, buffered, err := w.(http.Hijacker).Hijack()
	if err != nil {
		return
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, "HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n")
	line, _ := buffered.ReadString('\n')
	_, _ = io.WriteString(conn, "echo "+line)
}

func newTestProxy(t *testing.T, roots ...string) (*engine, *httptest.Server, string) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "out"), 0o755); err != nil {
		t.Fatal(err)
	}
	found, err := newRules("ghcr.io/qoeop/trade-runtime", "501:20", append([]string{root}, roots...))
	if err != nil {
		t.Fatal(err)
	}
	fake := newEngine(t)
	server := httptest.NewServer(newProxy(fake.socket, found))
	t.Cleanup(server.Close)
	return fake, server, root
}

func call(t *testing.T, server *httptest.Server, method, target, body string) (int, string) {
	t.Helper()
	request, err := http.NewRequest(method, server.URL+target, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	text, _ := io.ReadAll(response.Body)
	return response.StatusCode, string(text)
}

func create(root string) string {
	return strings.Replace(recorded, "MOUNTS", `[{"Type":"bind","Source":"`+root+`/out","Target":"/reports"}]`, 1)
}

func TestCreateAsRecordedPassesAndForwardsOnlyWhatWasChecked(t *testing.T) {
	fake, server, root := newTestProxy(t)
	if code, text := call(t, server, "POST", "/v1.52/containers/create?name=x", create(root)); code != 200 {
		t.Fatalf("refused the recorded create: %d %s", code, text)
	}
	var forwarded object
	if err := json.Unmarshal([]byte(fake.bodies[0]), &forwarded); err != nil {
		t.Fatal(err)
	}
	host := forwarded["HostConfig"].(object)
	if forwarded["Image"] != pinned || host["ReadonlyRootfs"] != true || len(host["Mounts"].([]any)) != 1 {
		t.Fatalf("the forwarded create lost a checked field: %s", fake.bodies[0])
	}
	if _, found := host["Privileged"]; found {
		t.Fatalf("an unchecked field was forwarded: %s", fake.bodies[0])
	}
}

func TestCreateRefusals(t *testing.T) {
	_, _, root := newTestProxy(t)
	outside := t.TempDir()
	if err := os.Symlink("/", filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	mounts := func(mount string) [2]string {
		return [2]string{`"Source":"` + root + `/out","Target":"/reports"`, mount}
	}
	cases := map[string][2]string{
		"privileged":         {`"Privileged":false`, `"Privileged":true`},
		"lowercase field":    {`"Privileged":false`, `"privileged":true`},
		"cap add":            {`"CapAdd":null`, `"CapAdd":["SYS_ADMIN"]`},
		"caps kept":          {`"CapDrop":["ALL"]`, `"CapDrop":["NET_RAW"]`},
		"binds":              {`"Binds":null`, `"Binds":["/:/host"]`},
		"volumes from":       {`"VolumesFrom":null`, `"VolumesFrom":["trade-ide-ledger-1"]`},
		"devices":            {`"Devices":[]`, `"Devices":[{"PathOnHost":"/dev/sda"}]`},
		"pid host":           {`"PidMode":""`, `"PidMode":"host"`},
		"ipc host":           {`"IpcMode":""`, `"IpcMode":"host"`},
		"uts host":           {`"UTSMode":""`, `"UTSMode":"host"`},
		"userns host":        {`"UsernsMode":""`, `"UsernsMode":"host"`},
		"cgroup parent":      {`"CgroupParent":""`, `"CgroupParent":"/"`},
		"ports":              {`"PortBindings":{}`, `"PortBindings":{"80/tcp":[{"HostPort":"80"}]}`},
		"network host":       {`"NetworkMode":"trade-paper-probe"`, `"NetworkMode":"host"`},
		"network bridge":     {`"NetworkMode":"trade-paper-probe"`, `"NetworkMode":"bridge"`},
		"network of another": {`"NetworkMode":"trade-paper-probe"`, `"NetworkMode":"container:trade-ide-ledger-1"`},
		"writable root":      {`"ReadonlyRootfs":true`, `"ReadonlyRootfs":false`},
		"both spellings":     {`"ReadonlyRootfs":true`, `"ReadonlyRootfs":false,"readonlyrootfs":true`},
		"seccomp off":        {`"SecurityOpt":["no-new-privileges"]`, `"SecurityOpt":["seccomp=unconfined"]`},
		"no process limit":   {`"PidsLimit":256`, `"PidsLimit":-1`},
		"zero process limit": {`"PidsLimit":256`, `"PidsLimit":0`},
		"restart":            {`"Name":"no"`, `"Name":"always"`},
		"log driver":         {`"Type":"json-file"`, `"Type":"syslog"`},
		"other tmpfs":        {`"Tmpfs":{"/tmp"`, `"Tmpfs":{"/etc"`},
		"root user":          {`"User":"501:20"`, `"User":"0:0"`},
		"named user":         {`"User":"501:20"`, `"User":"root"`},
		"another user":       {`"User":"501:20"`, `"User":"1000:1000"`},
		"other image":        {pinned, "alpine@sha256:40dedf763163e20538fefe884ac18d06376db4306de43bd8aabaf9812155bfaa"},
		"tag, no digest":     {pinned, "ghcr.io/qoeop/trade-runtime:main"},
		"anonymous volume":   {`"Volumes":{}`, `"Volumes":{"/data":{"x":1}}`},
		"endpoint config":    {`"EndpointsConfig":{}`, `"EndpointsConfig":{"trade-ide_default":{"x":1}}`},
		"mount of /":         mounts(`"Source":"/","Target":"/reports"`),
		"mount outside":      mounts(`"Source":"` + outside + `","Target":"/reports"`),
		"mount through ..":   mounts(`"Source":"` + root + `/../..","Target":"/reports"`),
		"mount by symlink":   mounts(`"Source":"` + root + `/escape","Target":"/reports"`),
		"mount missing":      mounts(`"Source":"` + root + `/missing","Target":"/reports"`),
		"writable elsewhere": mounts(`"Source":"` + root + `/out","Target":"/inputs"`),
		"mount at /proc":     mounts(`"Source":"` + root + `/out","Target":"/proc/x","ReadOnly":true`),
		"mount at /":         mounts(`"Source":"` + root + `/out","Target":"/","ReadOnly":true`),
		"not a bind":         {`"Type":"bind"`, `"Type":"volume"`},
		"mount options":      mounts(`"Source":"` + root + `/out","Target":"/reports","BindOptions":{"Propagation":"rshared"}`),
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			fake, server, root2 := newTestProxy(t, root)
			body := create(root2)
			body = strings.Replace(body, root2+"/out", root+"/out", 1)
			if !strings.Contains(body, change[0]) {
				t.Fatalf("the recorded create has no %s", change[0])
			}
			code, text := call(t, server, "POST", "/containers/create", strings.Replace(body, change[0], change[1], 1))
			if code != 403 || !strings.Contains(text, "DOCKER_API_REFUSED") {
				t.Fatalf("not refused: %d %s", code, text)
			}
			if len(fake.calls) != 0 {
				t.Fatalf("a refused call reached the engine: %v", fake.calls)
			}
		})
	}
}

func TestCreateRefusesWhatCannotBeRead(t *testing.T) {
	_, server, _ := newTestProxy(t)
	for name, body := range map[string]string{"empty": "", "text": "x", "list": "[]", "two values": "{} {}",
		"no host config": `{"Image":"` + pinned + `","User":"501:20"}`} {
		if code, _ := call(t, server, "POST", "/containers/create", body); code != 403 {
			t.Errorf("%s: not refused: %d", name, code)
		}
	}
	long := `{"Labels":{"x":"` + strings.Repeat("x", maxBody) + `"}}`
	if code, _ := call(t, server, "POST", "/containers/create", long); code != 403 {
		t.Errorf("a long body was not refused: %d", code)
	}
}

func TestOnlyTheDaemonsCallsPass(t *testing.T) {
	allowed := [][2]string{
		{"HEAD", "/_ping"}, {"GET", "/_ping"}, {"GET", "/v1.52/version"}, {"GET", "/v1.52/containers/json?all=1"},
		{"GET", "/v1.52/containers/trade-paper-1-runner/json"}, {"GET", "/containers/abc/logs?tail=20"},
		{"POST", "/v1.52/containers/abc/wait?condition=removed"}, {"POST", "/containers/abc/stop?t=1"},
		{"POST", "/containers/abc/kill"}, {"DELETE", "/v1.52/containers/abc?force=1"},
		{"GET", "/v1.52/networks/trade-paper-1"}, {"DELETE", "/networks/trade-paper-1"},
		{"POST", "/v1.52/networks/bridge/connect"},
		{"GET", "/v1.52/images/" + pinned + "/json"},
		{"POST", "/v1.52/images/create?fromImage=ghcr.io%2Fqoeop%2Ftrade-runtime&tag=main"},
	}
	for _, item := range allowed {
		_, server, _ := newTestProxy(t)
		if code, text := call(t, server, item[0], item[1], ""); code != 200 {
			t.Errorf("%v refused: %d %s", item, code, text)
		}
	}
	refused := [][2]string{
		{"POST", "/v1.52/containers/abc/exec"}, {"POST", "/exec/abc/start"}, {"POST", "/containers/abc/update"},
		{"PUT", "/containers/abc/archive"}, {"GET", "/containers/abc/archive"}, {"POST", "/containers/abc/commit"},
		{"POST", "/volumes/create"}, {"GET", "/volumes"}, {"POST", "/build"}, {"POST", "/commit"},
		{"GET", "/secrets"}, {"POST", "/swarm/init"}, {"POST", "/plugins/pull"}, {"POST", "/system/prune"},
		{"POST", "/images/abc/push"}, {"POST", "/images/abc/tag"}, {"DELETE", "/images/abc"},
		{"POST", "/networks/trade-ide_default/connect"}, {"PUT", "/containers/abc/json"},
		{"POST", "/images/create?fromSrc=-&repo=ghcr.io/qoeop/trade-runtime&tag=main"},
		{"POST", "/images/create?fromImage=ghcr.io/qoeop/trade-runtime&fromSrc=-&tag=main"},
		{"POST", "/images/create?fromImage=alpine&tag=latest"},
		{"POST", "/images/create?fromImage=ghcr.io/qoeop/trade-runtime"},
		{"GET", "/images/../secrets/abc/json"}, {"POST", "/containers/x%2Fexec/stop"},
		{"POST", "/containers//stop"}, {"POST", "/v1.52/containers/../exec/stop"},
	}
	for _, item := range refused {
		fake, server, _ := newTestProxy(t)
		target, err := url.Parse(server.URL + item[1])
		if err != nil {
			t.Fatal(err)
		}
		request := &http.Request{Method: item[0], URL: target, Header: http.Header{}, Host: target.Host}
		response, err := http.DefaultTransport.RoundTrip(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 403 || len(fake.calls) != 0 {
			t.Errorf("%v not refused: %d, engine saw %v", item, response.StatusCode, fake.calls)
		}
	}
}

func TestNetworkCreate(t *testing.T) {
	fake, server, _ := newTestProxy(t)
	if code, text := call(t, server, "POST", "/v1.52/networks/create", recordedNetwork); code != 200 {
		t.Fatalf("refused the recorded network: %d %s", code, text)
	}
	if !strings.Contains(fake.bodies[0], `"Internal":true`) || strings.Contains(fake.bodies[0], "ConfigFrom") {
		t.Fatalf("forwarded %s", fake.bodies[0])
	}
	for name, change := range map[string][2]string{
		"route out":    {`"Internal":true`, `"Internal":false`},
		"other name":   {`"Name":"trade-paper-probe"`, `"Name":"trade-ide_default"`},
		"other driver": {`"Driver":"bridge"`, `"Driver":"macvlan"`},
		"options":      {`"Options":{},"Labels"`, `"Options":{"com.docker.network.bridge.name":"x"},"Labels"`},
		"ipam driver":  {`"IPAM":{"Driver":"default"`, `"IPAM":{"Driver":"evil"`},
		"ipam config":  {`"Config":[]`, `"Config":[{"Subnet":"10.0.0.0/8"}]`},
	} {
		if !strings.Contains(recordedNetwork, change[0]) {
			t.Fatalf("the recorded network has no %s", change[0])
		}
		if code, _ := call(t, server, "POST", "/networks/create", strings.Replace(recordedNetwork, change[0], change[1], 1)); code != 403 {
			t.Errorf("%s: not refused: %d", name, code)
		}
	}
}

// A create that passes does not hold at start: the mount happens then, and the daemon can write under the roots.
func TestStartChecksTheMountsAgain(t *testing.T) {
	fake, server, root := newTestProxy(t)
	fake.mounts = `[{"Type":"bind","Source":"` + root + `/out","Destination":"/reports","RW":true}]`
	if code, text := call(t, server, "POST", "/containers/abc/start", ""); code != 200 {
		t.Fatalf("refused a good start: %d %s", code, text)
	}
	if err := os.Remove(root + "/out"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/", root+"/out"); err != nil {
		t.Fatal(err)
	}
	if code, text := call(t, server, "POST", "/containers/abc/start", ""); code != 403 || !strings.Contains(text, "lies outside") {
		t.Fatalf("the swapped source was not refused: %d %s", code, text)
	}
	for name, mounts := range map[string]string{
		"a container mounting elsewhere": `[{"Type":"bind","Source":"/etc","Destination":"/x","RW":false}]`,
		"a named volume":                 `[{"Type":"volume","Source":"","Destination":"/x","RW":true}]`,
	} {
		fake.mounts = mounts
		if code, _ := call(t, server, "POST", "/containers/abc/start", ""); code != 403 {
			t.Errorf("%s: not refused: %d", name, code)
		}
	}
	if len(fake.calls) != 1 {
		t.Fatalf("a refused start reached the engine: %v", fake.calls)
	}
	if code, text := call(t, server, "POST", "/containers/gone/start", ""); code != 200 {
		t.Fatalf("a missing container is the engine's to answer: %d %s", code, text)
	}
}

func TestAttachStreamsBothWays(t *testing.T) {
	_, server, _ := newTestProxy(t)
	conn, err := net.Dial("tcp", strings.TrimPrefix(server.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, "POST /v1.52/containers/abc/attach?stream=1&stdout=1 HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n")
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 101 {
		t.Fatalf("no upgrade: %s", response.Status)
	}
	_, _ = io.WriteString(conn, "hello\n")
	if line, err := reader.ReadString('\n'); err != nil || line != "echo hello\n" {
		t.Fatalf("the stream did not pass: %q %v", line, err)
	}
}

func TestRulesNeedTheirConfiguration(t *testing.T) {
	for name, roots := range map[string][]string{"none": nil, "relative": {"x"}, "root": {"/"}, "unclean": {"/a/../b"}} {
		if _, err := newRules("r", "501:20", roots); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := newRules("", "501:20", []string{"/a"}); err == nil {
		t.Error("no repository: accepted")
	}
	for _, user := range []string{"", "root", "0:0", "501"} {
		if _, err := newRules("r", user, []string{"/a"}); err == nil {
			t.Errorf("user %q: accepted", user)
		}
	}
}
