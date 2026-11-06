package main

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// A server side of the protocol, enough to speak to the client.
func serverFrame(w io.Writer, first byte, payload []byte) {
	head := []byte{first}
	switch {
	case len(payload) < 126:
		head = append(head, byte(len(payload)))
	case len(payload) < 1<<16:
		head = append(head, 126)
		head = binary.BigEndian.AppendUint16(head, uint16(len(payload)))
	default:
		head = append(head, 127)
		head = binary.BigEndian.AppendUint64(head, uint64(len(payload)))
	}
	_, _ = w.Write(append(head, payload...))
}

func clientFrame(t *testing.T, r *bufio.Reader) (byte, string) {
	t.Helper()
	head := make([]byte, 2)
	if _, err := io.ReadFull(r, head); err != nil {
		t.Errorf("read: %v", err)
		return 0, ""
	}
	if head[1]&0x80 == 0 {
		t.Error("a client's frame must be masked")
	}
	size := int(head[1] & 0x7F)
	if size == 126 {
		wide := make([]byte, 2)
		_, _ = io.ReadFull(r, wide)
		size = int(binary.BigEndian.Uint16(wide))
	}
	mask := make([]byte, 4)
	_, _ = io.ReadFull(r, mask)
	body := make([]byte, size)
	_, _ = io.ReadFull(r, body)
	for i := range body {
		body[i] ^= mask[i%4]
	}
	return head[0] & 0x0F, string(body)
}

// serving answers the upgrade and hands the connection to `script`.
func serving(t *testing.T, script func(r *bufio.Reader, w *bufio.Writer)) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", acceptFor(r.Header.Get("Sec-WebSocket-Key")))
		_ = rw.Flush()
		script(rw.Reader, rw.Writer)
		_ = rw.Flush()
	}))
	t.Cleanup(server.Close)
	return strings.Replace(server.URL, "http://", "ws://", 1)
}

func TestTheSocketReadsMessagesWholeAnswersPingsAndReportsTheCloseCode(t *testing.T) {
	long := strings.Repeat("x", 70_000)
	pong := make(chan string, 1)
	url := serving(t, func(r *bufio.Reader, w *bufio.Writer) {
		serverFrame(w, 0x81, []byte(`{"a":1}`))
		serverFrame(w, 0x01, []byte(`{"b"`)) // a text message in two frames, a ping between them
		serverFrame(w, 0x89, []byte("are you there"))
		serverFrame(w, 0x80, []byte(`:2}`))
		serverFrame(w, 0x81, []byte(long))
		serverFrame(w, 0x82, []byte{0, 1, 2}) // binary comes back as no text
		serverFrame(w, 0x88, binary.BigEndian.AppendUint16(nil, 4000))
		_ = w.Flush()
		op, body := clientFrame(t, r)
		wantEqual(t, op, byte(opPong))
		pong <- body
		op, _ = clientFrame(t, r)
		wantEqual(t, op, byte(opClose))
	})
	conn, err := dial(url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.close()
	for _, want := range []string{`{"a":1}`, `{"b":2}`, long, ""} {
		got, _, err := conn.read()
		if err != nil {
			t.Fatal(err)
		}
		wantEqual(t, got, want)
	}
	_, code, err := conn.read()
	if err == nil {
		t.Fatal("the connection closed")
	}
	wantEqual(t, code, 4000)
	select {
	case body := <-pong:
		wantEqual(t, body, "are you there")
	case <-time.After(5 * time.Second):
		t.Fatal("no pong")
	}
}

func TestTheSocketSendsMaskedTextAndReportsADropAsAbnormal(t *testing.T) {
	got := make(chan string, 2)
	long := strings.Repeat("y", 300)
	url := serving(t, func(r *bufio.Reader, w *bufio.Writer) {
		for range 2 {
			op, body := clientFrame(t, r)
			wantEqual(t, op, byte(opText))
			got <- body
		}
	})
	conn, err := dial(url)
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.send("ping"); err != nil {
		t.Fatal(err)
	}
	if err := conn.send(long); err != nil {
		t.Fatal(err)
	}
	wantEqual(t, <-got, "ping")
	wantEqual(t, <-got, long)
	_, code, err := conn.read()
	if err == nil {
		t.Fatal("the server hung up")
	}
	wantEqual(t, code, closeAbnormal)
	conn.close()
	wantEqual(t, conn.isOpen(), false)
	if conn.send("late") == nil {
		t.Error("nothing goes out on a closed connection")
	}
}

func TestASocketThatIsRefusedOrAnswersWrongIsNoConnection(t *testing.T) {
	refused := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusForbidden) }))
	defer refused.Close()
	if _, err := dial(strings.Replace(refused.URL, "http://", "ws://", 1)); err == nil {
		t.Error("a 403 is no upgrade")
	}
	wrong := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, rw, _ := w.(http.Hijacker).Hijack()
		defer conn.Close()
		fmt.Fprint(rw, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: wrong\r\n\r\n")
		_ = rw.Flush()
	}))
	defer wrong.Close()
	if _, err := dial(strings.Replace(wrong.URL, "http://", "ws://", 1)); err == nil {
		t.Error("a wrong accept is no upgrade")
	}
}

func TestAMaskedOrOversizedFrameEndsTheConnection(t *testing.T) {
	url := serving(t, func(r *bufio.Reader, w *bufio.Writer) {
		_, _ = w.Write([]byte{0x81, 127})
		_, _ = w.Write(binary.BigEndian.AppendUint64(nil, 1<<40))
	})
	conn, err := dial(url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.close()
	_, code, err := conn.read()
	if err == nil {
		t.Fatal("too large a message")
	}
	wantEqual(t, code, closeTooLarge)
	url = serving(t, func(r *bufio.Reader, w *bufio.Writer) { _, _ = w.Write([]byte{0x81, 0x80, 1, 2, 3, 4}) })
	conn2, err := dial(url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn2.close()
	_, code, err = conn2.read()
	if err == nil {
		t.Fatal("a masked frame")
	}
	wantEqual(t, code, closeProtocol)
}
