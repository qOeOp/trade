package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSegmentRecovery(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "complete.tl2s")
	written, err := writeSegment(path, [][]byte{[]byte("first"), []byte("second-payload")})
	if err != nil {
		t.Fatal(err)
	}
	if written.FrameCount != 2 {
		t.Fatalf("unexpected frame count: %d", written.FrameCount)
	}
	complete, err := recoverSegment(path, "")
	if err != nil || complete.Status != "complete" {
		t.Fatalf("complete recovery failed: %#v %v", complete, err)
	}
	segment, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	truncatedPath := filepath.Join(directory, "truncated.tl2s")
	if err := os.WriteFile(truncatedPath, segment[:len(segment)-3], 0o600); err != nil {
		t.Fatal(err)
	}
	truncated, err := recoverSegment(truncatedPath, "")
	if err != nil {
		t.Fatal(err)
	}
	if truncated.Status != "truncated_payload" || truncated.ValidFrameCount != 1 {
		t.Fatalf("unexpected truncated recovery: %#v", truncated)
	}

	segment[len(segment)-1] ^= 0xff
	corruptPath := filepath.Join(directory, "corrupt.tl2s")
	if err := os.WriteFile(corruptPath, segment, 0o600); err != nil {
		t.Fatal(err)
	}
	corrupt, err := recoverSegment(corruptPath, "")
	if err != nil {
		t.Fatal(err)
	}
	if corrupt.Status != "checksum_mismatch" || corrupt.ValidFrameCount != 1 {
		t.Fatalf("unexpected corrupt recovery: %#v", corrupt)
	}
}
