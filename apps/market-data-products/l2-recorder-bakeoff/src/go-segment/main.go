package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"hash/crc32"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const headerBytes = 8
const frameHeaderBytes = 8
const maxPayloadBytes = 16 * 1024 * 1024

var magic = []byte("TL2S")

type writeResult struct {
	SchemaVersion  string `json:"schema_version"`
	Implementation string `json:"implementation"`
	FrameCount     int    `json:"frame_count"`
	PayloadBytes   int    `json:"payload_bytes"`
	SegmentBytes   int    `json:"segment_bytes"`
	PayloadHash    string `json:"payload_hash"`
	SegmentHash    string `json:"segment_hash"`
	ElapsedNS      int64  `json:"elapsed_ns"`
}

type recoveryResult struct {
	SchemaVersion   string `json:"schema_version"`
	Implementation  string `json:"implementation"`
	Status          string `json:"status"`
	ValidFrameCount int    `json:"valid_frame_count"`
	ValidBytes      int    `json:"valid_bytes"`
	PayloadBytes    int    `json:"payload_bytes"`
	PayloadHash     string `json:"payload_hash"`
	SegmentBytes    int    `json:"segment_bytes"`
	ElapsedNS       int64  `json:"elapsed_ns"`
}

func main() {
	mode := flag.String("mode", "", "write or recover")
	input := flag.String("input", "", "input JSONL or segment")
	output := flag.String("output", "", "segment output")
	salvageOutput := flag.String("salvage-output", "", "optional recovered prefix output")
	delayMS := flag.Int("delay-ms", 0, "test-only delay after each frame")
	syncEveryFrames := flag.Int("sync-every-frames", 0, "test-only periodic fsync interval")
	flag.Parse()
	if *delayMS < 0 || *syncEveryFrames < 0 {
		fatal(errors.New("--delay-ms and --sync-every-frames must be non-negative"))
	}
	var result any
	var err error
	switch *mode {
	case "write":
		if *input == "" || *output == "" {
			fatal(errors.New("write requires --input and --output"))
		}
		var payloads [][]byte
		payloads, err = readJSONLines(*input)
		if err == nil {
			result, err = writeSegmentWithOptions(*output, payloads, *delayMS, *syncEveryFrames)
		}
	case "recover":
		if *input == "" {
			fatal(errors.New("recover requires --input"))
		}
		result, err = recoverSegment(*input, *salvageOutput)
	default:
		fatal(errors.New("--mode must be write or recover"))
	}
	if err != nil {
		fatal(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fatal(err)
	}
}

func readJSONLines(path string) ([][]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), maxPayloadBytes+1)
	payloads := make([][]byte, 0)
	for scanner.Scan() {
		payload := append([]byte(nil), scanner.Bytes()...)
		if len(payload) == 0 {
			return nil, errors.New("input JSONL contains an empty line")
		}
		payloads = append(payloads, payload)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(payloads) == 0 {
		return nil, errors.New("input JSONL must contain at least one line")
	}
	return payloads, nil
}

func writeSegment(outputPath string, payloads [][]byte) (writeResult, error) {
	return writeSegmentWithOptions(outputPath, payloads, 0, 0)
}

