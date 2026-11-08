package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

const (
	maxBody = 1 << 20
	reports = "/reports" // the one writable mount target (runtime/container.py)
)

var (
	version     = regexp.MustCompile(`^/v[0-9]+(\.[0-9]+)?(/|$)`)
	readable    = regexp.MustCompile(`^/(_ping|version|containers/json|containers/[a-zA-Z0-9][a-zA-Z0-9_.-]*/(json|logs)|networks|networks/[a-zA-Z0-9][a-zA-Z0-9_.-]*|images/[a-zA-Z0-9][a-zA-Z0-9._/:@-]*/json)$`)
	lifecycle   = regexp.MustCompile(`^/(containers/[a-zA-Z0-9][a-zA-Z0-9_.-]*/(attach|wait|stop|kill)|networks/bridge/connect)$`)
	starting    = regexp.MustCompile(`^/containers/([a-zA-Z0-9][a-zA-Z0-9_.-]*)/start$`)
	removable   = regexp.MustCompile(`^/(containers|networks)/[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)
	paperNet    = regexp.MustCompile(`^trade-paper-[a-z0-9][a-z0-9_.-]*$`)
	nonRoot     = regexp.MustCompile(`^[1-9][0-9]*:[0-9]+$`)
	pullableTag = regexp.MustCompile(`^[a-zA-Z0-9_.:-]+$`)
	// What the docker client sets on a container or a network; any other field with a value is refused.
	containerFields = fields("Image", "Cmd", "Entrypoint", "Env", "User", "Labels", "StopTimeout", "AttachStdout",
		"AttachStderr", "HostConfig")
	hostFields = fields("NetworkMode", "RestartPolicy", "AutoRemove", "CapDrop", "ReadonlyRootfs", "SecurityOpt",
		"Tmpfs", "Memory", "MemorySwap", "MemorySwappiness", "NanoCpus", "PidsLimit", "Mounts", "LogConfig")
	mountFields   = fields("Type", "Source", "Target", "ReadOnly")
	networkFields = fields("Name", "Driver", "IPAM", "Internal", "Labels")
	ipamFields    = fields("Driver")
)

type object = map[string]any

func fields(names ...string) map[string]bool {
	found := map[string]bool{}
	for _, name := range names {
		found[name] = true
	}
	return found
}

type rules struct {
	repository string
	image      *regexp.Regexp
	user       string
	roots      []string
}

func newRules(repository, user string, roots []string) (rules, error) {
	if repository == "" || len(roots) == 0 {
		return rules{}, errors.New("--image and at least one --mount-root are required")
	}
	if !nonRoot.MatchString(user) {
		return rules{}, fmt.Errorf("--user %q is not a numeric non-root user:group", user)
	}
	for _, root := range roots {
		if !path.IsAbs(root) || path.Clean(root) != root || root == "/" {
			return rules{}, fmt.Errorf("mount root %q is not a clean absolute directory below /", root)
		}
	}
	image := regexp.MustCompile("^" + regexp.QuoteMeta(repository) + "@sha256:[0-9a-f]{64}$")
	return rules{repository, image, user, roots}, nil
}

// admit decides one request. A create that passes leaves in r.Body what was checked, not what arrived.
func (p *proxy) admit(r *http.Request) error {
	route, err := route(r.URL)
	if err != nil {
		return err
	}
	switch read := r.Method == http.MethodGet || r.Method == http.MethodHead; {
	case read && readable.MatchString(route):
		return nil
	case r.Method == http.MethodDelete && removable.MatchString(route):
		return nil
	case r.Method != http.MethodPost:
	case lifecycle.MatchString(route):
		return nil
	case route == "/images/create":
		return p.rules.pull(r.URL.Query())
	case route == "/containers/create":
		return checked(r, p.rules.container)
	case route == "/networks/create":
		return checked(r, network)
	default:
		if name := starting.FindStringSubmatch(route); name != nil {
			return p.starting(name[1])
		}
	}
	return errors.New("this call is not one the paper daemon makes")
}

// route is the path without its API version. The engine decodes a path too, so one it could read
// differently from this check is refused.
func route(u *url.URL) (string, error) {
	if u.RawPath != "" || strings.Contains(u.Path, "//") {
		return "", errors.New("the path is encoded or has an empty segment")
	}
	for _, segment := range strings.Split(u.Path, "/") {
		if segment == "." || segment == ".." {
			return "", errors.New("the path has a relative segment")
		}
	}
	if found := version.FindString(u.Path); found != "" {
		return "/" + strings.TrimPrefix(u.Path, strings.TrimSuffix(found, "/")+"/"), nil
	}
	return u.Path, nil
}

// checked reads a JSON body, has it checked and forwards the result. Forwarding one encoding of the checked
// fields, rather than the bytes that arrived, leaves the engine's decoder nothing else to read: it also takes
// "readonlyrootfs" for ReadonlyRootfs.
func checked(r *http.Request, check func(object) (object, error)) error {
	if r.Header.Get("Content-Encoding") != "" {
		return errors.New("the body is encoded")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		return fmt.Errorf("cannot read the body: %w", err)
	}
	if len(body) > maxBody {
		return errors.New("the body is too long")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var value object
	if err := decoder.Decode(&value); err != nil {
		return fmt.Errorf("the body is not a JSON object: %w", err)
	}
	if decoder.More() {
		return errors.New("the body holds more than one value")
	}
	kept, err := check(value)
	if err != nil {
		return err
	}
	if body, err = json.Marshal(kept); err != nil {
		return err
	}
	r.Body, r.ContentLength, r.TransferEncoding = io.NopCloser(bytes.NewReader(body)), int64(len(body)), nil
	r.Header.Del("Content-Length")
	return nil
}

// keep returns the named fields of `value`. Any other field must be empty; it is left out, which is the
// engine's default.
func keep(value object, allowed map[string]bool, where string) (object, error) {
	kept := object{}
	for key, field := range value {
		if allowed[key] {
			kept[key] = field
		} else if !empty(field) {
			return nil, fmt.Errorf("%s%s is set", where, key)
		}
	}
	return kept, nil
}

func empty(value any) bool {
	switch v := value.(type) {
	case nil:
		return true
	case bool:
		return !v
	case string:
		return v == ""
	case json.Number:
		number, err := strconv.ParseFloat(v.String(), 64)
		return err == nil && number == 0
	case []any:
		return !slices.ContainsFunc(v, func(item any) bool { return !empty(item) })
	case object:
		for _, item := range v {
			if !empty(item) {
				return false
			}
		}
		return true
	}
	return false
}

// container checks a create against what runtime/container.py builds: the pinned runtime image, a read-only
// root, every capability dropped, no privilege escalation, a process limit, the deployment's own user, no
// network or a paper run's own, and bind mounts under the roots with only /reports writable. What runs inside
// is not checked: the runtime image runs what it is told, and this decides only what that can reach.
func (c rules) container(value object) (object, error) {
	kept, err := keep(value, containerFields, "")
	if err != nil {
		return nil, err
	}
	if name, _ := kept["Image"].(string); !c.image.MatchString(name) {
		return nil, fmt.Errorf("image %q is not %s pinned by digest", name, c.repository)
	}
	if user, _ := kept["User"].(string); user != c.user {
		return nil, fmt.Errorf("user %q is not %s", user, c.user)
	}
	given, ok := kept["HostConfig"].(object)
	if !ok {
		return nil, errors.New("HostConfig is missing")
	}
	host, err := keep(given, hostFields, "HostConfig.")
	if err != nil {
		return nil, err
	}
	kept["HostConfig"] = host
	if host["ReadonlyRootfs"] != true {
		return nil, errors.New("the root filesystem is not read-only")
	}
	if !only(host["CapDrop"], "ALL") {
		return nil, errors.New("CapDrop is not exactly ALL")
	}
	if !only(host["SecurityOpt"], "no-new-privileges") {
		return nil, errors.New("SecurityOpt is not exactly no-new-privileges")
	}
	if limit, ok := host["PidsLimit"].(json.Number); !ok || strings.HasPrefix(limit.String(), "-") || empty(limit) {
		return nil, errors.New("there is no process limit")
	}
	if mode, _ := host["NetworkMode"].(string); mode != "none" && !paperNet.MatchString(mode) {
		return nil, fmt.Errorf("network %q is neither none nor a paper run's", mode)
	}
	if policy, _ := host["RestartPolicy"].(object); policy != nil && policy["Name"] != "no" && !empty(policy) {
		return nil, errors.New("a restart policy is set")
	}
	if tmpfs, _ := host["Tmpfs"].(object); len(tmpfs) > 1 || (len(tmpfs) == 1 && tmpfs["/tmp"] == nil) {
		return nil, errors.New("a tmpfs other than /tmp is set")
	}
	if err := logging(host["LogConfig"]); err != nil {
		return nil, err
	}
	mounts, _ := host["Mounts"].([]any)
	if host["Mounts"] != nil && mounts == nil {
		return nil, errors.New("Mounts is not a list")
	}
	for _, item := range mounts {
		given, _ := item.(object)
		mount, err := keep(given, mountFields, "a mount's ")
		if err != nil {
			return nil, err
		}
		kind, _ := mount["Type"].(string)
		source, _ := mount["Source"].(string)
		target, _ := mount["Target"].(string)
		readOnly, _ := mount["ReadOnly"].(bool)
		if err := c.mount(kind, source, target, readOnly); err != nil {
			return nil, err
		}
	}
	return kept, nil
}

func only(value any, want string) bool {
	items, _ := value.([]any)
	return len(items) == 1 && items[0] == want
}

func logging(value any) error {
	config, _ := value.(object)
	if config == nil && value != nil {
		return errors.New("LogConfig is not an object")
	}
	if kind, _ := config["Type"].(string); kind != "" && kind != "json-file" {
		return fmt.Errorf("log driver %q is not json-file", kind)
	}
	options, _ := config["Config"].(object)
	for key := range options {
		if key != "max-size" && key != "max-file" {
			return fmt.Errorf("log option %q is set", key)
		}
	}
	return nil
}

// mount checks one bind mount. The source is checked as named and with its symlinks resolved, on the
// directories this container sees at their own paths: mounted by the engine, a symlink under a root reaches
// wherever it points.
func (c rules) mount(kind, source, target string, readOnly bool) error {
	if kind != "bind" {
		return fmt.Errorf("mount %s: type %q is not bind", source, kind)
	}
	if !readOnly && target != reports {
		return fmt.Errorf("mount %s: only %s may be writable, not %q", source, reports, target)
	}
	if !path.IsAbs(target) || path.Clean(target) != target || target == "/" {
		return fmt.Errorf("mount target %q is not a clean absolute path below /", target)
	}
	for _, system := range []string{"/proc", "/sys", "/dev"} {
		if under(target, system) {
			return fmt.Errorf("mount target %q lies in %s", target, system)
		}
	}
	if !path.IsAbs(source) || path.Clean(source) != source {
		return fmt.Errorf("mount source %q is not a clean absolute path", source)
	}
	resolved, err := filepath.EvalSymlinks(source)
	if err != nil {
		return fmt.Errorf("mount source %q cannot be resolved: %w", source, err)
	}
	for _, root := range c.roots {
		real, err := filepath.EvalSymlinks(root)
		if err == nil && under(source, root) && under(resolved, real) {
			return nil
		}
	}
	return fmt.Errorf("mount source %q (%q) lies outside %s", source, resolved, strings.Join(c.roots, ", "))
}

func under(value, directory string) bool {
	return value == directory || strings.HasPrefix(value, directory+"/")
}

// pull allows the runtime repository by tag or digest, and nothing else the same endpoint can do: fromSrc
// imports an image from the request's body.
func (c rules) pull(query url.Values) error {
	for key := range query {
		if key != "fromImage" && key != "tag" && key != "platform" {
			return fmt.Errorf("pull option %q is set", key)
		}
	}
	if query.Get("fromImage") != c.repository {
		return fmt.Errorf("image %q is not %s", query.Get("fromImage"), c.repository)
	}
	if !pullableTag.MatchString(query.Get("tag")) {
		return fmt.Errorf("tag %q is not a tag or a digest", query.Get("tag"))
	}
	return nil
}

// network checks a create against paper/runs.py: a bridge of a paper run's name with no route out.
func network(value object) (object, error) {
	kept, err := keep(value, networkFields, "")
	if err != nil {
		return nil, err
	}
	if name, _ := kept["Name"].(string); !paperNet.MatchString(name) {
		return nil, fmt.Errorf("network name %q is not a paper run's", name)
	}
	if kept["Driver"] != "bridge" {
		return nil, errors.New("the network driver is not bridge")
	}
	if kept["Internal"] != true {
		return nil, errors.New("the network is not internal")
	}
	if ipam, _ := kept["IPAM"].(object); ipam != nil {
		if _, err := keep(ipam, ipamFields, "IPAM."); err != nil {
			return nil, err
		}
		if driver := ipam["Driver"]; driver != "default" && !empty(driver) {
			return nil, errors.New("the IPAM driver is not default")
		}
	}
	return kept, nil
}
