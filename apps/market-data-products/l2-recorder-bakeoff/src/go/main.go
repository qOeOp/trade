package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

const fixtureSchema = "trade.l2-bakeoff-fixture.v1"
const resultSchema = "trade.l2-bakeoff-result.v1"

var decimalPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)(\.[0-9]+)?$`)

type Level [2]string

type Snapshot struct {
	LastUpdateID int64   `json:"last_update_id"`
	Bids         []Level `json:"bids"`
	Asks         []Level `json:"asks"`
}

type DepthEvent struct {
	EventTimeMS           int64   `json:"event_time_ms"`
	TransactionTimeMS     int64   `json:"transaction_time_ms"`
	LocalReceiveTimeMS    int64   `json:"local_receive_time_ms"`
	FirstUpdateID         int64   `json:"first_update_id"`
	FinalUpdateID         int64   `json:"final_update_id"`
	PreviousFinalUpdateID int64   `json:"previous_final_update_id"`
	Bids                  []Level `json:"bids"`
	Asks                  []Level `json:"asks"`
}

type Gap struct {
	EventIndex                    int   `json:"event_index"`
	ExpectedPreviousFinalUpdateID int64 `json:"expected_previous_final_update_id"`
	ActualPreviousFinalUpdateID   int64 `json:"actual_previous_final_update_id"`
}

type Outcome struct {
	Status            string  `json:"status"`
	LastUpdateID      int64   `json:"last_update_id"`
	AppliedEventCount int     `json:"applied_event_count"`
	BookHash          string  `json:"book_hash"`
	Bids              []Level `json:"bids"`
	Asks              []Level `json:"asks"`
	Gap               *Gap    `json:"gap,omitempty"`
}

type Fixture struct {
	SchemaVersion string       `json:"schema_version"`
	FixtureID     string       `json:"fixture_id"`
	StreamEpoch   string       `json:"stream_epoch"`
	Symbol        string       `json:"symbol"`
	Snapshot      Snapshot     `json:"snapshot"`
	Events        []DepthEvent `json:"events"`
	Expected      Outcome      `json:"expected"`
}

type Result struct {
	SchemaVersion       string  `json:"schema_version"`
	Implementation      string  `json:"implementation"`
	FixtureID           string  `json:"fixture_id"`
	SourceHash          string  `json:"source_hash"`
	Iterations          int     `json:"iterations"`
	ProcessedEventCount int     `json:"processed_event_count"`
	ElapsedNS           int64   `json:"elapsed_ns"`
	Outcome             Outcome `json:"outcome"`
}

type canonicalBook struct {
	Asks []Level `json:"asks"`
	Bids []Level `json:"bids"`
}

func main() {
	fixturePath := flag.String("fixture", "fixtures/complete.json", "fixture JSON path")
	iterations := flag.Int("iterations", 1, "projection iterations")
	flag.Parse()
	if *iterations < 1 {
		fatal(errors.New("iterations must be positive"))
	}
	raw, err := os.ReadFile(*fixturePath)
	if err != nil {
		fatal(err)
	}
	result, err := runBakeoff(raw, *iterations)
	if err != nil {
		fatal(err)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(result); err != nil {
		fatal(err)
	}
}

func runBakeoff(raw []byte, iterations int) (Result, error) {
	fixture, err := parseFixture(raw)
	if err != nil {
		return Result{}, err
	}
	var outcome Outcome
	startedAt := time.Now()
	for iteration := 0; iteration < iterations; iteration++ {
		outcome, err = projectFixture(fixture)
		if err != nil {
			return Result{}, err
		}
	}
	return Result{
		SchemaVersion:       resultSchema,
		Implementation:      "go",
		FixtureID:           fixture.FixtureID,
		SourceHash:          hashBytes(raw),
		Iterations:          iterations,
		ProcessedEventCount: outcome.AppliedEventCount * iterations,
		ElapsedNS:           time.Since(startedAt).Nanoseconds(),
		Outcome:             outcome,
	}, nil
}

func parseFixture(raw []byte) (Fixture, error) {
	var fixture Fixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		return Fixture{}, err
	}
	if fixture.SchemaVersion != fixtureSchema {
		return Fixture{}, errors.New("unsupported fixture schema_version")
	}
	if fixture.FixtureID == "" || fixture.StreamEpoch == "" || fixture.Symbol == "" {
		return Fixture{}, errors.New("fixture identity fields must be non-empty")
	}
	if len(fixture.Events) == 0 {
		return Fixture{}, errors.New("fixture events must be non-empty")
	}
	for _, event := range fixture.Events {
		if event.LocalReceiveTimeMS <= 0 {
			return Fixture{}, errors.New("local_receive_time_ms must be positive")
		}
	}
	for _, levels := range append([][]Level{fixture.Snapshot.Bids, fixture.Snapshot.Asks}, eventLevels(fixture.Events)...) {
		if err := validateLevels(levels); err != nil {
			return Fixture{}, err
		}
	}
	return fixture, nil
}

func projectFixture(fixture Fixture) (Outcome, error) {
	bids := make(map[string]string)
	asks := make(map[string]string)
	if err := applyLevels(bids, fixture.Snapshot.Bids); err != nil {
		return Outcome{}, err
	}
	if err := applyLevels(asks, fixture.Snapshot.Asks); err != nil {
		return Outcome{}, err
	}
	previousFinalUpdateID := fixture.Snapshot.LastUpdateID
	appliedEventCount := 0
	bridged := false
	var gap *Gap
	for eventIndex, event := range fixture.Events {
		if event.FinalUpdateID < fixture.Snapshot.LastUpdateID {
			continue
		}
		if !bridged {
			if event.FirstUpdateID > fixture.Snapshot.LastUpdateID || event.FinalUpdateID < fixture.Snapshot.LastUpdateID {
				gap = &Gap{eventIndex, fixture.Snapshot.LastUpdateID, event.PreviousFinalUpdateID}
				break
			}
			bridged = true
		} else if event.PreviousFinalUpdateID != previousFinalUpdateID {
			gap = &Gap{eventIndex, previousFinalUpdateID, event.PreviousFinalUpdateID}
			break
		}
		if err := applyLevels(bids, event.Bids); err != nil {
			return Outcome{}, err
		}
		if err := applyLevels(asks, event.Asks); err != nil {
			return Outcome{}, err
		}
		previousFinalUpdateID = event.FinalUpdateID
		appliedEventCount++
	}
	sortedBids := mapToLevels(bids, false)
	sortedAsks := mapToLevels(asks, true)
	canonical, err := json.Marshal(canonicalBook{Asks: sortedAsks, Bids: sortedBids})
	if err != nil {
		return Outcome{}, err
	}
	status := "complete"
	if gap != nil {
		status = "incomplete"
	}
	return Outcome{
		Status:            status,
		LastUpdateID:      previousFinalUpdateID,
		AppliedEventCount: appliedEventCount,
		BookHash:          hashBytes(canonical),
		Bids:              sortedBids,
		Asks:              sortedAsks,
		Gap:               gap,
	}, nil
}

func eventLevels(events []DepthEvent) [][]Level {
	levels := make([][]Level, 0, len(events)*2)
	for _, event := range events {
		levels = append(levels, event.Bids, event.Asks)
	}
	return levels
}

func validateLevels(levels []Level) error {
	for _, level := range levels {
		if _, err := normalizeDecimal(level[0]); err != nil {
			return err
		}
		if _, err := normalizeDecimal(level[1]); err != nil {
			return err
		}
	}
	return nil
}

func applyLevels(book map[string]string, levels []Level) error {
	for _, level := range levels {
		price, err := normalizeDecimal(level[0])
		if err != nil {
			return err
		}
		quantity, err := normalizeDecimal(level[1])
		if err != nil {
			return err
		}
		if quantity == "0" {
			delete(book, price)
		} else {
			book[price] = quantity
		}
	}
	return nil
}

func mapToLevels(book map[string]string, ascending bool) []Level {
	levels := make([]Level, 0, len(book))
	for price, quantity := range book {
		levels = append(levels, Level{price, quantity})
	}
	sort.Slice(levels, func(left, right int) bool {
		comparison := compareDecimals(levels[left][0], levels[right][0])
		if ascending {
			return comparison < 0
		}
		return comparison > 0
	})
	return levels
}

func normalizeDecimal(value string) (string, error) {
	if !decimalPattern.MatchString(value) {
		return "", fmt.Errorf("invalid unsigned decimal: %s", value)
	}
	parts := strings.SplitN(value, ".", 2)
	if len(parts) == 1 {
		return parts[0], nil
	}
	fraction := strings.TrimRight(parts[1], "0")
	if fraction == "" {
		return parts[0], nil
	}
	return parts[0] + "." + fraction, nil
}

func compareDecimals(left string, right string) int {
	leftParts := strings.SplitN(left, ".", 2)
	rightParts := strings.SplitN(right, ".", 2)
	if len(leftParts[0]) != len(rightParts[0]) {
		if len(leftParts[0]) < len(rightParts[0]) {
			return -1
		}
		return 1
	}
	if leftParts[0] != rightParts[0] {
		if leftParts[0] < rightParts[0] {
			return -1
		}
		return 1
	}
	leftFraction := ""
	rightFraction := ""
	if len(leftParts) == 2 {
		leftFraction = leftParts[1]
	}
	if len(rightParts) == 2 {
		rightFraction = rightParts[1]
	}
	width := max(len(leftFraction), len(rightFraction))
	leftFraction += strings.Repeat("0", width-len(leftFraction))
	rightFraction += strings.Repeat("0", width-len(rightFraction))
	if leftFraction == rightFraction {
		return 0
	}
	if leftFraction < rightFraction {
		return -1
	}
	return 1
}

func hashBytes(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