func writeSegmentWithOptions(outputPath string, payloads [][]byte, delayMS int, syncEveryFrames int) (writeResult, error) {
	if len(payloads) == 0 {
		return writeResult{}, errors.New("segment requires at least one payload")
	}
	if _, err := os.Stat(outputPath); err == nil {
		return writeResult{}, fmt.Errorf("segment output already exists: %s", outputPath)
	} else if !os.IsNotExist(err) {
		return writeResult{}, err
	}
	partialPath := outputPath + ".partial." + strconv.Itoa(os.Getpid()) + "." + strconv.FormatInt(time.Now().UnixNano(), 10)
	startedAt := time.Now()
	file, err := os.OpenFile(partialPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return writeResult{}, err
	}
	closed := false
	defer func() {
		if !closed {
			_ = file.Close()
		}
	}()
	header := []byte{'T', 'L', '2', 'S', 0, 1, 0, 0}
	if err := writeAll(file, header); err != nil {
		return writeResult{}, err
	}
	payloadHasher := sha256.New()
	payloadBytes := 0
	for index, payload := range payloads {
		if len(payload) == 0 || len(payload) > maxPayloadBytes {
			return writeResult{}, fmt.Errorf("payload length out of bounds: %d", len(payload))
		}
		frameHeader := make([]byte, frameHeaderBytes)
		binary.BigEndian.PutUint32(frameHeader[0:4], uint32(len(payload)))
		binary.BigEndian.PutUint32(frameHeader[4:8], crc32.ChecksumIEEE(payload))
		if err := writeAll(file, frameHeader); err != nil {
			return writeResult{}, err
		}
		if err := writeAll(file, payload); err != nil {
			return writeResult{}, err
		}
		_, _ = payloadHasher.Write(payload)
		payloadBytes += len(payload)
		if syncEveryFrames > 0 && (index+1)%syncEveryFrames == 0 {
			if err := file.Sync(); err != nil {
				return writeResult{}, err
			}
		}
		if delayMS > 0 {
			time.Sleep(time.Duration(delayMS) * time.Millisecond)
		}
	}
	if err := file.Sync(); err != nil {
		return writeResult{}, err
	}
	if err := file.Close(); err != nil {
		return writeResult{}, err
	}
	closed = true
	if err := os.Rename(partialPath, outputPath); err != nil {
		return writeResult{}, err
	}
	directory, err := os.Open(filepath.Dir(outputPath))
	if err != nil {
		return writeResult{}, err
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return writeResult{}, err
	}
	if err := directory.Close(); err != nil {
		return writeResult{}, err
	}
	segment, err := os.ReadFile(outputPath)
	if err != nil {
		return writeResult{}, err
	}
	return writeResult{
		SchemaVersion: "trade.l2-segment-write-result.v1", Implementation: "go",
		FrameCount: len(payloads), PayloadBytes: payloadBytes, SegmentBytes: len(segment),
		PayloadHash: hex.EncodeToString(payloadHasher.Sum(nil)), SegmentHash: hashBytes(segment),
		ElapsedNS: time.Since(startedAt).Nanoseconds(),
	}, nil
}

func recoverSegment(path string, salvageOutput string) (recoveryResult, error) {
	startedAt := time.Now()
	segment, err := os.ReadFile(path)
	if err != nil {
		return recoveryResult{}, err
	}
	status := "complete"
	offset := 0
	validFrameCount := 0
	payloadBytes := 0
	payloadHasher := sha256.New()
	if len(segment) < headerBytes || string(segment[:4]) != string(magic) || binary.BigEndian.Uint16(segment[4:6]) != 1 || binary.BigEndian.Uint16(segment[6:8]) != 0 {
		status = "invalid_header"
	} else {
		offset = headerBytes
		for offset < len(segment) {
			if len(segment)-offset < frameHeaderBytes {
				status = "truncated_frame_header"
				break
			}
			length := int(binary.BigEndian.Uint32(segment[offset : offset+4]))
			expectedCRC := binary.BigEndian.Uint32(segment[offset+4 : offset+8])
			if length == 0 || length > maxPayloadBytes {
				status = "invalid_length"
				break
			}
			if len(segment)-offset-frameHeaderBytes < length {
				status = "truncated_payload"
				break
			}
			payload := segment[offset+frameHeaderBytes : offset+frameHeaderBytes+length]
			if crc32.ChecksumIEEE(payload) != expectedCRC {
				status = "checksum_mismatch"
				break
			}
			_, _ = payloadHasher.Write(payload)
			payloadBytes += len(payload)
			validFrameCount++
			offset += frameHeaderBytes + length
		}
	}
	if salvageOutput != "" {
		file, err := os.OpenFile(salvageOutput, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return recoveryResult{}, err
		}
		if err := writeAll(file, segment[:offset]); err != nil {
			_ = file.Close()
			return recoveryResult{}, err
		}
		if err := file.Close(); err != nil {
			return recoveryResult{}, err
		}
	}
	return recoveryResult{
		SchemaVersion: "trade.l2-segment-recovery-result.v1", Implementation: "go", Status: status,
		ValidFrameCount: validFrameCount, ValidBytes: offset, PayloadBytes: payloadBytes,
		PayloadHash: hex.EncodeToString(payloadHasher.Sum(nil)), SegmentBytes: len(segment),
		ElapsedNS: time.Since(startedAt).Nanoseconds(),
	}, nil
}

func writeAll(file *os.File, value []byte) error {
	for len(value) > 0 {
		written, err := file.Write(value)
		if err != nil {
			return err
		}
		value = value[written:]
	}
	return nil
}

func hashBytes(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
