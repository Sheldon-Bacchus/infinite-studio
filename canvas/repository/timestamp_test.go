package repository

import "testing"

func TestLocalTimestampAfterUsesParsedTimeAndRejectsInvalidInput(t *testing.T) {
	newer, err := localTimestampAfter("2026-09-23T11:00:00.500Z", "2026-09-23T19:00:00+08:00")
	if err != nil {
		t.Fatal(err)
	}
	if !newer {
		t.Fatal("fractional UTC timestamp should be later than its equivalent timezone-offset timestamp")
	}
	if _, err := localTimestampAfter("2026-9-23T11:00:00Z", "2026-09-23T10:00:00Z"); err == nil {
		t.Fatal("invalid stored timestamp should not fall back to lexical comparison")
	}
	if _, err := localTimestampAfter("2026-09-23T11:00:00Z", "2026-9-23T10:00:00Z"); err == nil {
		t.Fatal("invalid incoming timestamp should not fall back to lexical comparison")
	}
}
