package main

// A WebSocket client, what the push streams need of RFC 6455 and no more: text messages either way, frames
// put back together, pings answered (Binance drops a connection that does not), and the close code. The
// standard library has HTTP's upgrade but no WebSocket. Compression is not offered.

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	opContinuation = 0x0
	opText         = 0x1
	opBinary       = 0x2
	opClose        = 0x8
	opPing         = 0x9
	opPong         = 0xA

	handshakeTimeout = 20 * time.Second
	// maxMessage bounds what one message may make this service hold; the largest pushes are a few kilobytes.
	maxMessage = 16 << 20

	closeNoStatus = 1005
	closeAbnormal = 1006
	closeTooLarge = 1009
	closeProtocol = 1002
)

// socket is one open connection. Writes may come from any goroutine; reads from one.
type socket struct {
	conn    io.ReadWriteCloser
	reader  *bufio.Reader
	writing sync.Mutex
	open    bool
}

func acceptFor(key string) string {
	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(sum[:])
}

// dial opens a `wss://` (or `ws://`) URL through the default transport, which keeps upgrades on HTTP/1.1.
func dial(url string) (*socket, error) {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(nonce)
	ctx, cancel := context.WithCancel(context.Background())
	timer := time.AfterFunc(handshakeTimeout, cancel)
	defer timer.Stop()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.Replace(strings.Replace(url, "wss://", "https://", 1), "ws://", "http://", 1), nil)
	if err != nil {
		cancel()
		return nil, err
	}
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Sec-WebSocket-Key", key)
	request.Header.Set("Sec-WebSocket-Version", "13")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		cancel()
		return nil, err
	}
	conn, ok := response.Body.(io.ReadWriteCloser)
	if response.StatusCode != http.StatusSwitchingProtocols || !ok || response.Header.Get("Sec-WebSocket-Accept") != acceptFor(key) {
		response.Body.Close()
		cancel()
		return nil, fmt.Errorf("%s did not upgrade: %s", url, response.Status)
	}
	return &socket{conn: conn, reader: bufio.NewReader(conn), open: true}, nil
}

func (s *socket) isOpen() bool {
	s.writing.Lock()
	defer s.writing.Unlock()
	return s.open
}

func (s *socket) close() {
	s.writing.Lock()
	defer s.writing.Unlock()
	s.open = false
	s.conn.Close()
}

// send writes a text message.
func (s *socket) send(text string) error { return s.write(opText, []byte(text)) }

func (s *socket) write(op byte, payload []byte) error {
	frame := make([]byte, 0, len(payload)+14)
	frame = append(frame, 0x80|op)
	switch {
	case len(payload) < 126:
		frame = append(frame, 0x80|byte(len(payload)))
	case len(payload) < 1<<16:
		frame = append(frame, 0x80|126)
		frame = binary.BigEndian.AppendUint16(frame, uint16(len(payload)))
	default:
		frame = append(frame, 0x80|127)
		frame = binary.BigEndian.AppendUint64(frame, uint64(len(payload)))
	}
	mask := make([]byte, 4)
	if _, err := rand.Read(mask); err != nil {
		return err
	}
	frame = append(frame, mask...)
	for i, b := range payload {
		frame = append(frame, b^mask[i%4])
	}
	s.writing.Lock()
	defer s.writing.Unlock()
	if !s.open {
		return errors.New("the connection is closed")
	}
	_, err := s.conn.Write(frame)
	return err
}

// frame reads one frame.
func (s *socket) frame() (final bool, op byte, payload []byte, code int, err error) {
	head := make([]byte, 2)
	if _, err = io.ReadFull(s.reader, head); err != nil {
		return false, 0, nil, closeAbnormal, err
	}
	final, op = head[0]&0x80 != 0, head[0]&0x0F
	if head[1]&0x80 != 0 {
		return false, 0, nil, closeProtocol, errors.New("the server masked a frame")
	}
	size := uint64(head[1] & 0x7F)
	if size >= 126 {
		wide := make([]byte, 2)
		if size == 127 {
			wide = make([]byte, 8)
		}
		if _, err = io.ReadFull(s.reader, wide); err != nil {
			return false, 0, nil, closeAbnormal, err
		}
		if size == 126 {
			size = uint64(binary.BigEndian.Uint16(wide))
		} else {
			size = binary.BigEndian.Uint64(wide)
		}
	}
	if size > maxMessage {
		return false, 0, nil, closeTooLarge, errors.New("a message larger than this service holds")
	}
	payload = make([]byte, size)
	if _, err = io.ReadFull(s.reader, payload); err != nil {
		return false, 0, nil, closeAbnormal, err
	}
	return final, op, payload, 0, nil
}

// read is the next text message, answering pings on the way; once the connection has ended, the close code
// and an error. A binary message comes back empty: nothing here pushes one, and "" is no JSON.
func (s *socket) read() (string, int, error) {
	var message []byte
	var binaryMessage bool
	for {
		final, op, payload, code, err := s.frame()
		if err != nil {
			return "", code, err
		}
		switch op {
		case opPing:
			if err := s.write(opPong, payload); err != nil {
				return "", closeAbnormal, err
			}
			continue
		case opPong:
			continue
		case opClose:
			code := closeNoStatus
			if len(payload) >= 2 {
				code = int(binary.BigEndian.Uint16(payload))
				_ = s.write(opClose, payload[:2])
			} else {
				_ = s.write(opClose, nil)
			}
			return "", code, errors.New("closed")
		case opBinary:
			binaryMessage = true
		case opText, opContinuation:
		default:
			return "", closeProtocol, fmt.Errorf("frame kind %d", op)
		}
		if len(message)+len(payload) > maxMessage {
			return "", closeTooLarge, errors.New("a message larger than this service holds")
		}
		message = append(message, payload...)
		if final {
			if binaryMessage {
				return "", 0, nil
			}
			return string(message), 0, nil
		}
	}
}
